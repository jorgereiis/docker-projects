#!/bin/bash
# =============================================================================
# Monitor WPPCONNECT - Verifica sessões e faz restart/rebuild se necessário
# Localização no servidor: /Docker/ubuntu/monitor_wppconnect.sh
#
# Lógica de verificação:
# 1. Container não existe ou não está Running → docker restart
# 2. API não responde → apenas alerta (sem restart automático)
#    - O problema pode ser externo (Cloudflare, DNS, rede)
# 3. Divergência status-session vs check-connection → rebuild completo
#    - Detecta problema de 'detached frame' no Puppeteer
#    - Requer 3 divergências consecutivas antes do rebuild
#
# Obtenção de tokens:
# - Os tokens das sessões são obtidos do banco SQLite do Django
# - Tabela: cadastros_sessaowpp (campos: usuario, token, is_active)
#
# Funcionalidades de confiabilidade:
# - Lock de execução para evitar execuções simultâneas
# - Fallback para API local (IP do container) quando API externa falha
# - Cooldown após rebuild (2h) para evitar loops destrutivos
# - Rate limiting de notificações com detecção de problemas persistentes
# - Health check robusto do container (Running + API respondendo)
# - Rotação automática de logs e arquivos de diagnóstico
# - Persistência de estado em disco (sobrevive a reboots)
#
# Pré-requisitos:
# - docker, curl, sqlite3, flock
# - Acesso de leitura ao banco de dados Django
#
# Uso:
#   chmod +x /Docker/ubuntu/monitor_wppconnect.sh
#   Adicionar ao crontab: */10 * * * * /Docker/ubuntu/monitor_wppconnect.sh
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# =============================================================================
# VERIFICAÇÃO DE DEPENDÊNCIAS
# =============================================================================
check_dependencies() {
    local missing=()
    for cmd in docker curl sqlite3 flock; do
        if ! command -v "$cmd" &> /dev/null; then
            missing+=("$cmd")
        fi
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERRO: Dependências não encontradas: ${missing[*]}"
        echo "Instale com: apt-get install ${missing[*]}"
        exit 1
    fi
}
check_dependencies

# =============================================================================
# LOCK DE EXECUÇÃO - Evita execuções simultâneas
# =============================================================================
LOCK_FILE="/tmp/monitor_wppconnect.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Script já em execução. Abortando."
    exit 1
fi

# =============================================================================
# TRAP PARA LIMPEZA DE ARQUIVOS TEMPORÁRIOS
# =============================================================================
TEMP_FILES_TO_CLEAN=()
cleanup() {
    for file in "${TEMP_FILES_TO_CLEAN[@]}"; do
        rm -f "$file" 2>/dev/null
    done
}
trap cleanup EXIT

# =============================================================================
# CONFIGURAÇÃO DE LOGS DUAL
# =============================================================================
# DEBUG_LOG: Log detalhado com todas as operações, respostas da API, etc.
# MONITOR_LOG: Log estruturado com resumo executivo de cada ciclo
# INCIDENT_LOG: Log de incidentes graves (502, restart, rebuild)
DEBUG_LOG="${SCRIPT_DIR}/logs/wppconnect_debug.log"
MONITOR_LOG="${SCRIPT_DIR}/logs/wppconnect_monitor.log"
INCIDENT_LOG="${SCRIPT_DIR}/logs/wppconnect_incidents.log"

# Arquivos de controle (persistentes - sobrevivem a reboots)
STATE_DIR="${SCRIPT_DIR}/logs/state"
mkdir -p "$STATE_DIR"
DIVERGENCE_FILE="${STATE_DIR}/divergence_count"
CYCLE_COUNT_FILE="${STATE_DIR}/cycle_count"
LAST_REBUILD_FILE="${STATE_DIR}/last_rebuild_timestamp"
LAST_RESTART_FILE="${STATE_DIR}/last_restart_timestamp"
LAST_NOTIFICATION_FILE="${STATE_DIR}/last_notification"
LAST_PROBLEM_HASH_FILE="${STATE_DIR}/last_problem_hash"

# Configurações da API
API_URL_EXTERNAL="http://api.nossopainel.com.br/api"
API_URL_INTERNAL=""  # Será preenchido dinamicamente com IP do container
CONTAINER_NAME="wppconnect-server"
CONTAINER_PORT="21465"
API_URL=""  # URL efetiva (será definida após detectar IP)

# Configurações de comportamento
DIVERGENCE_THRESHOLD=3      # Divergências consecutivas antes de rebuild
REBUILD_COOLDOWN=7200       # Cooldown após rebuild: 2 horas (em segundos)
RESTART_COOLDOWN=300        # Cooldown após restart: 5 minutos (em segundos)
NOTIFICATION_COOLDOWN=1800  # Cooldown entre notificações do mesmo problema: 30 min

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

# Função para registrar incidentes graves
log_incident() {
    local type="$1"
    local details="$2"
    {
        echo "================================================================================"
        echo "INCIDENTE: $type"
        echo "DATA/HORA: $(date '+%Y-%m-%d %H:%M:%S')"
        echo "CICLO: #$CYCLE_NUMBER"
        echo ""
        echo "DETALHES:"
        echo "$details"
        echo "================================================================================"
        echo ""
    } >> "$INCIDENT_LOG"
}

