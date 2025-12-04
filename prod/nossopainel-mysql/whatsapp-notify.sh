#!/bin/bash
###############################################################################
# Função Helper - Notificações WhatsApp via Django API Interna
#
# Uso:
#   source /usr/local/bin/whatsapp-notify.sh
#   send_whatsapp "Mensagem aqui" "tipo_notificacao"
#
# Exemplos:
#   send_whatsapp "Backup concluído com sucesso!" "backup_success"
#   send_whatsapp "ERRO: Falha no backup" "backup_error"
#   send_whatsapp "Alerta: Disk usage 85%" "monitor_alert"
###############################################################################

# URL do endpoint Django (mesma rede Docker interna)
DJANGO_URL="${DJANGO_INTERNAL_URL:-http://nossopainel-django:8001}"
WHATSAPP_ENDPOINT="${DJANGO_URL}/api/internal/send-whatsapp/"

# Timeout para requisições HTTP
HTTP_TIMEOUT=10

###############################################################################
# Função: send_whatsapp
# Envia notificação WhatsApp via endpoint Django interno
#
# Parâmetros:
#   $1 - mensagem (obrigatório)
#   $2 - tipo (opcional, default: "notification")
#
# Retorno:
#   0 - Sucesso
#   1 - Erro na requisição
#   2 - Erro de validação (400)
#   3 - Erro de acesso (403)
#   4 - Erro de serviço (503)
###############################################################################
send_whatsapp() {
    local mensagem="$1"
    local tipo="${2:-notification}"

    # Validação de parâmetros
    if [ -z "$mensagem" ]; then
        echo "⚠️  AVISO: send_whatsapp() chamado sem mensagem" >&2
        return 1
    fi

    # Escapa aspas duplas na mensagem (JSON encoding básico)
    mensagem_escaped=$(echo "$mensagem" | sed 's/"/\\"/g')

    # Cria payload JSON
    local payload=$(cat <<EOF
{
  "mensagem": "${mensagem_escaped}",
  "tipo": "${tipo}"
}
EOF
)

    # Envia requisição HTTP POST
    local http_code
    local response

    response=$(curl -s -w "\n%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d "$payload" \
        --max-time "$HTTP_TIMEOUT" \
        "$WHATSAPP_ENDPOINT" 2>/dev/null)

    # Extrai código HTTP da última linha
    http_code=$(echo "$response" | tail -n 1)
    response_body=$(echo "$response" | head -n -1)

    # Analisa resultado
    case "$http_code" in
        200)
            # Sucesso
            return 0
            ;;
        400)
            echo "⚠️  AVISO: Payload inválido ao enviar notificação WhatsApp" >&2
            return 2
            ;;
        403)
            echo "⚠️  AVISO: Acesso negado ao endpoint WhatsApp (IP não na whitelist)" >&2
            return 3
            ;;
        503)
            echo "⚠️  AVISO: Sessão WhatsApp não encontrada ou inativa" >&2
            return 4
            ;;
        "")
            echo "⚠️  AVISO: Falha na conexão com Django em $WHATSAPP_ENDPOINT" >&2
            return 1
            ;;
        *)
            echo "⚠️  AVISO: Erro ao enviar notificação WhatsApp (HTTP $http_code)" >&2
            return 1
            ;;
    esac
}

###############################################################################
# Função: send_whatsapp_silent
# Igual a send_whatsapp mas não exibe avisos em stderr
# Útil para cron jobs que devem rodar silenciosamente
###############################################################################
send_whatsapp_silent() {
    send_whatsapp "$1" "$2" 2>/dev/null
}

###############################################################################
# Função: format_backup_notification
# Formata mensagem padrão de backup
#
# Parâmetros:
#   $1 - status (success/error)
#   $2 - backup_file (caminho do arquivo)
#   $3 - size (tamanho do arquivo)
#   $4 - duration (tempo em segundos)
###############################################################################
format_backup_notification() {
    local status="$1"
    local backup_file="$2"
    local size="$3"
    local duration="$4"

    if [ "$status" = "success" ]; then
        cat <<EOF
✅ Backup MySQL Concluído

📅 Data: $(date '+%d/%m/%Y %H:%M:%S')
📦 Arquivo: $(basename "$backup_file")
💾 Tamanho: $size
⏱️  Duração: ${duration}s
🔧 Banco: nossopaineldb

Status: Sucesso ✅
EOF
    else
        cat <<EOF
❌ ERRO no Backup MySQL

📅 Data: $(date '+%d/%m/%Y %H:%M:%S')
🔧 Banco: nossopaineldb
⚠️  Status: FALHOU

Verifique os logs do container MySQL para mais detalhes.
EOF
    fi
}

###############################################################################
# Função: format_monitor_alert
# Formata mensagem padrão de alerta de monitoramento
#
# Parâmetros:
#   $1 - tipo_alerta (disk/connections/slow_queries)
#   $2 - valor_atual
#   $3 - limite
###############################################################################
format_monitor_alert() {
    local tipo="$1"
    local valor="$2"
    local limite="$3"

    case "$tipo" in
        disk)
            cat <<EOF
⚠️ ALERTA: Disk Usage MySQL

📅 Data: $(date '+%d/%m/%Y %H:%M:%S')
💾 Uso atual: ${valor}%
⚠️  Limite: ${limite}%

O espaço em disco está acima do limite configurado.
Considere limpar backups antigos ou expandir o volume.
EOF
            ;;
        connections)
            cat <<EOF
⚠️ ALERTA: Conexões MySQL

📅 Data: $(date '+%d/%m/%Y %H:%M:%S')
🔌 Conexões ativas: $valor
⚠️  Limite: $limite

O número de conexões está próximo do máximo.
Verifique se há conexões travadas ou vazamentos.
EOF
            ;;
        slow_queries)
            cat <<EOF
⚠️ ALERTA: Slow Queries MySQL

📅 Data: $(date '+%d/%m/%Y %H:%M:%S')
🐌 Queries lentas (últimas 6h): $valor
⚠️  Limite: $limite

Número elevado de queries lentas detectado.
Analise o slow query log para otimizações.
EOF
            ;;
        *)
            echo "⚠️ ALERTA MySQL: $tipo - Valor: $valor (Limite: $limite)"
            ;;
    esac
}

# Exporta funções para uso em outros scripts
export -f send_whatsapp
export -f send_whatsapp_silent
export -f format_backup_notification
export -f format_monitor_alert
