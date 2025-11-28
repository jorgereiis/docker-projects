#!/bin/bash
# =============================================================================
# Monitor WPPCONNECT - Verifica sessões e faz restart/rebuild se necessário
# Localização no servidor: /Docker/monitor_wppconnect.sh
#
# Lógica de verificação:
# 1. Container não UP → docker restart
# 2. API não retorna 200 → docker restart
# 3. Divergência status-session vs check-connection → rebuild completo
#    (detecta problema de detached frame no Puppeteer)
#
# Uso:
#   chmod +x /Docker/monitor_wppconnect.sh
#   Adicionar ao crontab: */10 * * * * /Docker/monitor_wppconnect.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOGFILE="${SCRIPT_DIR}/logs/wppconnect_monitor.log"
DIVERGENCE_FILE="/tmp/wppconnect_divergence_count"
API_URL="http://localhost:21465/api"
DIVERGENCE_THRESHOLD=3  # Divergências consecutivas antes de rebuild

# Criar diretório de logs se não existir
mkdir -p "${SCRIPT_DIR}/logs"

# Função para logar com timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOGFILE"
}

# Função para reiniciar container (solução rápida)
restart_container() {
    log "[RESTART] Reiniciando container wppconnect-server..."
    docker restart wppconnect-server
    RESULT=$?

    if [ $RESULT -eq 0 ]; then
        log "[RESTART] Container reiniciado com sucesso"
        sleep 30  # Aguardar inicialização
    else
        log "[ERROR] Falha ao reiniciar container (exit code: $RESULT)"
    fi

    return $RESULT
}

# Função para fazer rebuild completo (problema de detached frame)
rebuild_container() {
    log "[REBUILD] Iniciando rebuild completo do container..."

    cd "${SCRIPT_DIR}/ubuntu" || { log "[ERROR] Diretório ubuntu não encontrado"; return 1; }

    # Parar e remover container
    log "[REBUILD] Parando container..."
    docker stop wppconnect-server 2>/dev/null

    log "[REBUILD] Removendo container..."
    docker rm wppconnect-server 2>/dev/null

    # Opcional: remover imagem antiga para forçar rebuild limpo
    # log "[REBUILD] Removendo imagem antiga..."
    # docker rmi wppconnect-server 2>/dev/null

    # Rebuild
    log "[REBUILD] Executando docker compose build..."
    docker compose -f wppconnect-build.yml build 2>&1 | while read line; do log "[BUILD] $line"; done

    # Subir container
    log "[REBUILD] Executando docker compose up -d..."
    docker compose -f wppconnect-build.yml up -d 2>&1 | while read line; do log "[UP] $line"; done

    # Aguardar inicialização
    log "[REBUILD] Aguardando 60 segundos para inicialização..."
    sleep 60

    # Verificar se voltou
    API_CHECK=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${API_URL}/" 2>/dev/null)
    if [ "$API_CHECK" = "200" ]; then
        log "[REBUILD] Rebuild concluído com sucesso - API respondendo"
        return 0
    else
        log "[ERROR] Rebuild concluído mas API não responde (HTTP: $API_CHECK)"
        return 1
    fi
}