# Função para capturar diagnóstico completo quando ocorre erro grave
capture_diagnostic_info() {
    local ERROR_TYPE="$1"       # "502", "500", etc.
    local API_RESPONSE="$2"     # Corpo da resposta HTTP
    local API_HEADERS="$3"      # Headers da resposta HTTP
    local TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
    local DIAG_FILE="${SCRIPT_DIR}/logs/diagnostic_${TIMESTAMP}.log"

    log_debug "[DIAGNOSTIC] Capturando informações de diagnóstico..."
    log_debug "[DIAGNOSTIC] Arquivo: $DIAG_FILE"

    {
        echo "================================================================================"
        echo "DIAGNÓSTICO DE ERRO - $ERROR_TYPE"
        echo "================================================================================"
        echo ""
        echo "DATA/HORA: $(date '+%Y-%m-%d %H:%M:%S')"
        echo "CICLO: #$CYCLE_NUMBER"
        echo ""
        echo "================================================================================"
        echo "1. RESPOSTA HTTP"
        echo "================================================================================"
        echo ""
        echo "Código HTTP: $ERROR_TYPE"
        echo ""
        echo "--- HEADERS ---"
        echo "$API_HEADERS"
        echo ""
        echo "--- CORPO DA RESPOSTA ---"
        echo "$API_RESPONSE"
        echo ""
        echo "================================================================================"
        echo "2. ANÁLISE DA RESPOSTA"
        echo "================================================================================"
        echo ""

        # Detectar origem do erro baseado no corpo/headers
        if echo "$API_HEADERS$API_RESPONSE" | grep -qiE "(cf-ray|cloudflare|__cf_)"; then
            echo "ORIGEM DETECTADA: CLOUDFLARE"
            echo "O erro 502 está vindo do Cloudflare (proxy reverso)"
            echo "Possíveis causas:"
            echo "  - Backend (container) não está respondendo"
            echo "  - Timeout de conexão com o backend"
            echo "  - Limite de requisições atingido"
        elif echo "$API_HEADERS$API_RESPONSE" | grep -qiE "(nginx|upstream)"; then
            echo "ORIGEM DETECTADA: NGINX"
            echo "O erro 502 está vindo do nginx (upstream timeout)"
            echo "Possíveis causas:"
            echo "  - Container WPPCONNECT não está respondendo"
            echo "  - Upstream timeout configurado muito baixo"
        else
            echo "ORIGEM DETECTADA: DESCONHECIDA/CONTAINER"
            echo "O erro pode estar vindo diretamente do container"
        fi
        echo ""
        echo "================================================================================"
        echo "3. LOGS DO CONTAINER (últimas 200 linhas)"
        echo "================================================================================"
        echo ""
        docker logs --tail 200 wppconnect-server 2>&1
        echo ""
        echo "================================================================================"
        echo "4. MÉTRICAS DO CONTAINER"
        echo "================================================================================"
        echo ""
        echo "--- docker stats ---"
        docker stats --no-stream wppconnect-server 2>&1
        echo ""
        echo "--- docker inspect (Estado) ---"
        docker inspect --format='{{json .State}}' wppconnect-server 2>&1 | python3 -m json.tool 2>/dev/null || docker inspect --format='{{json .State}}' wppconnect-server 2>&1
        echo ""
        echo "================================================================================"
        echo "5. RECURSOS DO HOST"
        echo "================================================================================"
        echo ""
        echo "--- Memória (free -m) ---"
        free -m 2>&1
        echo ""
        echo "--- Uso de disco (df -h) ---"
        df -h 2>&1 | head -10
        echo ""
        echo "--- Processos com maior uso de memória ---"
        ps aux --sort=-%mem 2>&1 | head -10
        echo ""
        echo "================================================================================"
        echo "6. CONTAINERS DOCKER"
        echo "================================================================================"
        echo ""
        docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>&1
        echo ""
        echo "================================================================================"
        echo "FIM DO DIAGNÓSTICO"
        echo "================================================================================"
    } > "$DIAG_FILE"

    log_debug "[DIAGNOSTIC] Diagnóstico salvo em: $DIAG_FILE"

    # Registrar incidente no log de incidentes
    log_incident "ERRO HTTP $ERROR_TYPE" "Diagnóstico completo salvo em: $DIAG_FILE
Origem provável: $(echo "$API_HEADERS$API_RESPONSE" | grep -qiE "(cf-ray|cloudflare)" && echo "CLOUDFLARE" || (echo "$API_HEADERS$API_RESPONSE" | grep -qiE "nginx|upstream" && echo "NGINX" || echo "CONTAINER/DESCONHECIDO"))"
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

# Obter timestamp atual em segundos (epoch)
get_timestamp() {
    date +%s
}

# Verificar se está em período de cooldown
# Uso: is_in_cooldown "arquivo_timestamp" "segundos_cooldown"
# Retorna: 0 = em cooldown, 1 = fora do cooldown
is_in_cooldown() {
    local timestamp_file="$1"
    local cooldown_seconds="$2"

    if [[ ! -f "$timestamp_file" ]]; then
        return 1  # Arquivo não existe = fora do cooldown
    fi

    local last_timestamp=$(cat "$timestamp_file" 2>/dev/null || echo "0")
    local current_timestamp=$(get_timestamp)
    local elapsed=$((current_timestamp - last_timestamp))

    if [[ $elapsed -lt $cooldown_seconds ]]; then
        local remaining=$((cooldown_seconds - elapsed))
        log_debug "[COOLDOWN] Em cooldown. Restam $((remaining / 60)) minutos"
        return 0  # Em cooldown
    fi

    return 1  # Fora do cooldown
}

# Registrar timestamp de uma ação (para cooldown)
set_cooldown_timestamp() {
    local timestamp_file="$1"
    get_timestamp > "$timestamp_file"
}

# Gerar hash de um problema (para detectar problemas persistentes)
generate_problem_hash() {
    local problem_type="$1"
    local problem_details="$2"
    echo "${problem_type}:${problem_details}" | md5sum | cut -d' ' -f1
}

# Verificar se é o mesmo problema da última notificação
# Retorna: 0 = mesmo problema, 1 = problema diferente
is_same_problem() {
    local current_hash="$1"

    if [[ ! -f "$LAST_PROBLEM_HASH_FILE" ]]; then
        return 1  # Não há problema anterior
    fi

    local last_hash=$(cat "$LAST_PROBLEM_HASH_FILE" 2>/dev/null)
    if [[ "$current_hash" == "$last_hash" ]]; then
        return 0  # Mesmo problema
    fi

    return 1  # Problema diferente
}

# Obter contagem de ocorrências do mesmo problema
get_problem_occurrence_count() {
    local occurrence_file="${STATE_DIR}/problem_occurrence_count"
    cat "$occurrence_file" 2>/dev/null || echo "0"
}

# Incrementar contagem de ocorrências do mesmo problema
increment_problem_occurrence() {
    local occurrence_file="${STATE_DIR}/problem_occurrence_count"
    local current=$(get_problem_occurrence_count)
    echo $((current + 1)) > "$occurrence_file"
}

# Resetar contagem de ocorrências (quando problema muda ou é resolvido)
reset_problem_occurrence() {
    local occurrence_file="${STATE_DIR}/problem_occurrence_count"
    echo "0" > "$occurrence_file"
    rm -f "$LAST_PROBLEM_HASH_FILE" 2>/dev/null
}

# Descobrir IP interno do container na rede Docker
get_container_internal_ip() {
    local container="$1"
    local ip=$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container" 2>/dev/null)
    echo "$ip"
}

# Configurar URL da API (tenta local primeiro, depois externa)
setup_api_url() {
    log_debug "[API] Configurando URL da API..."

    # Tentar obter IP interno do container
    local container_ip=$(get_container_internal_ip "$CONTAINER_NAME")

    if [[ -n "$container_ip" ]]; then
        API_URL_INTERNAL="http://${container_ip}:${CONTAINER_PORT}/api"
        log_debug "[API] IP interno do container: $container_ip"
        log_debug "[API] URL interna configurada: $API_URL_INTERNAL"

        # Testar se API interna responde
        local internal_check=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${API_URL_INTERNAL}/" 2>/dev/null)

        if [[ "$internal_check" != "000" ]] && [[ -n "$internal_check" ]]; then
            API_URL="$API_URL_INTERNAL"
            log_debug "[API] Usando API INTERNA (HTTP $internal_check): $API_URL"
            return 0
        else
            log_debug "[API] API interna não respondeu (HTTP $internal_check)"
        fi
    else
        log_debug "[API] Não foi possível obter IP interno do container"
    fi

    # Fallback para URL externa
    API_URL="$API_URL_EXTERNAL"
    log_debug "[API] Usando API EXTERNA (fallback): $API_URL"
    return 0
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
    if [[ "$status_code" =~ ^52[0-7]$ ]]; then
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
        echo "CICLO DE MONITORAMENTO #$cycle_number"
        echo "================================================================================"
        echo ""
        echo "DATA/HORA: $(date '+%Y-%m-%d %H:%M:%S')"
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

# Rotação de arquivos de diagnóstico (manter últimos 7 dias, max 50 arquivos)
rotate_diagnostic_files() {
    local diag_dir="${SCRIPT_DIR}/logs"
    if [[ -d "$diag_dir" ]]; then
        # Remover arquivos de diagnóstico com mais de 7 dias
        find "$diag_dir" -name "diagnostic_*.log" -mtime +7 -delete 2>/dev/null
        # Manter apenas os 50 mais recentes
        local count=$(find "$diag_dir" -name "diagnostic_*.log" 2>/dev/null | wc -l)
        if [[ $count -gt 50 ]]; then
            find "$diag_dir" -name "diagnostic_*.log" -printf '%T@ %p\n' 2>/dev/null | \
                sort -n | head -n $((count - 50)) | cut -d' ' -f2- | xargs -r rm -f
            log_debug "Arquivos de diagnóstico rotacionados: removidos $((count - 50)) arquivos antigos"
        fi
    fi
}

# Função para enviar notificação WhatsApp após rebuild ou alerta
# RESULTADO: "sucesso", "falha", "alerta", ou "restart"
# Inclui rate limiting e detecção de problemas persistentes
send_notification() {
    local RESULTADO="$1"  # "sucesso", "falha", "alerta", ou "restart"
    local MOTIVO="$2"     # Descrição do motivo
    local SESSOES_PROBLEMA="$3"  # Lista de sessões que causaram o problema (opcional)

    log "[NOTIFY] =========================================="
    log "[NOTIFY] Preparando notificação WhatsApp..."

    # Gerar hash do problema atual para detectar persistência
    local problem_hash=$(generate_problem_hash "$RESULTADO" "$MOTIVO")
    local is_persistent=false
    local occurrence_count=1

    # Verificar se é o mesmo problema da última notificação
    if is_same_problem "$problem_hash"; then
        increment_problem_occurrence
        occurrence_count=$(get_problem_occurrence_count)
        is_persistent=true
        log "[NOTIFY] Problema PERSISTENTE detectado (ocorrência #$occurrence_count)"

        # Verificar cooldown de notificações para o mesmo problema
        if is_in_cooldown "$LAST_NOTIFICATION_FILE" "$NOTIFICATION_COOLDOWN"; then
            log "[NOTIFY] Em cooldown de notificação. Pulando envio."
            log "[NOTIFY] =========================================="
            return 0
        fi
    else
        # Problema novo - resetar contagem
        reset_problem_occurrence
        increment_problem_occurrence
        echo "$problem_hash" > "$LAST_PROBLEM_HASH_FILE"
        log "[NOTIFY] Novo problema detectado"
    fi

    # Carregar variáveis do .env do Django
    DJANGO_ENV="${SCRIPT_DIR}/nossopainel-django/.env"
    if [ ! -f "$DJANGO_ENV" ]; then
        log "[NOTIFY] ERRO: Arquivo .env do Django não encontrado: $DJANGO_ENV"
        return 1
    fi

    # Extrair MEU_NUM_TIM e URL_API_WPP do .env (suporta aspas simples, duplas ou sem aspas)
    TELEFONE_ADMIN=$(grep -E "^MEU_NUM_TIM" "$DJANGO_ENV" | sed -E "s/^[^=]+=[ ]*['\"]?([^'\"]+)['\"]?.*$/\1/" | tr -d '[:space:]')
    API_URL_WPP=$(grep -E "^URL_API_WPP" "$DJANGO_ENV" | sed -E "s/^[^=]+=[ ]*['\"]?([^'\"]+)['\"]?.*$/\1/" | tr -d '[:space:]')

    if [ -z "$TELEFONE_ADMIN" ]; then
        log "[NOTIFY] ERRO: MEU_NUM_TIM não encontrado no .env"
        log "[NOTIFY] Verifique se a variável está definida no formato: MEU_NUM_TIM=\"valor\" ou MEU_NUM_TIM='valor'"
        return 1
    fi

    if [ -z "$API_URL_WPP" ]; then
        log "[NOTIFY] ERRO: URL_API_WPP não encontrado no .env"
        log "[NOTIFY] Verifique se a variável está definida no formato: URL_API_WPP=\"valor\" ou URL_API_WPP='valor'"
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
    local EMOJI STATUS_MSG TITULO

    case "$RESULTADO" in
        "sucesso")
            EMOJI="✅"
            STATUS_MSG="REBUILD CONCLUÍDO COM SUCESSO"
            TITULO="MANUTENÇÃO AUTOMÁTICA"
            ;;
        "falha")
            EMOJI="❌"
            STATUS_MSG="REBUILD FALHOU"
            TITULO="MANUTENÇÃO AUTOMÁTICA"
            ;;
        "alerta")
            EMOJI="🚨"
            STATUS_MSG="ERRO DETECTADO NA API"
            TITULO="ALERTA DE MONITORAMENTO"
            ;;
        "restart")
            EMOJI="🔄"
            STATUS_MSG="CONTAINER REINICIADO"
            TITULO="MANUTENÇÃO AUTOMÁTICA"
            ;;
        *)
            EMOJI="ℹ️"
            STATUS_MSG="NOTIFICAÇÃO"
            TITULO="MONITORAMENTO"
            ;;
    esac

    # Formatar lista de sessões com problema (se fornecida)
    local SESSOES_FORMATADAS=""
    local SESSOES_SECTION=""
    if [ -n "$SESSOES_PROBLEMA" ]; then
        SESSOES_FORMATADAS=$(echo "$SESSOES_PROBLEMA" | tr '\n' ', ' | sed 's/,$//' | sed 's/,/, /g')
        SESSOES_SECTION="
