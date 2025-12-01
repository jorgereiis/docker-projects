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

# =============================================================================
# CONFIGURAÇÃO DE LOGS DUAL
# =============================================================================
# DEBUG_LOG: Log detalhado com todas as operações, respostas da API, etc.
# MONITOR_LOG: Log estruturado com resumo executivo de cada ciclo
DEBUG_LOG="${SCRIPT_DIR}/logs/wppconnect_debug.log"
MONITOR_LOG="${SCRIPT_DIR}/logs/wppconnect_monitor.log"

# Arquivos de controle
DIVERGENCE_FILE="/tmp/wppconnect_divergence_count"
CYCLE_COUNT_FILE="/tmp/wppconnect_cycle_count"

# Configurações da API
API_URL="http://api.nossopainel.com.br/api"
DIVERGENCE_THRESHOLD=3  # Divergências consecutivas antes de rebuild

# Caminho do banco de dados SQLite do Django (onde os tokens estão armazenados)
DB_PATH="${SCRIPT_DIR}/nossopainel-django/database/db.sqlite3"

# =============================================================================
# ARRAYS PARA RASTREAMENTO DE SESSÕES
# =============================================================================
declare -a SESSIONS_CONNECTED=()
declare -a SESSIONS_DISCONNECTED=()
declare -a SESSIONS_DIVERGENT=()
declare -a SESSIONS_ERROR=()

# =============================================================================
# FLAGS DE ESTADO DO CICLO
# =============================================================================
FLAG_CONTAINER_RESTARTED=false
FLAG_CONTAINER_REBUILT=false
FLAG_API_ERROR=false
FLAG_CLOUDFLARE_ERROR=false
FLAG_INTERNAL_ERROR=false
CONTAINER_STATUS_TEXT="UNKNOWN"
API_STATUS_TEXT="UNKNOWN"

# Criar diretório de logs se não existir
mkdir -p "${SCRIPT_DIR}/logs"

# =============================================================================
# FUNÇÕES DE LOGGING DUAL
# =============================================================================

# Log apenas para debug (detalhado)
log_debug() {
    local message="$1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [DEBUG] $message" >> "$DEBUG_LOG"
}

# Log apenas para monitor (resumo estruturado)
log_monitor() {
    local message="$1"
    echo "$message" >> "$MONITOR_LOG"
}

# Log para ambos os arquivos
log_both() {
    local level="$1"
    local message="$2"
    local formatted="[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $message"
    echo "$formatted" >> "$DEBUG_LOG"
    # Para o monitor, logar apenas se for INFO, WARN ou ERROR
    if [[ "$level" != "DEBUG" ]]; then
        echo "$formatted" >> "$MONITOR_LOG"
    fi
}

# Função legada para compatibilidade (redireciona para debug)
log() {
    log_debug "$1"
}

# Função para separador visual no log de debug
log_separator() {
    echo "============================================================" >> "$DEBUG_LOG"
}

# =============================================================================
# FUNÇÕES AUXILIARES
# =============================================================================

# Converter boolean para texto SIM/NÃO
bool_to_text() {
    if [[ "$1" == "true" ]]; then
        echo "SIM"
    else
        echo "NÃO"
    fi
}

# Obter número do ciclo atual
get_cycle_number() {
    local cycle=$(cat "$CYCLE_COUNT_FILE" 2>/dev/null || echo "0")
    cycle=$((cycle + 1))
    echo "$cycle" > "$CYCLE_COUNT_FILE"
    echo "$cycle"
}

# Reset do estado do ciclo
reset_cycle_state() {
    SESSIONS_CONNECTED=()
    SESSIONS_DISCONNECTED=()
    SESSIONS_DIVERGENT=()
    SESSIONS_ERROR=()
    FLAG_CONTAINER_RESTARTED=false
    FLAG_CONTAINER_REBUILT=false
    FLAG_API_ERROR=false
    FLAG_CLOUDFLARE_ERROR=false
    FLAG_INTERNAL_ERROR=false
    CONTAINER_STATUS_TEXT="UNKNOWN"
    API_STATUS_TEXT="UNKNOWN"
}

# Detectar se erro é relacionado ao Cloudflare
is_cloudflare_error() {
    local response="$1"
    local status_code="$2"

    # HTTP 520-527 são erros específicos Cloudflare
    if [[ "$status_code" =~ ^5[2][0-7]$ ]]; then
        return 0
    fi

    # Verificar ray-id ou classes cf- no HTML/resposta
    if echo "$response" | grep -qiE "(cf-ray|cloudflare|__cf_|cf-browser-verification|cf-error)"; then
        return 0
    fi

    return 1
}

# Detectar se erro é interno da API/container
is_internal_error() {
    local response="$1"
    local status_code="$2"

    # HTTP 500-519 são erros internos do servidor
    if [[ "$status_code" =~ ^5[01][0-9]$ ]]; then
        return 0
    fi

    # Verificar mensagens de erro comuns
    if echo "$response" | grep -qiE "(internal server error|exception|traceback|puppeteer|detached frame)"; then
        return 0
    fi

    return 1
}