# Função para verificar uma sessão específica
check_session() {
    local SESSION="$1"
    local TOKEN="$2"

    # Verificar status-session
    STATUS_RESP=$(curl -s --max-time 10 \
        -H "Authorization: Bearer $TOKEN" \
        "${API_URL}/${SESSION}/status-session" 2>/dev/null)
    STATUS=$(echo "$STATUS_RESP" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

    # Verificar check-connection-session
    CHECK_RESP=$(curl -s --max-time 10 \
        -H "Authorization: Bearer $TOKEN" \
        "${API_URL}/${SESSION}/check-connection-session" 2>/dev/null)
    CHECK_STATUS=$(echo "$CHECK_RESP" | grep -o '"status":[^,}]*' | cut -d':' -f2 | tr -d ' ')
    CHECK_MSG=$(echo "$CHECK_RESP" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)

    log "[CHECK] Sessão: $SESSION | status-session: $STATUS | check-connection: $CHECK_STATUS ($CHECK_MSG)"

    # Detectar divergência: status diz CONNECTED mas check diz false/Disconnected
    if [ "$STATUS" = "CONNECTED" ]; then
        if [ "$CHECK_STATUS" = "false" ] || [ "$CHECK_MSG" = "Disconnected" ]; then
            log "[DIVERGENCE] Sessão $SESSION com divergência detectada!"
            return 1  # Problema detectado
        fi
    fi

    return 0  # OK
}

# ==================== INÍCIO DA VERIFICAÇÃO ====================

log "[START] Iniciando verificação..."

# 1. Verificar se container está rodando - se não, REINICIAR
CONTAINER_STATUS=$(docker inspect -f '{{.State.Running}}' wppconnect-server 2>/dev/null)
if [ "$CONTAINER_STATUS" != "true" ]; then
    log "[ERROR] Container wppconnect-server não está rodando"
    restart_container
    echo "0" > "$DIVERGENCE_FILE"
    exit 0
fi

# 2. Verificar se API responde - se não, REINICIAR
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${API_URL}/" 2>/dev/null)
if [ "$API_STATUS" != "200" ]; then
    log "[ERROR] API não responde (HTTP: $API_STATUS) - reiniciando container"
    restart_container
    echo "0" > "$DIVERGENCE_FILE"
    exit 0
fi

# 3. Verificar sessões - se divergência, contador para REBUILD
TOKENS_DIR="${SCRIPT_DIR}/ubuntu/wppconnect-server/tokens"
SESSION_DIVERGENCE=0

if [ -d "$TOKENS_DIR" ]; then
    for TOKEN_FILE in "$TOKENS_DIR"/*.data.json; do
        [ -e "$TOKEN_FILE" ] || continue  # Pular se não existir

        # Extrair nome da sessão do arquivo
        SESSION_NAME=$(basename "$TOKEN_FILE" .data.json)

        # Extrair token do arquivo
        TOKEN=$(grep -o '"token":"[^"]*"' "$TOKEN_FILE" 2>/dev/null | cut -d'"' -f4)

        if [ -n "$TOKEN" ] && [ -n "$SESSION_NAME" ]; then
            if ! check_session "$SESSION_NAME" "$TOKEN"; then
                SESSION_DIVERGENCE=1
            fi
        fi
    done
else
    log "[WARNING] Diretório de tokens não encontrado: $TOKENS_DIR"
fi

# 4. Se encontrou divergência em alguma sessão, incrementar contador
if [ "$SESSION_DIVERGENCE" -eq 1 ]; then
    DIVERGENCE_COUNT=$(cat "$DIVERGENCE_FILE" 2>/dev/null || echo "0")
    DIVERGENCE_COUNT=$((DIVERGENCE_COUNT + 1))
    echo "$DIVERGENCE_COUNT" > "$DIVERGENCE_FILE"

    log "[WARNING] Divergência detectada em sessão(ões) - Contagem: $DIVERGENCE_COUNT/$DIVERGENCE_THRESHOLD"

    if [ "$DIVERGENCE_COUNT" -ge "$DIVERGENCE_THRESHOLD" ]; then
        log "[ACTION] Threshold de divergências atingido - iniciando REBUILD completo"
        rebuild_container
        echo "0" > "$DIVERGENCE_FILE"
    fi
else
    # Tudo ok - reset contador
    CURRENT_COUNT=$(cat "$DIVERGENCE_FILE" 2>/dev/null || echo "0")
    if [ "$CURRENT_COUNT" != "0" ]; then
        log "[RECOVERED] Todas as sessões OK - resetando contador de divergências"
    fi
    echo "0" > "$DIVERGENCE_FILE"
fi

log "[END] Verificação concluída"
