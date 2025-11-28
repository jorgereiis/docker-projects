#!/bin/bash
# =============================================================================
# Monitor WPPCONNECT - Verifica sessões e faz restart/rebuild se necessário
# Localização no servidor: /Docker/monitor_wppconnect.sh
#
# Lógica de verificação:
# 1. Container não UP → docker restart (solução rápida)
# 2. API não retorna 200 → docker restart (solução rápida)
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
API_URL="http://api.nossopainel.com.br/api"
DIVERGENCE_THRESHOLD=3  # Divergências consecutivas antes de rebuild

# Criar diretório de logs se não existir
mkdir -p "${SCRIPT_DIR}/logs"

# Função para logar com timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOGFILE"
}

# Função para separador visual no log
log_separator() {
    echo "============================================================" >> "$LOGFILE"
}

# Função para reiniciar container (solução rápida)
restart_container() {
    log "[RESTART] =========================================="
    log "[RESTART] Iniciando reinicialização do container..."
    log "[RESTART] Comando: docker restart wppconnect-server"

    docker restart wppconnect-server
    RESULT=$?

    if [ $RESULT -eq 0 ]; then
        log "[RESTART] Container reiniciado com sucesso (exit code: 0)"
        log "[RESTART] Aguardando 30 segundos para inicialização..."
        sleep 30

        # Verificar se voltou a responder
        API_CHECK=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${API_URL}/" 2>/dev/null)
        log "[RESTART] Verificação pós-restart: API respondeu HTTP $API_CHECK"

        if [ "$API_CHECK" = "200" ]; then
            log "[RESTART] Container reiniciado e API respondendo normalmente"
        else
            log "[RESTART] ALERTA: Container reiniciado mas API não responde (HTTP: $API_CHECK)"
        fi
    else
        log "[RESTART] ERRO: Falha ao reiniciar container (exit code: $RESULT)"
    fi

    log "[RESTART] =========================================="
    return $RESULT
}

# Função para fazer rebuild completo (problema de detached frame)
rebuild_container() {
    log "[REBUILD] =========================================="
    log "[REBUILD] Iniciando rebuild completo do container..."
    log "[REBUILD] Motivo: Divergência detectada entre status-session e check-connection"
    log "[REBUILD] Isso geralmente indica problema de 'detached frame' no Puppeteer"
    log "[REBUILD] =========================================="

    cd "${SCRIPT_DIR}/ubuntu" || { log "[REBUILD] ERRO: Diretório ubuntu não encontrado em ${SCRIPT_DIR}"; return 1; }
    log "[REBUILD] Diretório de trabalho: $(pwd)"

    # Parar container
    log "[REBUILD] Etapa 1/4: Parando container..."
    log "[REBUILD] Comando: docker stop wppconnect-server"
    docker stop wppconnect-server 2>&1 | while read line; do log "[REBUILD][STOP] $line"; done
    log "[REBUILD] Container parado"

    # Remover container
    log "[REBUILD] Etapa 2/4: Removendo container..."
    log "[REBUILD] Comando: docker rm wppconnect-server"
    docker rm wppconnect-server 2>&1 | while read line; do log "[REBUILD][RM] $line"; done
    log "[REBUILD] Container removido"

    # Rebuild da imagem
    log "[REBUILD] Etapa 3/4: Reconstruindo imagem..."
    log "[REBUILD] Comando: docker compose -f wppconnect-build.yml build"
    log "[REBUILD] Isso pode demorar alguns minutos..."
    docker compose -f wppconnect-build.yml build 2>&1 | while read line; do log "[REBUILD][BUILD] $line"; done
    log "[REBUILD] Build concluído"

    # Subir container
    log "[REBUILD] Etapa 4/4: Iniciando container..."
    log "[REBUILD] Comando: docker compose -f wppconnect-build.yml up -d"
    docker compose -f wppconnect-build.yml up -d 2>&1 | while read line; do log "[REBUILD][UP] $line"; done
    log "[REBUILD] Container iniciado"

    # Aguardar inicialização
    log "[REBUILD] Aguardando 60 segundos para inicialização completa..."
    sleep 60

    # Verificar se voltou
    log "[REBUILD] Verificando se API está respondendo..."
    API_CHECK=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${API_URL}/" 2>/dev/null)

    if [ "$API_CHECK" = "200" ]; then
        log "[REBUILD] SUCESSO: Rebuild concluído - API respondendo (HTTP 200)"
        log "[REBUILD] =========================================="
        return 0
    else
        log "[REBUILD] ALERTA: Rebuild concluído mas API não responde (HTTP: $API_CHECK)"
        log "[REBUILD] Pode ser necessário verificar logs do container manualmente"
        log "[REBUILD] =========================================="
        return 1
    fi
}