# Obter status final do ciclo
get_final_status() {
    local divergent_count=${#SESSIONS_DIVERGENT[@]}
    local disconnected_count=${#SESSIONS_DISCONNECTED[@]}
    local error_count=${#SESSIONS_ERROR[@]}

    if [[ "$FLAG_CONTAINER_REBUILT" == "true" ]]; then
        echo "REBUILD EXECUTADO"
    elif [[ "$FLAG_CONTAINER_RESTARTED" == "true" ]]; then
        echo "RESTART EXECUTADO"
    elif [[ "$FLAG_API_ERROR" == "true" ]]; then
        echo "ERRO NA API"
    elif [[ $divergent_count -gt 0 ]]; then
        echo "DIVERGÊNCIAS DETECTADAS ($divergent_count)"
    elif [[ $error_count -gt 0 ]]; then
        echo "ERROS EM SESSÕES ($error_count)"
    elif [[ $disconnected_count -gt 0 ]]; then
        echo "OK - Com sessões desconectadas ($disconnected_count)"
    else
        echo "OK"
    fi
}

# Escrever resultado estruturado no log de monitoramento
write_monitor_result() {
    local cycle_number="$1"
    local total_sessions=$((${#SESSIONS_CONNECTED[@]} + ${#SESSIONS_DISCONNECTED[@]} + ${#SESSIONS_DIVERGENT[@]} + ${#SESSIONS_ERROR[@]}))

    # Formatar listas de sessões
    local connected_list="${SESSIONS_CONNECTED[*]:-nenhuma}"
    local disconnected_list="${SESSIONS_DISCONNECTED[*]:-nenhuma}"
    local divergent_list="${SESSIONS_DIVERGENT[*]:-nenhuma}"
    local error_list="${SESSIONS_ERROR[*]:-nenhuma}"

    # Construir bloco de resultado estruturado
    {
        echo "================================================================================"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] CICLO DE MONITORAMENTO #$cycle_number"
        echo "================================================================================"
        echo ""
        echo "CONTAINER"
        echo "├─ Status: $CONTAINER_STATUS_TEXT"
        echo "├─ Reiniciado: $(bool_to_text $FLAG_CONTAINER_RESTARTED)"
        echo "└─ Reconstruído: $(bool_to_text $FLAG_CONTAINER_REBUILT)"
        echo ""
        echo "API"
        echo "├─ Status: $API_STATUS_TEXT"
        echo "├─ Erro: $(bool_to_text $FLAG_API_ERROR)"
        echo "├─ Cloudflare: $(bool_to_text $FLAG_CLOUDFLARE_ERROR)"
        echo "└─ Erro Interno: $(bool_to_text $FLAG_INTERNAL_ERROR)"
        echo ""
        echo "SESSÕES"
        echo "├─ Total Verificadas: $total_sessions"
        echo "├─ CONECTADAS (${#SESSIONS_CONNECTED[@]}): $connected_list"
        echo "├─ DESCONECTADAS (${#SESSIONS_DISCONNECTED[@]}): $disconnected_list"
        echo "├─ DIVERGENTES (${#SESSIONS_DIVERGENT[@]}): $divergent_list"
        echo "└─ COM ERRO (${#SESSIONS_ERROR[@]}): $error_list"
        echo ""
        echo "RESULTADO: $(get_final_status)"
        echo "================================================================================"
        echo ""
    } >> "$MONITOR_LOG"
}

# Rotação do log de debug (manter últimos 7 dias, max 100MB)
rotate_debug_log() {
    if [[ -f "$DEBUG_LOG" ]]; then
        local size=$(stat -c%s "$DEBUG_LOG" 2>/dev/null || stat -f%z "$DEBUG_LOG" 2>/dev/null || echo "0")
        if [[ $size -gt 104857600 ]]; then  # 100MB
            local backup_name="${DEBUG_LOG}.$(date +%Y%m%d_%H%M%S)"
            mv "$DEBUG_LOG" "$backup_name"
            gzip "$backup_name" 2>/dev/null
            # Limpar backups antigos (manter últimos 7 dias)
            find "$(dirname $DEBUG_LOG)" -name "wppconnect_debug.log.*.gz" -mtime +7 -delete 2>/dev/null
            log_debug "Log de debug rotacionado: $backup_name.gz"
        fi
    fi
}

# Rotação do log de monitor (manter últimos 30 dias, max 10MB)
rotate_monitor_log() {
    if [[ -f "$MONITOR_LOG" ]]; then
        local size=$(stat -c%s "$MONITOR_LOG" 2>/dev/null || stat -f%z "$MONITOR_LOG" 2>/dev/null || echo "0")
        if [[ $size -gt 10485760 ]]; then  # 10MB
            local backup_name="${MONITOR_LOG}.$(date +%Y%m%d_%H%M%S)"
            mv "$MONITOR_LOG" "$backup_name"
            gzip "$backup_name" 2>/dev/null
            # Limpar backups antigos (manter últimos 30 dias)
            find "$(dirname $MONITOR_LOG)" -name "wppconnect_monitor.log.*.gz" -mtime +30 -delete 2>/dev/null
            log_debug "Log de monitor rotacionado: $backup_name.gz"
        fi
    fi
}

# Função para enviar notificação WhatsApp após rebuild
send_notification() {
    local RESULTADO="$1"  # "sucesso" ou "falha"
    local MOTIVO="$2"     # Descrição do motivo do rebuild
    local SESSOES_PROBLEMA="$3"  # Lista de sessões que causaram o rebuild

    log "[NOTIFY] =========================================="
    log "[NOTIFY] Preparando notificação WhatsApp..."

    # Carregar variáveis do .env do Django
    DJANGO_ENV="${SCRIPT_DIR}/nossopainel-django/.env"
    if [ ! -f "$DJANGO_ENV" ]; then
        log "[NOTIFY] ERRO: Arquivo .env do Django não encontrado: $DJANGO_ENV"
        return 1
    fi

    # Extrair MEU_NUM_TIM e URL_API_WPP do .env
    TELEFONE_ADMIN=$(grep -E "^MEU_NUM_TIM" "$DJANGO_ENV" | cut -d'"' -f2)
    API_URL_WPP=$(grep -E "^URL_API_WPP" "$DJANGO_ENV" | cut -d"'" -f2)

    if [ -z "$TELEFONE_ADMIN" ]; then
        log "[NOTIFY] ERRO: MEU_NUM_TIM não encontrado no .env"
        return 1
    fi

    log "[NOTIFY] Telefone destino: $TELEFONE_ADMIN"
    log "[NOTIFY] API URL: $API_URL_WPP"

    # Buscar sessão ativa para enviar (prioridade: jrg, depois qualquer outra)
    local NOTIFY_SESSION=""
    local NOTIFY_TOKEN=""

    # Primeiro tenta sessão "jrg"
    local JRG_TOKEN=$(sqlite3 "$DB_PATH" \
        "SELECT token FROM cadastros_sessaowpp WHERE usuario = 'jrg' AND is_active = 1;" 2>/dev/null)

    if [ -n "$JRG_TOKEN" ]; then
        # Verificar se jrg está realmente conectada
        local JRG_CHECK=$(curl -s --max-time 10 \
            -H "Authorization: Bearer $JRG_TOKEN" \
            "${API_URL_WPP}/jrg/check-connection-session" 2>/dev/null)

        if echo "$JRG_CHECK" | grep -q '"status":true'; then
            NOTIFY_SESSION="jrg"
            NOTIFY_TOKEN="$JRG_TOKEN"
            log "[NOTIFY] Usando sessão preferencial: jrg"
        fi
    fi

    # Se jrg não está disponível, buscar qualquer sessão conectada
    if [ -z "$NOTIFY_SESSION" ]; then
        log "[NOTIFY] Sessão jrg não disponível, buscando alternativa..."

        local SESSIONS=$(sqlite3 -separator '|' "$DB_PATH" \
            "SELECT usuario, token FROM cadastros_sessaowpp WHERE is_active = 1;" 2>/dev/null)

        while IFS='|' read -r SESS_NAME SESS_TOKEN; do
            [ -z "$SESS_NAME" ] && continue

            # Verificar se esta sessão está conectada
            local SESS_CHECK=$(curl -s --max-time 10 \
                -H "Authorization: Bearer $SESS_TOKEN" \
                "${API_URL_WPP}/${SESS_NAME}/check-connection-session" 2>/dev/null)

            if echo "$SESS_CHECK" | grep -q '"status":true'; then
                NOTIFY_SESSION="$SESS_NAME"
                NOTIFY_TOKEN="$SESS_TOKEN"
                log "[NOTIFY] Usando sessão alternativa: $NOTIFY_SESSION"
                break
            fi
        done <<< "$SESSIONS"
    fi

    # Se nenhuma sessão disponível
    if [ -z "$NOTIFY_SESSION" ]; then
        log "[NOTIFY] ERRO: Nenhuma sessão WhatsApp conectada para enviar notificação"
        log "[NOTIFY] =========================================="
        return 1
    fi

    # Montar mensagem
    local TIMESTAMP=$(date '+%d/%m/%Y às %H:%M:%S')
    local EMOJI STATUS_MSG

    if [ "$RESULTADO" = "sucesso" ]; then
        EMOJI="✅"
        STATUS_MSG="REBUILD CONCLUÍDO COM SUCESSO"
    else
        EMOJI="❌"
        STATUS_MSG="REBUILD FALHOU"
    fi

    # Formatar lista de sessões com problema
    local SESSOES_FORMATADAS
    if [ -n "$SESSOES_PROBLEMA" ]; then
        SESSOES_FORMATADAS=$(echo "$SESSOES_PROBLEMA" | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g')
    else
        SESSOES_FORMATADAS="Não identificadas"
    fi

    # Montar mensagem (usando heredoc para preservar formatação)
    local MENSAGEM=$(cat <<EOF
🔧 *WPPCONNECT - MANUTENÇÃO AUTOMÁTICA*

$EMOJI *$STATUS_MSG*

📅 *Data/Hora:* $TIMESTAMP

⚠️ *Sessões com problema:* $SESSOES_FORMATADAS

📋 *Motivo:*
$MOTIVO

🖥️ *Sessão usada para notificação:* $NOTIFY_SESSION

---
_Mensagem automática do monitor WPPCONNECT_
EOF
)

    # Enviar mensagem via API
    log "[NOTIFY] Enviando mensagem para $TELEFONE_ADMIN via sessão $NOTIFY_SESSION..."

    # Escapar caracteres especiais para JSON
    local MENSAGEM_JSON=$(echo "$MENSAGEM" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')

    local SEND_RESP=$(curl -s --max-time 30 \
        -X POST "${API_URL_WPP}/${NOTIFY_SESSION}/send-message" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $NOTIFY_TOKEN" \
        -d "{\"phone\": \"$TELEFONE_ADMIN\", \"message\": \"$MENSAGEM_JSON\"}" 2>/dev/null)

    log "[NOTIFY] Resposta da API: $SEND_RESP"

    if echo "$SEND_RESP" | grep -qE '"status"\s*:\s*(true|"success")'; then
        log "[NOTIFY] SUCESSO: Notificação enviada para $TELEFONE_ADMIN"
        log "[NOTIFY] =========================================="
        return 0
    else
        log "[NOTIFY] FALHA: Não foi possível enviar notificação"
        log "[NOTIFY] =========================================="
        return 1
    fi
}

# Função para reiniciar container (solução rápida)
restart_container() {
    log_debug "[RESTART] =========================================="
    log_debug "[RESTART] Iniciando reinicialização do container..."
    log_debug "[RESTART] Comando: docker restart wppconnect-server"

    docker restart wppconnect-server
    RESULT=$?

    if [ $RESULT -eq 0 ]; then
        FLAG_CONTAINER_RESTARTED=true
        log_debug "[RESTART] Container reiniciado com sucesso (exit code: 0)"
        log_debug "[RESTART] Aguardando 30 segundos para inicialização..."
        sleep 30

        # Verificar se voltou a responder
        API_CHECK=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${API_URL}/" 2>/dev/null)
        log_debug "[RESTART] Verificação pós-restart: API respondeu HTTP $API_CHECK"

        # Qualquer resposta exceto 000 ou 5xx significa que a API está UP
        if [ "$API_CHECK" != "000" ] && [ "$API_CHECK" -lt 500 ] 2>/dev/null; then
            log_debug "[RESTART] Container reiniciado e API respondendo (HTTP $API_CHECK)"
            API_STATUS_TEXT="OK (HTTP $API_CHECK) - Pós-restart"
        else
            log_debug "[RESTART] ALERTA: Container reiniciado mas API não responde (HTTP: $API_CHECK)"
            API_STATUS_TEXT="FALHA (HTTP $API_CHECK) - Pós-restart"
        fi
    else
        log_debug "[RESTART] ERRO: Falha ao reiniciar container (exit code: $RESULT)"
    fi

    log_debug "[RESTART] =========================================="
    return $RESULT
}

# Função para fazer rebuild completo (problema de detached frame)
rebuild_container() {
    log_debug "[REBUILD] =========================================="
    log_debug "[REBUILD] Iniciando rebuild completo do container..."
    log_debug "[REBUILD] Motivo: Divergência detectada entre status-session e check-connection"
    log_debug "[REBUILD] Isso geralmente indica problema de 'detached frame' no Puppeteer"
    log_debug "[REBUILD] =========================================="

    FLAG_CONTAINER_REBUILT=true

    # Detectar diretório do docker-compose automaticamente
    COMPOSE_DIR=""
    if [ -f "${SCRIPT_DIR}/wppconnect-build.yml" ]; then
        COMPOSE_DIR="${SCRIPT_DIR}"
    elif [ -f "${SCRIPT_DIR}/../wppconnect-build.yml" ]; then
        COMPOSE_DIR="${SCRIPT_DIR}/.."
    else
        log_debug "[REBUILD] ERRO: Não foi possível encontrar wppconnect-build.yml"
        log_debug "[REBUILD] Locais verificados:"
        log_debug "[REBUILD]   - ${SCRIPT_DIR}/wppconnect-build.yml"
        log_debug "[REBUILD]   - ${SCRIPT_DIR}/../wppconnect-build.yml"
        return 1
    fi

    cd "$COMPOSE_DIR" || { log_debug "[REBUILD] ERRO: Não foi possível acessar $COMPOSE_DIR"; return 1; }
    log_debug "[REBUILD] Diretório de trabalho: $(pwd)"

    # Parar container
    log_debug "[REBUILD] Etapa 1/4: Parando container..."
    log_debug "[REBUILD] Comando: docker stop wppconnect-server"
    docker stop wppconnect-server 2>&1 | while read line; do log_debug "[REBUILD][STOP] $line"; done
    log_debug "[REBUILD] Container parado"

    # Remover container
    log_debug "[REBUILD] Etapa 2/4: Removendo container..."
    log_debug "[REBUILD] Comando: docker rm wppconnect-server"
    docker rm wppconnect-server 2>&1 | while read line; do log_debug "[REBUILD][RM] $line"; done
    log_debug "[REBUILD] Container removido"

    # Rebuild da imagem
    log_debug "[REBUILD] Etapa 3/4: Reconstruindo imagem..."
    log_debug "[REBUILD] Comando: docker compose -f wppconnect-build.yml build"
    log_debug "[REBUILD] Isso pode demorar alguns minutos..."
    docker compose -f wppconnect-build.yml build 2>&1 | while read line; do log_debug "[REBUILD][BUILD] $line"; done
    log_debug "[REBUILD] Build concluído"

    # Subir container
    log_debug "[REBUILD] Etapa 4/4: Iniciando container..."
    log_debug "[REBUILD] Comando: docker compose -f wppconnect-build.yml up -d"
    docker compose -f wppconnect-build.yml up -d 2>&1 | while read line; do log_debug "[REBUILD][UP] $line"; done
    log_debug "[REBUILD] Container iniciado"

    # Aguardar inicialização
    log_debug "[REBUILD] Aguardando 60 segundos para inicialização completa..."
    sleep 60

    # Verificar se voltou
    log_debug "[REBUILD] Verificando se API está respondendo..."
    API_CHECK=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${API_URL}/" 2>/dev/null)
    log_debug "[REBUILD] Resposta HTTP: $API_CHECK"

    # Qualquer resposta exceto 000 ou 5xx significa que a API está UP
    if [ "$API_CHECK" != "000" ] && [ "$API_CHECK" -lt 500 ] 2>/dev/null; then
        log_debug "[REBUILD] SUCESSO: Rebuild concluído - API respondendo (HTTP $API_CHECK)"
        API_STATUS_TEXT="OK (HTTP $API_CHECK) - Pós-rebuild"

        # Aguardar mais 30s para sessões reconectarem antes de enviar notificação
        log_debug "[REBUILD] Aguardando 30 segundos para sessões reconectarem..."
        sleep 30

        # Ler sessões que causaram o problema
        local SESSOES_PROBLEMA=""
        if [ -f /tmp/wppconnect_divergent_sessions ]; then
            SESSOES_PROBLEMA=$(cat /tmp/wppconnect_divergent_sessions)
            log_debug "[REBUILD] Sessões que causaram rebuild: $SESSOES_PROBLEMA"
        fi

        # Enviar notificação de sucesso
        local MOTIVO="Divergência detectada entre status-session e check-connection (problema de detached frame no Puppeteer). O container foi reconstruído automaticamente para restaurar a funcionalidade."
        send_notification "sucesso" "$MOTIVO" "$SESSOES_PROBLEMA"

        log_debug "[REBUILD] =========================================="
        return 0
    else
        log_debug "[REBUILD] ALERTA: Rebuild concluído mas API não responde (HTTP: $API_CHECK)"
        log_debug "[REBUILD] Pode ser necessário verificar logs do container manualmente"
        API_STATUS_TEXT="FALHA (HTTP $API_CHECK) - Pós-rebuild"

        # Ler sessões que causaram o problema
        local SESSOES_PROBLEMA=""
        if [ -f /tmp/wppconnect_divergent_sessions ]; then
            SESSOES_PROBLEMA=$(cat /tmp/wppconnect_divergent_sessions)
        fi

        # Enviar notificação de falha
        local MOTIVO="Divergência detectada entre status-session e check-connection. O rebuild foi executado mas a API não está respondendo (HTTP: $API_CHECK). Verificação manual necessária."
        send_notification "falha" "$MOTIVO" "$SESSOES_PROBLEMA"

        log_debug "[REBUILD] =========================================="
        return 1
    fi
}

# Função para verificar uma sessão específica e popular arrays
# Retorna: 0 = OK, 1 = Divergência detectada
check_session() {
    local SESSION="$1"
    local TOKEN="$2"

    log_debug "[SESSION] ------------------------------------------"
    log_debug "[SESSION] Verificando sessão: $SESSION"

    # Verificar status-session
    log_debug "[SESSION] Consultando: GET ${API_URL}/${SESSION}/status-session"
    local STATUS_FULL_RESP=$(curl -s -w "\n%{http_code}" --max-time 10 \
        -H "Authorization: Bearer $TOKEN" \
        "${API_URL}/${SESSION}/status-session" 2>/dev/null)
    local STATUS_HTTP_CODE="${STATUS_FULL_RESP##*$'\n'}"
    local STATUS_RESP="${STATUS_FULL_RESP%$'\n'*}"
    local STATUS=$(echo "$STATUS_RESP" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

    log_debug "[SESSION] Resposta status-session: status=$STATUS (HTTP $STATUS_HTTP_CODE)"
    log_debug "[SESSION] Resposta completa: $STATUS_RESP"

    # Verificar check-connection-session
    log_debug "[SESSION] Consultando: GET ${API_URL}/${SESSION}/check-connection-session"
    local CHECK_FULL_RESP=$(curl -s -w "\n%{http_code}" --max-time 10 \
        -H "Authorization: Bearer $TOKEN" \
        "${API_URL}/${SESSION}/check-connection-session" 2>/dev/null)
    local CHECK_HTTP_CODE="${CHECK_FULL_RESP##*$'\n'}"
    local CHECK_RESP="${CHECK_FULL_RESP%$'\n'*}"
    local CHECK_STATUS=$(echo "$CHECK_RESP" | grep -o '"status":[^,}]*' | cut -d':' -f2 | tr -d ' ')
    local CHECK_MSG=$(echo "$CHECK_RESP" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)

    log_debug "[SESSION] Resposta check-connection: status=$CHECK_STATUS, message=$CHECK_MSG (HTTP $CHECK_HTTP_CODE)"
    log_debug "[SESSION] Resposta completa: $CHECK_RESP"

    # Análise de divergência
    log_debug "[SESSION] Análise: status-session=$STATUS | check-connection=$CHECK_STATUS ($CHECK_MSG)"

    # Verificar erros de API
    if [[ "$STATUS_HTTP_CODE" != "200" ]] || [[ -z "$STATUS" ]]; then
        # Verificar se é erro Cloudflare ou interno
        if is_cloudflare_error "$STATUS_RESP" "$STATUS_HTTP_CODE"; then
            FLAG_CLOUDFLARE_ERROR=true
            log_debug "[SESSION] ERRO CLOUDFLARE detectado para sessão $SESSION"
        elif is_internal_error "$STATUS_RESP" "$STATUS_HTTP_CODE"; then
            FLAG_INTERNAL_ERROR=true
            log_debug "[SESSION] ERRO INTERNO detectado para sessão $SESSION"
        fi
        SESSIONS_ERROR+=("$SESSION (HTTP $STATUS_HTTP_CODE)")
        log_debug "[SESSION] ERRO: Falha ao verificar sessão $SESSION (HTTP $STATUS_HTTP_CODE)"
        log_debug "[SESSION] ------------------------------------------"
        return 0  # Não é divergência, é erro de API
    fi

    # Classificar sessão baseado no status
    if [ "$STATUS" = "CONNECTED" ]; then
        if [ "$CHECK_STATUS" = "false" ] || [ "$CHECK_MSG" = "Disconnected" ]; then
            # DIVERGÊNCIA: status-session diz CONNECTED mas check-connection diz false
            SESSIONS_DIVERGENT+=("$SESSION")
            log_debug "[SESSION] DIVERGÊNCIA DETECTADA!"
            log_debug "[SESSION] -> status-session diz CONNECTED"
            log_debug "[SESSION] -> check-connection diz $CHECK_STATUS ($CHECK_MSG)"
            log_debug "[SESSION] -> Isso indica problema de 'detached frame' no Puppeteer"
            log_debug "[SESSION] ------------------------------------------"
            return 1  # Problema detectado
        else
            # CONECTADA: Sessão funcionando normalmente
            SESSIONS_CONNECTED+=("$SESSION")
            log_debug "[SESSION] OK: Sessão conectada e funcionando normalmente"
        fi
    elif [ "$STATUS" = "DISCONNECTED" ] || [ "$STATUS" = "CLOSED" ]; then
        # DESCONECTADA: Status normal, não é erro
        SESSIONS_DISCONNECTED+=("$SESSION")
        log_debug "[SESSION] INFO: Sessão está desconectada (status=$STATUS)"
        log_debug "[SESSION] Isso é esperado se o usuário desconectou manualmente"
    elif [ -z "$STATUS" ]; then
        # ERRO: Resposta vazia ou inválida
        SESSIONS_ERROR+=("$SESSION (resposta vazia)")
        log_debug "[SESSION] ALERTA: Não foi possível obter status da sessão"
        log_debug "[SESSION] Resposta vazia ou inválida da API"
    else
        # Outros status (QRCODE, STARTING, etc.)
        SESSIONS_DISCONNECTED+=("$SESSION ($STATUS)")
        log_debug "[SESSION] INFO: Status da sessão: $STATUS"
    fi

    log_debug "[SESSION] ------------------------------------------"
    return 0  # OK
}

# ==================== INÍCIO DA VERIFICAÇÃO ====================

# Obter número do ciclo e resetar estado
CYCLE_NUMBER=$(get_cycle_number)
reset_cycle_state

# Rotacionar logs se necessário
rotate_debug_log
rotate_monitor_log

log_separator
log_debug "[MONITOR] =========================================="
log_debug "[MONITOR] Iniciando verificação do WPPCONNECT - Ciclo #$CYCLE_NUMBER"
log_debug "[MONITOR] Script: $0"
log_debug "[MONITOR] Diretório: $SCRIPT_DIR"
log_debug "[MONITOR] API URL: $API_URL"
log_debug "[MONITOR] Threshold divergências: $DIVERGENCE_THRESHOLD"
log_debug "[MONITOR] =========================================="

# Etapa 1: Verificar se container está rodando
log_debug "[ETAPA 1] Verificando status do container..."
log_debug "[ETAPA 1] Comando: docker inspect -f '{{.State.Running}}' wppconnect-server"

CONTAINER_RUNNING=$(docker inspect -f '{{.State.Running}}' wppconnect-server 2>/dev/null)
CONTAINER_EXISTS=$?

if [ $CONTAINER_EXISTS -ne 0 ]; then
    CONTAINER_STATUS_TEXT="NÃO EXISTE"
    log_debug "[ETAPA 1] ERRO: Container wppconnect-server não existe"
    log_debug "[ETAPA 1] Ação: Tentando reiniciar..."
    restart_container
    echo "0" > "$DIVERGENCE_FILE"
    log_debug "[MONITOR] Verificação encerrada (container não existia)"
    write_monitor_result "$CYCLE_NUMBER"
    log_separator
    exit 0
fi

log_debug "[ETAPA 1] Container existe. Estado: Running=$CONTAINER_RUNNING"

if [ "$CONTAINER_RUNNING" != "true" ]; then
    CONTAINER_STATUS_TEXT="PARADO"
    log_debug "[ETAPA 1] PROBLEMA: Container não está rodando (Running=$CONTAINER_RUNNING)"
    log_debug "[ETAPA 1] Ação: Reiniciando container..."
    restart_container
    echo "0" > "$DIVERGENCE_FILE"
    log_debug "[MONITOR] Verificação encerrada (container reiniciado)"
    write_monitor_result "$CYCLE_NUMBER"
    log_separator
    exit 0
fi

CONTAINER_STATUS_TEXT="RUNNING ✓"
log_debug "[ETAPA 1] OK: Container está rodando"

# Etapa 2: Verificar se API responde
log_debug "[ETAPA 2] Verificando se API responde..."
log_debug "[ETAPA 2] URL: ${API_URL}/"
log_debug "[ETAPA 2] Timeout: 10 segundos"

# Capturar resposta completa e código HTTP
API_FULL_RESP=$(curl -s -w "\n%{http_code}" --max-time 10 "${API_URL}/" 2>/dev/null)
API_HTTP_CODE="${API_FULL_RESP##*$'\n'}"
API_BODY="${API_FULL_RESP%$'\n'*}"
log_debug "[ETAPA 2] Resposta HTTP: $API_HTTP_CODE"

# Avaliar resposta:
# - 000 = Falha de conexão (curl não conseguiu conectar)
# - 5xx = Erro interno do servidor
# - 200, 404, 401, 403 = API está respondendo (servidor está UP)
#
# Nota: 404 na rota raiz /api/ é normal - significa que a API está UP mas não tem rota nesse path

API_IS_DOWN=false

if [ "$API_HTTP_CODE" = "000" ]; then
    FLAG_API_ERROR=true
    API_STATUS_TEXT="FALHA CONEXÃO (HTTP 000)"
    log_debug "[ETAPA 2] PROBLEMA: Falha de conexão (HTTP 000)"
    log_debug "[ETAPA 2] Possíveis causas:"
    log_debug "[ETAPA 2]   - Container não está expondo a porta"
    log_debug "[ETAPA 2]   - Problema de rede/DNS"
    log_debug "[ETAPA 2]   - Timeout de conexão"
    API_IS_DOWN=true
elif [ "$API_HTTP_CODE" -ge 500 ] 2>/dev/null; then
    FLAG_API_ERROR=true
    # Verificar se é erro Cloudflare ou interno
    if is_cloudflare_error "$API_BODY" "$API_HTTP_CODE"; then
        FLAG_CLOUDFLARE_ERROR=true
        API_STATUS_TEXT="ERRO CLOUDFLARE (HTTP $API_HTTP_CODE)"
        log_debug "[ETAPA 2] PROBLEMA: Erro Cloudflare detectado (HTTP $API_HTTP_CODE)"
    elif is_internal_error "$API_BODY" "$API_HTTP_CODE"; then
        FLAG_INTERNAL_ERROR=true
        API_STATUS_TEXT="ERRO INTERNO (HTTP $API_HTTP_CODE)"
        log_debug "[ETAPA 2] PROBLEMA: Erro interno do servidor (HTTP $API_HTTP_CODE)"
    else
        API_STATUS_TEXT="ERRO (HTTP $API_HTTP_CODE)"
        log_debug "[ETAPA 2] PROBLEMA: Erro do servidor (HTTP $API_HTTP_CODE)"
    fi
    log_debug "[ETAPA 2] Possíveis causas:"
    log_debug "[ETAPA 2]   - Serviço com erro fatal"
    log_debug "[ETAPA 2]   - Falta de memória/recursos"
    API_IS_DOWN=true
elif [ -z "$API_HTTP_CODE" ]; then
    FLAG_API_ERROR=true
    API_STATUS_TEXT="RESPOSTA VAZIA"
    log_debug "[ETAPA 2] PROBLEMA: Resposta vazia do curl"
    API_IS_DOWN=true
fi

if [ "$API_IS_DOWN" = true ]; then
    log_debug "[ETAPA 2] Ação: Reiniciando container..."
    restart_container
    echo "0" > "$DIVERGENCE_FILE"
    log_debug "[MONITOR] Verificação encerrada (API não respondia)"
    write_monitor_result "$CYCLE_NUMBER"
    log_separator
    exit 0
fi

# API está respondendo (qualquer código 1xx-4xx é válido)
API_STATUS_TEXT="OK (HTTP $API_HTTP_CODE) ✓"
log_debug "[ETAPA 2] OK: API respondendo (HTTP $API_HTTP_CODE)"
if [ "$API_HTTP_CODE" = "404" ]; then
    log_debug "[ETAPA 2] Nota: 404 na rota raiz é normal - a API está UP, apenas não tem handler nesse path"
fi

# Etapa 3: Verificar sessões (obtendo tokens do banco de dados Django)
log_debug "[ETAPA 3] Verificando sessões existentes..."
log_debug "[ETAPA 3] Banco de dados: $DB_PATH"

SESSION_HAS_DIVERGENCE=false

# Verificar se o banco de dados existe
if [ ! -f "$DB_PATH" ]; then
    log_debug "[ETAPA 3] ERRO: Banco de dados não encontrado: $DB_PATH"
    log_debug "[ETAPA 3] Verifique o caminho DB_PATH no início do script"
    log_debug "[ETAPA 3] Possíveis localizações:"
    log_debug "[ETAPA 3]   - ${SCRIPT_DIR}/nossopainel-django/database/db.sqlite3"
    log_debug "[ETAPA 3]   - /root/Docker/ubuntu/nossopainel-django/database/db.sqlite3"
else
    # Verificar se sqlite3 está instalado
    if ! command -v sqlite3 &> /dev/null; then
        log_debug "[ETAPA 3] ERRO: sqlite3 não está instalado"
        log_debug "[ETAPA 3] Instale com: apt-get install sqlite3"
    else
        # Consultar sessões ativas no banco Django
        # Tabela: cadastros_sessaowpp | Campos: usuario, token, is_active
        log_debug "[ETAPA 3] Consultando sessões ativas no banco Django..."

        QUERY="SELECT usuario, token FROM cadastros_sessaowpp WHERE is_active = 1;"
        SESSIONS_DATA=$(sqlite3 -separator '|' "$DB_PATH" "$QUERY" 2>/dev/null)

        if [ -z "$SESSIONS_DATA" ]; then
            log_debug "[ETAPA 3] Nenhuma sessão ativa encontrada no banco"
        else
            # Contar sessões
            TOTAL_SESSIONS=$(echo "$SESSIONS_DATA" | wc -l)
            log_debug "[ETAPA 3] Sessões ativas encontradas: $TOTAL_SESSIONS"

            # Limpar arquivo temporário de sessões divergentes (para notificação)
            rm -f /tmp/wppconnect_divergent_sessions

            # Iterar sobre cada sessão (formato: usuario|token)
            # Usar redirecionamento ao invés de pipe para evitar subshell
            while IFS='|' read -r SESSION_NAME TOKEN; do
                if [ -z "$SESSION_NAME" ] || [ -z "$TOKEN" ]; then
                    log_debug "[ETAPA 3] ALERTA: Linha inválida no resultado da consulta"
                    continue
                fi

                log_debug "[ETAPA 3] Sessão: $SESSION_NAME | Token: ${TOKEN:0:20}..."

                # check_session popula os arrays diretamente
                if ! check_session "$SESSION_NAME" "$TOKEN"; then
                    SESSION_HAS_DIVERGENCE=true
                    # Salvar nome da sessão com problema para notificação de rebuild
                    echo "$SESSION_NAME" >> /tmp/wppconnect_divergent_sessions
                fi
            done <<< "$SESSIONS_DATA"
        fi
    fi
fi

# Resumo usando os arrays populados por check_session
TOTAL_CHECKED=$((${#SESSIONS_CONNECTED[@]} + ${#SESSIONS_DISCONNECTED[@]} + ${#SESSIONS_DIVERGENT[@]} + ${#SESSIONS_ERROR[@]}))
log_debug "[ETAPA 3] Resumo: $TOTAL_CHECKED sessões verificadas"
log_debug "[ETAPA 3]   - Conectadas: ${#SESSIONS_CONNECTED[@]} (${SESSIONS_CONNECTED[*]:-nenhuma})"
log_debug "[ETAPA 3]   - Desconectadas: ${#SESSIONS_DISCONNECTED[@]} (${SESSIONS_DISCONNECTED[*]:-nenhuma})"
log_debug "[ETAPA 3]   - Divergentes: ${#SESSIONS_DIVERGENT[@]} (${SESSIONS_DIVERGENT[*]:-nenhuma})"
log_debug "[ETAPA 3]   - Com erro: ${#SESSIONS_ERROR[@]} (${SESSIONS_ERROR[*]:-nenhuma})"

# Etapa 4: Avaliar resultados e tomar ação
log_debug "[ETAPA 4] Avaliando resultados..."

CURRENT_DIVERGENCE=$(cat "$DIVERGENCE_FILE" 2>/dev/null || echo "0")
log_debug "[ETAPA 4] Contador atual de divergências: $CURRENT_DIVERGENCE"

# Verificar se houve divergências (usando o array)
DIVERGENT_COUNT=${#SESSIONS_DIVERGENT[@]}

if [ "$DIVERGENT_COUNT" -gt 0 ]; then
    DIVERGENCE_COUNT=$((CURRENT_DIVERGENCE + 1))
    echo "$DIVERGENCE_COUNT" > "$DIVERGENCE_FILE"

    log_debug "[ETAPA 4] PROBLEMA: Divergência detectada em $DIVERGENT_COUNT sessão(ões): ${SESSIONS_DIVERGENT[*]}"
    log_debug "[ETAPA 4] Contador atualizado: $DIVERGENCE_COUNT/$DIVERGENCE_THRESHOLD"

    if [ "$DIVERGENCE_COUNT" -ge "$DIVERGENCE_THRESHOLD" ]; then
        log_debug "[ETAPA 4] AÇÃO: Threshold atingido ($DIVERGENCE_COUNT >= $DIVERGENCE_THRESHOLD)"
        log_debug "[ETAPA 4] Iniciando REBUILD completo do container..."
        rebuild_container
        echo "0" > "$DIVERGENCE_FILE"
        log_debug "[ETAPA 4] Contador de divergências resetado para 0"
    else
        log_debug "[ETAPA 4] AGUARDANDO: Divergência $DIVERGENCE_COUNT de $DIVERGENCE_THRESHOLD"
        log_debug "[ETAPA 4] Rebuild será executado após $((DIVERGENCE_THRESHOLD - DIVERGENCE_COUNT)) verificação(ões) com problema"
    fi
else
    if [ "$CURRENT_DIVERGENCE" != "0" ]; then
        log_debug "[ETAPA 4] RECUPERADO: Sistema voltou ao normal"
        log_debug "[ETAPA 4] Contador anterior: $CURRENT_DIVERGENCE -> resetando para 0"
    else
        log_debug "[ETAPA 4] OK: Nenhuma divergência detectada"
    fi
    echo "0" > "$DIVERGENCE_FILE"
fi

# Finalização - Log de debug
log_debug "[MONITOR] =========================================="
log_debug "[MONITOR] Verificação concluída - Ciclo #$CYCLE_NUMBER"
log_debug "[MONITOR] Status final:"
log_debug "[MONITOR]   - Container: $CONTAINER_STATUS_TEXT"
log_debug "[MONITOR]   - API: $API_STATUS_TEXT"
log_debug "[MONITOR]   - Sessões conectadas: ${#SESSIONS_CONNECTED[@]}"
log_debug "[MONITOR]   - Sessões desconectadas: ${#SESSIONS_DISCONNECTED[@]}"
log_debug "[MONITOR]   - Sessões divergentes: ${#SESSIONS_DIVERGENT[@]}"
log_debug "[MONITOR]   - Sessões com erro: ${#SESSIONS_ERROR[@]}"
log_debug "[MONITOR]   - Contador divergências: $(cat "$DIVERGENCE_FILE" 2>/dev/null || echo "0")/$DIVERGENCE_THRESHOLD"
log_debug "[MONITOR] =========================================="

# Escrever resultado estruturado no log de monitoramento
write_monitor_result "$CYCLE_NUMBER"

log_separator