⚠️ *Sessões com problema:* $SESSOES_FORMATADAS"
    fi

    # Seção de problema persistente (se aplicável)
    local PERSISTENT_SECTION=""
    if [[ "$is_persistent" == "true" ]] && [[ $occurrence_count -gt 1 ]]; then
        PERSISTENT_SECTION="

🔁 *PROBLEMA PERSISTENTE*
Este é o mesmo problema notificado anteriormente.
Ocorrência #$occurrence_count - O problema ainda não foi resolvido."
    fi

    # Montar mensagem (usando heredoc para preservar formatação)
    local MENSAGEM=$(cat <<EOF
🔧 *WPPCONNECT - $TITULO*

$EMOJI *$STATUS_MSG*

📅 *Data/Hora:* $TIMESTAMP$SESSOES_SECTION$PERSISTENT_SECTION

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
        # Registrar timestamp da notificação para rate limiting
        set_cooldown_timestamp "$LAST_NOTIFICATION_FILE"
        log "[NOTIFY] =========================================="
        return 0
    else
        log "[NOTIFY] FALHA: Não foi possível enviar notificação"
        log "[NOTIFY] =========================================="
        return 1
    fi
}

# Função para resetar estado de problema quando tudo está OK
# Chamar quando ciclo termina sem problemas
clear_problem_state() {
    if [[ -f "$LAST_PROBLEM_HASH_FILE" ]]; then
        log_debug "[STATE] Sistema normalizado - resetando estado de problema"
        reset_problem_occurrence
    fi
}