# Função para verificar uma sessão específica
check_session() {
    local SESSION="$1"
    local TOKEN="$2"

    log "[SESSION] ------------------------------------------"
    log "[SESSION] Verificando sessão: $SESSION"

    # Verificar status-session
    log "[SESSION] Consultando: GET ${API_URL}/${SESSION}/status-session"
    STATUS_RESP=$(curl -s --max-time 10 \
        -H "Authorization: Bearer $TOKEN" \
        "${API_URL}/${SESSION}/status-session" 2>/dev/null)
    STATUS=$(echo "$STATUS_RESP" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
    log "[SESSION] Resposta status-session: status=$STATUS"
    log "[SESSION] Resposta completa: $STATUS_RESP"

    # Verificar check-connection-session
    log "[SESSION] Consultando: GET ${API_URL}/${SESSION}/check-connection-session"
    CHECK_RESP=$(curl -s --max-time 10 \
        -H "Authorization: Bearer $TOKEN" \
        "${API_URL}/${SESSION}/check-connection-session" 2>/dev/null)
    CHECK_STATUS=$(echo "$CHECK_RESP" | grep -o '"status":[^,}]*' | cut -d':' -f2 | tr -d ' ')
    CHECK_MSG=$(echo "$CHECK_RESP" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)
    log "[SESSION] Resposta check-connection: status=$CHECK_STATUS, message=$CHECK_MSG"
    log "[SESSION] Resposta completa: $CHECK_RESP"

    # Análise de divergência
    log "[SESSION] Análise: status-session=$STATUS | check-connection=$CHECK_STATUS ($CHECK_MSG)"

    # Detectar divergência: status diz CONNECTED mas check diz false/Disconnected
    if [ "$STATUS" = "CONNECTED" ]; then
        if [ "$CHECK_STATUS" = "false" ] || [ "$CHECK_MSG" = "Disconnected" ]; then
            log "[SESSION] DIVERGÊNCIA DETECTADA!"
            log "[SESSION] -> status-session diz CONNECTED"
            log "[SESSION] -> check-connection diz $CHECK_STATUS ($CHECK_MSG)"
            log "[SESSION] -> Isso indica problema de 'detached frame' no Puppeteer"
            log "[SESSION] ------------------------------------------"
            return 1  # Problema detectado
        else
            log "[SESSION] OK: Sessão conectada e funcionando normalmente"
        fi
    elif [ "$STATUS" = "DISCONNECTED" ] || [ "$STATUS" = "CLOSED" ]; then
        log "[SESSION] INFO: Sessão está desconectada (status=$STATUS)"
        log "[SESSION] Isso é esperado se o usuário desconectou manualmente"
    elif [ -z "$STATUS" ]; then
        log "[SESSION] ALERTA: Não foi possível obter status da sessão"
        log "[SESSION] Resposta vazia ou inválida da API"
    else
        log "[SESSION] INFO: Status da sessão: $STATUS"
    fi

    log "[SESSION] ------------------------------------------"
    return 0  # OK
}

# ==================== INÍCIO DA VERIFICAÇÃO ====================

log_separator
log "[MONITOR] =========================================="
log "[MONITOR] Iniciando verificação do WPPCONNECT"
log "[MONITOR] Script: $0"
log "[MONITOR] Diretório: $SCRIPT_DIR"
log "[MONITOR] API URL: $API_URL"
log "[MONITOR] Threshold divergências: $DIVERGENCE_THRESHOLD"
log "[MONITOR] =========================================="

# Etapa 1: Verificar se container está rodando
log "[ETAPA 1] Verificando status do container..."
log "[ETAPA 1] Comando: docker inspect -f '{{.State.Running}}' wppconnect-server"

CONTAINER_STATUS=$(docker inspect -f '{{.State.Running}}' wppconnect-server 2>/dev/null)
CONTAINER_EXISTS=$?

if [ $CONTAINER_EXISTS -ne 0 ]; then
    log "[ETAPA 1] ERRO: Container wppconnect-server não existe"
    log "[ETAPA 1] Ação: Tentando reiniciar..."
    restart_container
    echo "0" > "$DIVERGENCE_FILE"
    log "[MONITOR] Verificação encerrada (container não existia)"
    log_separator
    exit 0
fi

log "[ETAPA 1] Container existe. Estado: Running=$CONTAINER_STATUS"

if [ "$CONTAINER_STATUS" != "true" ]; then
    log "[ETAPA 1] PROBLEMA: Container não está rodando (Running=$CONTAINER_STATUS)"
    log "[ETAPA 1] Ação: Reiniciando container..."
    restart_container
    echo "0" > "$DIVERGENCE_FILE"
    log "[MONITOR] Verificação encerrada (container reiniciado)"
    log_separator
    exit 0
fi

log "[ETAPA 1] OK: Container está rodando"

# Etapa 2: Verificar se API responde
log "[ETAPA 2] Verificando se API responde..."
log "[ETAPA 2] URL: ${API_URL}/"
log "[ETAPA 2] Timeout: 10 segundos"

API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${API_URL}/" 2>/dev/null)
log "[ETAPA 2] Resposta HTTP: $API_STATUS"

if [ "$API_STATUS" != "200" ]; then
    log "[ETAPA 2] PROBLEMA: API não responde corretamente (HTTP: $API_STATUS)"
    log "[ETAPA 2] Possíveis causas:"
    log "[ETAPA 2]   - Serviço ainda inicializando"
    log "[ETAPA 2]   - Erro interno no servidor"
    log "[ETAPA 2]   - Problema de rede/porta"
    log "[ETAPA 2] Ação: Reiniciando container..."
    restart_container
    echo "0" > "$DIVERGENCE_FILE"
    log "[MONITOR] Verificação encerrada (API não respondia)"
    log_separator
    exit 0
fi

log "[ETAPA 2] OK: API respondendo (HTTP 200)"

# Etapa 3: Verificar sessões
log "[ETAPA 3] Verificando sessões existentes..."
TOKENS_DIR="${SCRIPT_DIR}/ubuntu/wppconnect-server/tokens"
log "[ETAPA 3] Diretório de tokens: $TOKENS_DIR"

SESSION_DIVERGENCE=0
SESSIONS_CHECKED=0
SESSIONS_OK=0
SESSIONS_DIVERGENT=0

if [ -d "$TOKENS_DIR" ]; then
    TOKEN_FILES=$(ls -1 "$TOKENS_DIR"/*.data.json 2>/dev/null | wc -l)
    log "[ETAPA 3] Arquivos de token encontrados: $TOKEN_FILES"

    if [ "$TOKEN_FILES" -eq 0 ]; then
        log "[ETAPA 3] Nenhuma sessão ativa para verificar"
    else
        for TOKEN_FILE in "$TOKENS_DIR"/*.data.json; do
            [ -e "$TOKEN_FILE" ] || continue  # Pular se não existir

            # Extrair nome da sessão do arquivo
            SESSION_NAME=$(basename "$TOKEN_FILE" .data.json)
            log "[ETAPA 3] Processando arquivo: $(basename "$TOKEN_FILE")"

            # Extrair token do arquivo
            TOKEN=$(grep -o '"token":"[^"]*"' "$TOKEN_FILE" 2>/dev/null | cut -d'"' -f4)

            if [ -z "$TOKEN" ]; then
                log "[ETAPA 3] ALERTA: Token não encontrado no arquivo $TOKEN_FILE"
                continue
            fi

            if [ -z "$SESSION_NAME" ]; then
                log "[ETAPA 3] ALERTA: Nome da sessão não identificado"
                continue
            fi

            log "[ETAPA 3] Sessão: $SESSION_NAME | Token: ${TOKEN:0:20}..."

            SESSIONS_CHECKED=$((SESSIONS_CHECKED + 1))

            if ! check_session "$SESSION_NAME" "$TOKEN"; then
                SESSION_DIVERGENCE=1
                SESSIONS_DIVERGENT=$((SESSIONS_DIVERGENT + 1))
            else
                SESSIONS_OK=$((SESSIONS_OK + 1))
            fi
        done
    fi
else
    log "[ETAPA 3] ALERTA: Diretório de tokens não encontrado: $TOKENS_DIR"
    log "[ETAPA 3] Isso pode indicar que nenhuma sessão foi criada ainda"
fi

log "[ETAPA 3] Resumo: $SESSIONS_CHECKED sessões verificadas | $SESSIONS_OK OK | $SESSIONS_DIVERGENT com divergência"

# Etapa 4: Avaliar resultados e tomar ação
log "[ETAPA 4] Avaliando resultados..."

CURRENT_DIVERGENCE=$(cat "$DIVERGENCE_FILE" 2>/dev/null || echo "0")
log "[ETAPA 4] Contador atual de divergências: $CURRENT_DIVERGENCE"

if [ "$SESSION_DIVERGENCE" -eq 1 ]; then
    DIVERGENCE_COUNT=$((CURRENT_DIVERGENCE + 1))
    echo "$DIVERGENCE_COUNT" > "$DIVERGENCE_FILE"

    log "[ETAPA 4] PROBLEMA: Divergência detectada em $SESSIONS_DIVERGENT sessão(ões)"
    log "[ETAPA 4] Contador atualizado: $DIVERGENCE_COUNT/$DIVERGENCE_THRESHOLD"

    if [ "$DIVERGENCE_COUNT" -ge "$DIVERGENCE_THRESHOLD" ]; then
        log "[ETAPA 4] AÇÃO: Threshold atingido ($DIVERGENCE_COUNT >= $DIVERGENCE_THRESHOLD)"
        log "[ETAPA 4] Iniciando REBUILD completo do container..."
        rebuild_container
        echo "0" > "$DIVERGENCE_FILE"
        log "[ETAPA 4] Contador de divergências resetado para 0"
    else
        log "[ETAPA 4] AGUARDANDO: Divergência $DIVERGENCE_COUNT de $DIVERGENCE_THRESHOLD"
        log "[ETAPA 4] Rebuild será executado após $((DIVERGENCE_THRESHOLD - DIVERGENCE_COUNT)) verificação(ões) com problema"
    fi
else
    if [ "$CURRENT_DIVERGENCE" != "0" ]; then
        log "[ETAPA 4] RECUPERADO: Sistema voltou ao normal"
        log "[ETAPA 4] Contador anterior: $CURRENT_DIVERGENCE -> resetando para 0"
    else
        log "[ETAPA 4] OK: Nenhuma divergência detectada"
    fi
    echo "0" > "$DIVERGENCE_FILE"
fi

# Finalização
log "[MONITOR] =========================================="
log "[MONITOR] Verificação concluída"
log "[MONITOR] Status final:"
log "[MONITOR]   - Container: Rodando"
log "[MONITOR]   - API: Respondendo (HTTP 200)"
log "[MONITOR]   - Sessões verificadas: $SESSIONS_CHECKED"
log "[MONITOR]   - Sessões OK: $SESSIONS_OK"
log "[MONITOR]   - Sessões com divergência: $SESSIONS_DIVERGENT"
log "[MONITOR]   - Contador divergências: $(cat "$DIVERGENCE_FILE" 2>/dev/null || echo "0")/$DIVERGENCE_THRESHOLD"
log "[MONITOR] =========================================="
log_separator
