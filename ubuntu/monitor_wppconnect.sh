#!/bin/bash
# =============================================================================
# Monitor WPPCONNECT - Verifica sessões e faz restart/rebuild se necessário
# Localização no servidor: /Docker/ubuntu/monitor_wppconnect.sh
#
# Lógica de verificação:
# 1. Container não UP → docker restart (solução rápida)
# 2. API não retorna 200 → docker restart (solução rápida)
# 3. Divergência status-session vs check-connection → rebuild completo
#    (detecta problema de detached frame no Puppeteer)
#
# Obtenção de tokens:
# - Os tokens das sessões são obtidos do banco SQLite do Django
# - Tabela: cadastros_sessaowpp (campos: usuario, token, is_active)
# - Configure DB_PATH abaixo com o caminho correto do banco
#
# Pré-requisitos:
# - sqlite3 instalado (apt-get install sqlite3)
# - Acesso de leitura ao banco de dados Django
#
# Uso:
#   chmod +x /Docker/ubuntu/monitor_wppconnect.sh
#   Adicionar ao crontab: */10 * * * * /Docker/ubuntu/monitor_wppconnect.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOGFILE="${SCRIPT_DIR}/logs/wppconnect_monitor.log"
DIVERGENCE_FILE="/tmp/wppconnect_divergence_count"
API_URL="http://api.nossopainel.com.br/api"
DIVERGENCE_THRESHOLD=3  # Divergências consecutivas antes de rebuild

# Caminho do banco de dados SQLite do Django (onde os tokens estão armazenados)
# Ajuste conforme a localização no seu servidor
DB_PATH="${SCRIPT_DIR}/nossopainel-django/database/db.sqlite3"

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

        # Qualquer resposta exceto 000 ou 5xx significa que a API está UP
        if [ "$API_CHECK" != "000" ] && [ "$API_CHECK" -lt 500 ] 2>/dev/null; then
            log "[RESTART] Container reiniciado e API respondendo (HTTP $API_CHECK)"
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

    # Detectar diretório do docker-compose automaticamente
    COMPOSE_DIR=""
    if [ -f "${SCRIPT_DIR}/wppconnect-build.yml" ]; then
        COMPOSE_DIR="${SCRIPT_DIR}"
    elif [ -f "${SCRIPT_DIR}/../wppconnect-build.yml" ]; then
        COMPOSE_DIR="${SCRIPT_DIR}/.."
    else
        log "[REBUILD] ERRO: Não foi possível encontrar wppconnect-build.yml"
        log "[REBUILD] Locais verificados:"
        log "[REBUILD]   - ${SCRIPT_DIR}/wppconnect-build.yml"
        log "[REBUILD]   - ${SCRIPT_DIR}/../wppconnect-build.yml"
        return 1
    fi

    cd "$COMPOSE_DIR" || { log "[REBUILD] ERRO: Não foi possível acessar $COMPOSE_DIR"; return 1; }
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
    log "[REBUILD] Resposta HTTP: $API_CHECK"

    # Qualquer resposta exceto 000 ou 5xx significa que a API está UP
    if [ "$API_CHECK" != "000" ] && [ "$API_CHECK" -lt 500 ] 2>/dev/null; then
        log "[REBUILD] SUCESSO: Rebuild concluído - API respondendo (HTTP $API_CHECK)"
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

# Avaliar resposta:
# - 000 = Falha de conexão (curl não conseguiu conectar)
# - 5xx = Erro interno do servidor
# - 200, 404, 401, 403 = API está respondendo (servidor está UP)
#
# Nota: 404 na rota raiz /api/ é normal - significa que a API está UP mas não tem rota nesse path

API_IS_DOWN=false

if [ "$API_STATUS" = "000" ]; then
    log "[ETAPA 2] PROBLEMA: Falha de conexão (HTTP 000)"
    log "[ETAPA 2] Possíveis causas:"
    log "[ETAPA 2]   - Container não está expondo a porta"
    log "[ETAPA 2]   - Problema de rede/DNS"
    log "[ETAPA 2]   - Timeout de conexão"
    API_IS_DOWN=true
elif [ "$API_STATUS" -ge 500 ] 2>/dev/null; then
    log "[ETAPA 2] PROBLEMA: Erro interno do servidor (HTTP $API_STATUS)"
    log "[ETAPA 2] Possíveis causas:"
    log "[ETAPA 2]   - Serviço com erro fatal"
    log "[ETAPA 2]   - Falta de memória/recursos"
    API_IS_DOWN=true
elif [ -z "$API_STATUS" ]; then
    log "[ETAPA 2] PROBLEMA: Resposta vazia do curl"
    API_IS_DOWN=true
fi

if [ "$API_IS_DOWN" = true ]; then
    log "[ETAPA 2] Ação: Reiniciando container..."
    restart_container
    echo "0" > "$DIVERGENCE_FILE"
    log "[MONITOR] Verificação encerrada (API não respondia)"
    log_separator
    exit 0
fi