# Função para reiniciar container (solução rápida)
# Parâmetro opcional: $1 = motivo do restart (para notificação)
# Retorna: 0 = sucesso, 1 = falha, 2 = em cooldown (não executou)
restart_container() {
    local RESTART_MOTIVO="${1:-Container não estava rodando ou não existia}"

    log_debug "[RESTART] =========================================="
    log_debug "[RESTART] Iniciando reinicialização do container..."
    log_debug "[RESTART] Motivo: $RESTART_MOTIVO"

    # Verificar cooldown de restart
    if is_in_cooldown "$LAST_RESTART_FILE" "$RESTART_COOLDOWN"; then
        log_debug "[RESTART] Em período de cooldown. Restart não será executado."
        log_debug "[RESTART] =========================================="
        return 2
    fi

    # =========================================================================
    # CAPTURAR LOGS E MÉTRICAS ANTES DO RESTART
    # =========================================================================
    log_debug "[RESTART] Capturando estado do container antes do restart..."

    # Capturar últimas 200 linhas do log do container
    log_debug "[RESTART] === LOGS DO CONTAINER (últimas 200 linhas) ==="
    docker logs --tail 200 wppconnect-server 2>&1 | while read -r line; do
        log_debug "[RESTART][LOG] $line"
    done
    log_debug "[RESTART] === FIM DOS LOGS DO CONTAINER ==="

    # Capturar métricas do container
    log_debug "[RESTART] === MÉTRICAS DO CONTAINER ==="
    docker stats --no-stream wppconnect-server 2>&1 | while read -r line; do
        log_debug "[RESTART][STATS] $line"
    done
    log_debug "[RESTART] === FIM DAS MÉTRICAS ==="

    # Capturar memória do host
    log_debug "[RESTART] === MEMÓRIA DO HOST ==="
    free -m 2>&1 | while read -r line; do
        log_debug "[RESTART][MEM] $line"
    done
    log_debug "[RESTART] === FIM DA MEMÓRIA ==="

    # =========================================================================
    # EXECUTAR RESTART
    # =========================================================================
    log_debug "[RESTART] Executando restart..."
    log_debug "[RESTART] Comando: docker restart wppconnect-server"

    docker restart wppconnect-server
    RESULT=$?

    if [ $RESULT -eq 0 ]; then
        FLAG_CONTAINER_RESTARTED=true
        # Registrar timestamp para cooldown
        set_cooldown_timestamp "$LAST_RESTART_FILE"
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

            # Registrar incidente de restart bem-sucedido
            log_incident "RESTART EXECUTADO" "Container reiniciado devido a: $RESTART_MOTIVO
API pós-restart: HTTP $API_CHECK"

            # Enviar notificação WhatsApp de restart bem-sucedido
            send_notification "restart" "$RESTART_MOTIVO. API respondendo normalmente (HTTP $API_CHECK)." ""
        else
            log_debug "[RESTART] ALERTA: Container reiniciado mas API não responde (HTTP: $API_CHECK)"
            API_STATUS_TEXT="FALHA (HTTP $API_CHECK) - Pós-restart"

            # Registrar incidente de restart com falha
            log_incident "RESTART COM FALHA" "Container reiniciado mas API ainda não responde.
Motivo original: $RESTART_MOTIVO
API pós-restart: HTTP $API_CHECK"

            # Enviar notificação WhatsApp de falha
            send_notification "alerta" "$RESTART_MOTIVO. Container foi reiniciado mas API não está respondendo (HTTP $API_CHECK). Verificação manual pode ser necessária." ""
        fi
    else
        log_debug "[RESTART] ERRO: Falha ao reiniciar container (exit code: $RESULT)"

        # Registrar incidente de falha no restart
        log_incident "FALHA NO RESTART" "Comando docker restart falhou com exit code: $RESULT
Motivo original: $RESTART_MOTIVO"

        # Enviar notificação WhatsApp de falha crítica
        send_notification "falha" "Falha ao reiniciar container (exit code: $RESULT). Motivo: $RESTART_MOTIVO. Verificação manual necessária." ""
    fi

    log_debug "[RESTART] =========================================="
    return $RESULT
}

# Função para fazer rebuild completo (problema de detached frame)
# Retorna: 0 = sucesso, 1 = falha, 2 = em cooldown (não executou)
rebuild_container() {
    log_debug "[REBUILD] =========================================="
    log_debug "[REBUILD] Iniciando rebuild completo do container..."
    log_debug "[REBUILD] Motivo: Divergência detectada entre status-session e check-connection"
    log_debug "[REBUILD] Isso geralmente indica problema de 'detached frame' no Puppeteer"
    log_debug "[REBUILD] =========================================="

    # Verificar cooldown de rebuild
    if is_in_cooldown "$LAST_REBUILD_FILE" "$REBUILD_COOLDOWN"; then
        local remaining=$(( REBUILD_COOLDOWN - ($(get_timestamp) - $(cat "$LAST_REBUILD_FILE" 2>/dev/null || echo "0")) ))
        log_debug "[REBUILD] Em período de cooldown. Rebuild não será executado."
        log_debug "[REBUILD] Tempo restante: $((remaining / 60)) minutos"
        log_debug "[REBUILD] =========================================="
        # Enviar alerta sobre cooldown
        send_notification "alerta" "Divergência detectada mas rebuild está em cooldown (restam $((remaining / 60)) minutos). Um rebuild foi executado recentemente." ""
        return 2
    fi

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

    # Parar container (com timeout de 60 segundos)
    log_debug "[REBUILD] Etapa 1/4: Parando container..."
    log_debug "[REBUILD] Comando: timeout 60 docker stop wppconnect-server"
    if ! timeout 60 docker stop wppconnect-server 2>&1 | while read line; do log_debug "[REBUILD][STOP] $line"; done; then
        log_debug "[REBUILD] AVISO: docker stop atingiu timeout, forçando com kill..."
        docker kill wppconnect-server 2>/dev/null
    fi
    log_debug "[REBUILD] Container parado"

    # Remover container (com timeout de 30 segundos)
    log_debug "[REBUILD] Etapa 2/4: Removendo container..."
    log_debug "[REBUILD] Comando: timeout 30 docker rm wppconnect-server"
    if ! timeout 30 docker rm wppconnect-server 2>&1 | while read line; do log_debug "[REBUILD][RM] $line"; done; then
        log_debug "[REBUILD] AVISO: docker rm atingiu timeout, forçando..."
        docker rm -f wppconnect-server 2>/dev/null
    fi
    log_debug "[REBUILD] Container removido"

    # Rebuild da imagem (com timeout de 10 minutos)
    log_debug "[REBUILD] Etapa 3/4: Reconstruindo imagem..."
    log_debug "[REBUILD] Comando: timeout 600 docker compose -f wppconnect-build.yml build"
    log_debug "[REBUILD] Isso pode demorar alguns minutos (timeout: 10 min)..."
    if ! timeout 600 docker compose -f wppconnect-build.yml build 2>&1 | while read line; do log_debug "[REBUILD][BUILD] $line"; done; then
        local BUILD_EXIT=$?
        if [ $BUILD_EXIT -eq 124 ]; then
            log_debug "[REBUILD] ERRO: Timeout de 10 minutos atingido durante o build"
            log_incident "BUILD TIMEOUT" "O comando docker compose build excedeu o timeout de 10 minutos e foi cancelado."
            send_notification "falha" "O rebuild do container falhou por timeout (10 minutos). Verificação manual necessária." ""
            return 1
        fi
    fi
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

        # Registrar timestamp para cooldown
        set_cooldown_timestamp "$LAST_REBUILD_FILE"
        log_debug "[REBUILD] Cooldown de rebuild iniciado (${REBUILD_COOLDOWN}s = $((REBUILD_COOLDOWN / 3600))h)"

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

# Rotacionar logs e arquivos de diagnóstico se necessário
rotate_debug_log
rotate_monitor_log
rotate_diagnostic_files

log_separator
log_debug "[MONITOR] =========================================="
log_debug "[MONITOR] Iniciando verificação do WPPCONNECT - Ciclo #$CYCLE_NUMBER"
log_debug "[MONITOR] Script: $0"
log_debug "[MONITOR] Diretório: $SCRIPT_DIR"
log_debug "[MONITOR] Threshold divergências: $DIVERGENCE_THRESHOLD"
log_debug "[MONITOR] Cooldown rebuild: ${REBUILD_COOLDOWN}s ($((REBUILD_COOLDOWN / 3600))h)"
log_debug "[MONITOR] Cooldown restart: ${RESTART_COOLDOWN}s ($((RESTART_COOLDOWN / 60))min)"
log_debug "[MONITOR] =========================================="

# Etapa 0: Configurar URL da API (tenta local primeiro)
setup_api_url
log_debug "[MONITOR] API URL configurada: $API_URL"

# Etapa 1: Verificar se container está rodando (health check robusto)
log_debug "[ETAPA 1] Verificando status do container..."
log_debug "[ETAPA 1] Comando: docker inspect -f '{{.State.Running}}' wppconnect-server"

CONTAINER_RUNNING=$(docker inspect -f '{{.State.Running}}' wppconnect-server 2>/dev/null)
CONTAINER_EXISTS=$?

if [ $CONTAINER_EXISTS -ne 0 ]; then
    CONTAINER_STATUS_TEXT="NÃO EXISTE"
    log_debug "[ETAPA 1] ERRO: Container wppconnect-server não existe"
    log_debug "[ETAPA 1] Ação: Tentando reiniciar..."
    restart_container "Container wppconnect-server não existia no sistema"
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
    restart_container "Container estava parado (Running=$CONTAINER_RUNNING)"
    echo "0" > "$DIVERGENCE_FILE"
    log_debug "[MONITOR] Verificação encerrada (container reiniciado)"
    write_monitor_result "$CYCLE_NUMBER"
    log_separator
    exit 0
fi

CONTAINER_STATUS_TEXT="RUNNING ✓"
log_debug "[ETAPA 1] OK: Container está rodando"

# Etapa 2: Verificar se API responde (com retry e backoff exponencial)
log_debug "[ETAPA 2] Verificando se API responde..."
log_debug "[ETAPA 2] URL: ${API_URL}/"
log_debug "[ETAPA 2] Timeout: 10 segundos por tentativa"
log_debug "[ETAPA 2] Máximo de tentativas: 3 (com backoff exponencial)"

# Configuração de retry com backoff exponencial
MAX_RETRIES=3
BASE_RETRY_INTERVAL=2  # Intervalo base em segundos (2, 4, 8...)
RETRY_COUNT=0
API_IS_DOWN=false
API_HTTP_CODE=""
API_BODY=""
API_HEADERS=""

# Loop de retry com backoff exponencial para evitar falsos positivos
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    log_debug "[ETAPA 2] Tentativa $RETRY_COUNT/$MAX_RETRIES..."

    # Capturar resposta completa com headers usando arquivo temporário
    TEMP_HEADERS=$(mktemp)
    TEMP_FILES_TO_CLEAN+=("$TEMP_HEADERS")  # Adicionar à lista de cleanup
    API_BODY=$(curl -s -D "$TEMP_HEADERS" -w "\n%{http_code}" --max-time 10 "${API_URL}/" 2>/dev/null)
    API_HTTP_CODE="${API_BODY##*$'\n'}"
    API_BODY="${API_BODY%$'\n'*}"
    API_HEADERS=$(cat "$TEMP_HEADERS" 2>/dev/null)
    rm -f "$TEMP_HEADERS"

    log_debug "[ETAPA 2] Resposta HTTP: $API_HTTP_CODE"

    # Verificar se a resposta é válida (não é erro 5xx ou falha de conexão)
    if [ "$API_HTTP_CODE" != "000" ] && [ -n "$API_HTTP_CODE" ] && [ "$API_HTTP_CODE" -lt 500 ] 2>/dev/null; then
        log_debug "[ETAPA 2] API respondeu OK na tentativa $RETRY_COUNT"
        break
    fi

    # Se ainda há tentativas, aguardar com backoff exponencial antes de retry
    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
        # Backoff exponencial: 2^(tentativa-1) * base = 2, 4, 8 segundos
        BACKOFF_INTERVAL=$((BASE_RETRY_INTERVAL * (1 << (RETRY_COUNT - 1))))
        log_debug "[ETAPA 2] Tentativa $RETRY_COUNT falhou (HTTP $API_HTTP_CODE)"
        log_debug "[ETAPA 2] Aguardando ${BACKOFF_INTERVAL}s antes da próxima tentativa (backoff exponencial)..."
        sleep $BACKOFF_INTERVAL
    fi
done

# Avaliar resposta final após todas as tentativas:
# - 000 = Falha de conexão (curl não conseguiu conectar)
# - 5xx = Erro interno do servidor
# - 200, 404, 401, 403 = API está respondendo (servidor está UP)
#
# Nota: 404 na rota raiz /api/ é normal - significa que a API está UP mas não tem rota nesse path

if [ "$API_HTTP_CODE" = "000" ]; then
    FLAG_API_ERROR=true
    API_STATUS_TEXT="FALHA CONEXÃO (HTTP 000) após $RETRY_COUNT tentativas"
    log_debug "[ETAPA 2] PROBLEMA: Falha de conexão (HTTP 000) após $RETRY_COUNT tentativas"
    log_debug "[ETAPA 2] Possíveis causas:"
    log_debug "[ETAPA 2]   - Container não está expondo a porta"
    log_debug "[ETAPA 2]   - Problema de rede/DNS"
    log_debug "[ETAPA 2]   - Timeout de conexão"
    API_IS_DOWN=true

    # Capturar diagnóstico
    capture_diagnostic_info "000" "$API_BODY" "$API_HEADERS"

elif [ "$API_HTTP_CODE" -ge 500 ] 2>/dev/null; then
    FLAG_API_ERROR=true

    # Logar headers e corpo para debug
    log_debug "[ETAPA 2] === HEADERS DA RESPOSTA ==="
    echo "$API_HEADERS" | while read -r line; do
        log_debug "[ETAPA 2][HEADER] $line"
    done
    log_debug "[ETAPA 2] === CORPO DA RESPOSTA (primeiros 500 chars) ==="
    log_debug "[ETAPA 2][BODY] ${API_BODY:0:500}"
    log_debug "[ETAPA 2] === FIM DA RESPOSTA ==="

    # Verificar se é erro Cloudflare ou interno
    if is_cloudflare_error "$API_BODY" "$API_HTTP_CODE"; then
        FLAG_CLOUDFLARE_ERROR=true
        API_STATUS_TEXT="ERRO CLOUDFLARE (HTTP $API_HTTP_CODE) após $RETRY_COUNT tentativas"
        log_debug "[ETAPA 2] PROBLEMA: Erro Cloudflare detectado (HTTP $API_HTTP_CODE)"
    elif is_internal_error "$API_BODY" "$API_HTTP_CODE"; then
        FLAG_INTERNAL_ERROR=true
        API_STATUS_TEXT="ERRO INTERNO (HTTP $API_HTTP_CODE) após $RETRY_COUNT tentativas"
        log_debug "[ETAPA 2] PROBLEMA: Erro interno do servidor (HTTP $API_HTTP_CODE)"
    else
        API_STATUS_TEXT="ERRO (HTTP $API_HTTP_CODE) após $RETRY_COUNT tentativas"
        log_debug "[ETAPA 2] PROBLEMA: Erro do servidor (HTTP $API_HTTP_CODE)"
    fi
    log_debug "[ETAPA 2] Possíveis causas:"
    log_debug "[ETAPA 2]   - Serviço com erro fatal"
    log_debug "[ETAPA 2]   - Falta de memória/recursos"
    log_debug "[ETAPA 2]   - Proxy reverso (Cloudflare/nginx) não consegue conectar ao backend"
    API_IS_DOWN=true

    # Capturar diagnóstico completo
    capture_diagnostic_info "$API_HTTP_CODE" "$API_BODY" "$API_HEADERS"

elif [ -z "$API_HTTP_CODE" ]; then
    FLAG_API_ERROR=true
    API_STATUS_TEXT="RESPOSTA VAZIA após $RETRY_COUNT tentativas"
    log_debug "[ETAPA 2] PROBLEMA: Resposta vazia do curl"
    API_IS_DOWN=true

    # Capturar diagnóstico
    capture_diagnostic_info "EMPTY" "$API_BODY" "$API_HEADERS"
fi

if [ "$API_IS_DOWN" = true ]; then
    # NOTA: Não reiniciar automaticamente quando API não responde
    # O problema pode ser externo (Cloudflare, DNS, rede) e não do container
    # Apenas registrar o incidente e enviar alerta
    log_debug "[ETAPA 2] API não está respondendo - NÃO será feito restart automático"
    log_debug "[ETAPA 2] Motivo: O problema pode ser externo (Cloudflare, DNS, rede)"
    log_debug "[ETAPA 2] Ação: Registrar incidente e enviar alerta para verificação manual"

    # Registrar incidente
    log_incident "API NÃO RESPONDE" "A API não respondeu após $RETRY_COUNT tentativas.
HTTP Code: $API_HTTP_CODE
Cloudflare Error: $(bool_to_text $FLAG_CLOUDFLARE_ERROR)
Internal Error: $(bool_to_text $FLAG_INTERNAL_ERROR)
NOTA: Restart automático DESABILITADO - verificação manual pode ser necessária."

    # Enviar alerta via WhatsApp (sem fazer restart)
    send_notification "alerta" "API não está respondendo após $RETRY_COUNT tentativas (HTTP $API_HTTP_CODE). Restart automático está desabilitado. Verifique manualmente se necessário." ""

    log_debug "[MONITOR] Verificação encerrada (API não respondia - sem restart automático)"
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
        SESSIONS_DATA=$(sqlite3 -separator '|' "$DB_PATH" "$QUERY" 2>&1)
        SQLITE_EXIT_CODE=$?

        # Verificar se a consulta SQLite falhou
        if [ $SQLITE_EXIT_CODE -ne 0 ]; then
            log_debug "[ETAPA 3] ERRO: Falha na consulta SQLite (exit code: $SQLITE_EXIT_CODE)"
            log_debug "[ETAPA 3] Mensagem de erro: $SESSIONS_DATA"
            log_debug "[ETAPA 3] Possíveis causas:"
            log_debug "[ETAPA 3]   - Banco de dados corrompido"
            log_debug "[ETAPA 3]   - Banco de dados bloqueado (locked)"
            log_debug "[ETAPA 3]   - Permissões insuficientes"
            log_debug "[ETAPA 3]   - Tabela cadastros_sessaowpp não existe"
            log_incident "ERRO SQLITE" "Falha ao consultar banco de dados.
Exit code: $SQLITE_EXIT_CODE
Erro: $SESSIONS_DATA
Banco: $DB_PATH"
            SESSIONS_DATA=""  # Limpar para evitar processamento incorreto
        elif [ -z "$SESSIONS_DATA" ]; then
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

    # Limpar estado de problema persistente quando tudo está OK
    clear_problem_state
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