# API está respondendo (qualquer código 1xx-4xx é válido)
log "[ETAPA 2] OK: API respondendo (HTTP $API_STATUS)"
if [ "$API_STATUS" = "404" ]; then
    log "[ETAPA 2] Nota: 404 na rota raiz é normal - a API está UP, apenas não tem handler nesse path"
fi

# Etapa 3: Verificar sessões (obtendo tokens do banco de dados Django)
log "[ETAPA 3] Verificando sessões existentes..."
log "[ETAPA 3] Banco de dados: $DB_PATH"

SESSION_DIVERGENCE=0
SESSIONS_CHECKED=0
SESSIONS_OK=0
SESSIONS_DIVERGENT=0

# Verificar se o banco de dados existe
if [ ! -f "$DB_PATH" ]; then
    log "[ETAPA 3] ERRO: Banco de dados não encontrado: $DB_PATH"
    log "[ETAPA 3] Verifique o caminho DB_PATH no início do script"
    log "[ETAPA 3] Possíveis localizações:"
    log "[ETAPA 3]   - ${SCRIPT_DIR}/nossopainel-django/database/db.sqlite3"
    log "[ETAPA 3]   - /root/Docker/ubuntu/nossopainel-django/database/db.sqlite3"
else
    # Verificar se sqlite3 está instalado
    if ! command -v sqlite3 &> /dev/null; then
        log "[ETAPA 3] ERRO: sqlite3 não está instalado"
        log "[ETAPA 3] Instale com: apt-get install sqlite3"
    else
        # Consultar sessões ativas no banco Django
        # Tabela: cadastros_sessaowpp | Campos: usuario, token, is_active
        log "[ETAPA 3] Consultando sessões ativas no banco Django..."

        QUERY="SELECT usuario, token FROM cadastros_sessaowpp WHERE is_active = 1;"
        SESSIONS_DATA=$(sqlite3 -separator '|' "$DB_PATH" "$QUERY" 2>/dev/null)

        if [ -z "$SESSIONS_DATA" ]; then
            log "[ETAPA 3] Nenhuma sessão ativa encontrada no banco"
        else
            # Contar sessões
            TOTAL_SESSIONS=$(echo "$SESSIONS_DATA" | wc -l)
            log "[ETAPA 3] Sessões ativas encontradas: $TOTAL_SESSIONS"

            # Limpar arquivos temporários de contagem
            rm -f /tmp/wppconnect_session_divergence /tmp/wppconnect_sessions_ok /tmp/wppconnect_sessions_divergent
            echo "0" > /tmp/wppconnect_sessions_ok
            echo "0" > /tmp/wppconnect_sessions_divergent

            # Iterar sobre cada sessão (formato: usuario|token)
            echo "$SESSIONS_DATA" | while IFS='|' read -r SESSION_NAME TOKEN; do
                if [ -z "$SESSION_NAME" ] || [ -z "$TOKEN" ]; then
                    log "[ETAPA 3] ALERTA: Linha inválida no resultado da consulta"
                    continue
                fi

                log "[ETAPA 3] Sessão: $SESSION_NAME | Token: ${TOKEN:0:20}..."

                if ! check_session "$SESSION_NAME" "$TOKEN"; then
                    # Gravar flags em arquivos temporários (necessário por causa do subshell)
                    echo "1" > /tmp/wppconnect_session_divergence
                    # Incrementar contador de divergentes
                    COUNT=$(cat /tmp/wppconnect_sessions_divergent)
                    echo $((COUNT + 1)) > /tmp/wppconnect_sessions_divergent
                else
                    # Incrementar contador de OK
                    COUNT=$(cat /tmp/wppconnect_sessions_ok)
                    echo $((COUNT + 1)) > /tmp/wppconnect_sessions_ok
                fi
            done

            # Recuperar contadores do subshell
            if [ -f /tmp/wppconnect_session_divergence ]; then
                SESSION_DIVERGENCE=1
                rm -f /tmp/wppconnect_session_divergence
            fi
            SESSIONS_OK=$(cat /tmp/wppconnect_sessions_ok 2>/dev/null || echo "0")
            SESSIONS_DIVERGENT=$(cat /tmp/wppconnect_sessions_divergent 2>/dev/null || echo "0")
            rm -f /tmp/wppconnect_sessions_ok /tmp/wppconnect_sessions_divergent

            # Contar sessões verificadas
            SESSIONS_CHECKED=$(echo "$SESSIONS_DATA" | wc -l)
        fi
    fi
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
log "[MONITOR]   - API: Respondendo (HTTP $API_STATUS)"
log "[MONITOR]   - Sessões verificadas: $SESSIONS_CHECKED"
log "[MONITOR]   - Sessões OK: $SESSIONS_OK"
log "[MONITOR]   - Sessões com divergência: $SESSIONS_DIVERGENT"
log "[MONITOR]   - Contador divergências: $(cat "$DIVERGENCE_FILE" 2>/dev/null || echo "0")/$DIVERGENCE_THRESHOLD"
log "[MONITOR] =========================================="
log_separator
