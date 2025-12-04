#!/bin/bash
###############################################################################
# Script de Monitoramento MySQL - Nosso Painel Gestão
#
# Executado periodicamente via cron (a cada 6 horas)
# Monitora: conexões, slow queries, disk usage, uptime, tamanho do banco
# Envia alertas via WhatsApp quando limites são ultrapassados
###############################################################################

# Carrega funções de notificação WhatsApp
if [ -f /usr/local/bin/whatsapp-notify.sh ]; then
    source /usr/local/bin/whatsapp-notify.sh
else
    echo "AVISO: whatsapp-notify.sh não encontrado. Alertas desabilitados."
    send_whatsapp() { return 0; }
    format_monitor_alert() { echo "$@"; }
fi

# Configurações
DB_NAME="${MYSQL_DATABASE:-nossopaineldb}"
LOG_DIR="/var/log/mysql"
LOG_FILE="${LOG_DIR}/monitor.log"
SLOW_QUERY_LOG="/var/log/mysql/mysql-slow.log"

# Limites para alertas
DISK_USAGE_THRESHOLD=80        # Alerta se uso > 80%
CONNECTIONS_THRESHOLD_PCT=80   # Alerta se conexões > 80% do max
SLOW_QUERIES_THRESHOLD=50      # Alerta se > 50 slow queries nas últimas 6h

# Garante que diretório de log existe
mkdir -p "$LOG_DIR"

# Função de log
log() {
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$message" | tee -a "$LOG_FILE"
}

# Início do monitoramento
log "======================================================================"
log "Monitoramento MySQL - Nosso Painel Gestão"
log "======================================================================"

# Verifica se MySQL está respondendo
if ! mysqladmin ping -h localhost -u root --silent 2>/dev/null; then
    log "❌ ERRO: MySQL não está respondendo!"

    # Envia alerta crítico
    ALERT_MSG="🚨 ALERTA CRÍTICO: MySQL Offline

📅 Data: $(date '+%d/%m/%Y %H:%M:%S')
⚠️  MySQL não está respondendo

O serviço pode estar parado ou travado.
Verifique os logs imediatamente!"

    send_whatsapp_silent "$ALERT_MSG" "monitor_critical"
    exit 1
fi

log "✓ MySQL está respondendo"
log ""

# ==============================================================================
# 1. MONITORAMENTO DE CONEXÕES
# ==============================================================================
log "📊 Conexões MySQL:"

MAX_CONNECTIONS=$(mysql -se "SHOW VARIABLES LIKE 'max_connections'" | awk '{print $2}')
CURRENT_CONNECTIONS=$(mysql -se "SHOW STATUS LIKE 'Threads_connected'" | awk '{print $2}')
CONNECTIONS_PCT=$(echo "scale=1; ($CURRENT_CONNECTIONS / $MAX_CONNECTIONS) * 100" | bc 2>/dev/null || echo "0")

log "   Conexões ativas: $CURRENT_CONNECTIONS / $MAX_CONNECTIONS (${CONNECTIONS_PCT}%)"

# Verifica se ultrapassou limite
CONNECTIONS_THRESHOLD=$((MAX_CONNECTIONS * CONNECTIONS_THRESHOLD_PCT / 100))
if [ "$CURRENT_CONNECTIONS" -gt "$CONNECTIONS_THRESHOLD" ]; then
    log "   ⚠️  ALERTA: Conexões acima de ${CONNECTIONS_THRESHOLD_PCT}%"

    ALERT_MSG=$(format_monitor_alert "connections" "$CURRENT_CONNECTIONS" "$CONNECTIONS_THRESHOLD")
    send_whatsapp_silent "$ALERT_MSG" "monitor_alert_connections"
fi

# Top 5 usuários com mais conexões
log "   Top usuários:"
mysql -se "SELECT user, host, COUNT(*) as connections FROM information_schema.processlist GROUP BY user, host ORDER BY connections DESC LIMIT 5" | while read -r line; do
    log "      $line"
done

log ""

# ==============================================================================
# 2. MONITORAMENTO DE SLOW QUERIES
# ==============================================================================
log "🐌 Slow Queries:"

# Conta slow queries do MySQL (total acumulado)
SLOW_QUERIES_TOTAL=$(mysql -se "SHOW GLOBAL STATUS LIKE 'Slow_queries'" | awk '{print $2}')
log "   Total acumulado: $SLOW_QUERIES_TOTAL"

# Se slow query log existe, analisa últimas 6 horas
if [ -f "$SLOW_QUERY_LOG" ]; then
    # Conta quantas linhas do tipo "# Time:" existem nas últimas 6 horas
    SIX_HOURS_AGO=$(date -d '6 hours ago' '+%y%m%d %H' 2>/dev/null || date -v-6H '+%y%m%d %H' 2>/dev/null)
    SLOW_QUERIES_6H=$(grep -c "^# Time:" "$SLOW_QUERY_LOG" 2>/dev/null || echo "0")

    log "   Últimas 6h (aprox): $SLOW_QUERIES_6H"

    if [ "$SLOW_QUERIES_6H" -gt "$SLOW_QUERIES_THRESHOLD" ]; then
        log "   ⚠️  ALERTA: Muitas slow queries detectadas"

        ALERT_MSG=$(format_monitor_alert "slow_queries" "$SLOW_QUERIES_6H" "$SLOW_QUERIES_THRESHOLD")

        # Lista top 3 queries mais lentas (simplificado)
        TOP_QUERIES=$(grep "^# Query_time:" "$SLOW_QUERY_LOG" | tail -3 | awk '{print $3}' | sort -rn | head -3)
        if [ -n "$TOP_QUERIES" ]; then
            ALERT_MSG="$ALERT_MSG

🔝 Top tempos (últimas 3):
$(echo "$TOP_QUERIES" | while read qt; do echo "   • ${qt}s"; done)"
        fi

        send_whatsapp_silent "$ALERT_MSG" "monitor_alert_slow_queries"
    fi
else
    log "   Slow query log não encontrado: $SLOW_QUERY_LOG"
fi

log ""

# ==============================================================================
# 3. MONITORAMENTO DE DISK USAGE
# ==============================================================================
log "💾 Disk Usage:"

# Verifica /var/lib/mysql (dados)
DATA_DIR="/var/lib/mysql"
if [ -d "$DATA_DIR" ]; then
    DATA_USAGE=$(df -h "$DATA_DIR" | tail -1 | awk '{print $5}' | sed 's/%//')
    DATA_USED=$(df -h "$DATA_DIR" | tail -1 | awk '{print $3}')
    DATA_AVAIL=$(df -h "$DATA_DIR" | tail -1 | awk '{print $4}')

    log "   Dados ($DATA_DIR): ${DATA_USAGE}% (usado: $DATA_USED, disponível: $DATA_AVAIL)"

    if [ "$DATA_USAGE" -gt "$DISK_USAGE_THRESHOLD" ]; then
        log "   ⚠️  ALERTA: Uso de disco acima de ${DISK_USAGE_THRESHOLD}%"

        ALERT_MSG=$(format_monitor_alert "disk" "$DATA_USAGE" "$DISK_USAGE_THRESHOLD")
        ALERT_MSG="$ALERT_MSG

📂 Partição: /var/lib/mysql
💾 Usado: $DATA_USED
✅ Disponível: $DATA_AVAIL"

        send_whatsapp_silent "$ALERT_MSG" "monitor_alert_disk"
    fi
fi

# Verifica /backups
BACKUP_DIR="/backups"
if [ -d "$BACKUP_DIR" ]; then
    BACKUP_USAGE=$(df -h "$BACKUP_DIR" | tail -1 | awk '{print $5}' | sed 's/%//')
    BACKUP_USED=$(df -h "$BACKUP_DIR" | tail -1 | awk '{print $3}')
    BACKUP_AVAIL=$(df -h "$BACKUP_DIR" | tail -1 | awk '{print $4}')

    log "   Backups ($BACKUP_DIR): ${BACKUP_USAGE}% (usado: $BACKUP_USED, disponível: $BACKUP_AVAIL)"

    # Conta número de backups
    BACKUP_COUNT=$(find "$BACKUP_DIR" -name "nossopaineldb_*.sql.gz" 2>/dev/null | wc -l)
    log "   Total de backups: $BACKUP_COUNT"

    if [ "$BACKUP_USAGE" -gt "$DISK_USAGE_THRESHOLD" ]; then
        log "   ⚠️  ALERTA: Uso de disco de backups acima de ${DISK_USAGE_THRESHOLD}%"

        ALERT_MSG=$(format_monitor_alert "disk" "$BACKUP_USAGE" "$DISK_USAGE_THRESHOLD")
        ALERT_MSG="$ALERT_MSG

📂 Partição: /backups
💾 Usado: $BACKUP_USED
✅ Disponível: $BACKUP_AVAIL
📦 Backups armazenados: $BACKUP_COUNT

💡 Considere reduzir o período de retenção de backups."

        send_whatsapp_silent "$ALERT_MSG" "monitor_alert_backup_disk"
    fi
fi

log ""

# ==============================================================================
# 4. UPTIME E STATUS GERAL
# ==============================================================================
log "⏱️  Uptime e Performance:"

UPTIME_SECONDS=$(mysql -se "SHOW GLOBAL STATUS LIKE 'Uptime'" | awk '{print $2}')
UPTIME_DAYS=$(echo "scale=1; $UPTIME_SECONDS / 86400" | bc 2>/dev/null || echo "0")
UPTIME_HOURS=$(echo "scale=0; $UPTIME_SECONDS / 3600" | bc 2>/dev/null || echo "0")

log "   Uptime: ${UPTIME_DAYS} dias (${UPTIME_HOURS}h)"

# Queries por segundo (média)
TOTAL_QUERIES=$(mysql -se "SHOW GLOBAL STATUS LIKE 'Questions'" | awk '{print $2}')
QPS=$(echo "scale=2; $TOTAL_QUERIES / $UPTIME_SECONDS" | bc 2>/dev/null || echo "0")
log "   Queries por segundo (média): $QPS"

# Threads em execução
THREADS_RUNNING=$(mysql -se "SHOW STATUS LIKE 'Threads_running'" | awk '{print $2}')
log "   Threads em execução: $THREADS_RUNNING"

# InnoDB buffer pool usage
BUFFER_POOL_SIZE=$(mysql -se "SHOW VARIABLES LIKE 'innodb_buffer_pool_size'" | awk '{print $2}')
BUFFER_POOL_SIZE_MB=$(echo "scale=0; $BUFFER_POOL_SIZE / 1024 / 1024" | bc 2>/dev/null || echo "0")
log "   InnoDB buffer pool: ${BUFFER_POOL_SIZE_MB} MB"

log ""

# ==============================================================================
# 5. ESTATÍSTICAS DO BANCO DE DADOS
# ==============================================================================
log "📊 Banco de Dados '$DB_NAME':"

# Tamanho total do banco
DB_SIZE_MB=$(mysql -se "SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) FROM information_schema.tables WHERE table_schema='${DB_NAME}'" 2>/dev/null || echo "0")
log "   Tamanho: ${DB_SIZE_MB} MB"

# Número de tabelas
TABLE_COUNT=$(mysql -D ${DB_NAME} -se "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}'" 2>/dev/null || echo "0")
log "   Tabelas: $TABLE_COUNT"

# Top 5 maiores tabelas
log "   Maiores tabelas (top 5):"
mysql -D ${DB_NAME} -se "
SELECT
    table_name,
    ROUND((data_length + index_length) / 1024 / 1024, 2) AS size_mb,
    table_rows
FROM information_schema.tables
WHERE table_schema='${DB_NAME}'
ORDER BY (data_length + index_length) DESC
LIMIT 5
" | while read -r table size rows; do
    log "      $table: ${size} MB (${rows} rows)"
done

# Registros em tabelas principais (se existirem)
log ""
log "   Registros principais:"
USERS=$(mysql -D ${DB_NAME} -se "SELECT COUNT(*) FROM auth_user" 2>/dev/null || echo "N/A")
CLIENTES=$(mysql -D ${DB_NAME} -se "SELECT COUNT(*) FROM cadastros_cliente" 2>/dev/null || echo "N/A")
MENSALIDADES=$(mysql -D ${DB_NAME} -se "SELECT COUNT(*) FROM cadastros_mensalidade" 2>/dev/null || echo "N/A")

if [ "$USERS" != "N/A" ]; then
    log "      Usuários (auth_user): $USERS"
fi
if [ "$CLIENTES" != "N/A" ]; then
    log "      Clientes (cadastros_cliente): $CLIENTES"
fi
if [ "$MENSALIDADES" != "N/A" ]; then
    log "      Mensalidades (cadastros_mensalidade): $MENSALIDADES"
fi

log ""

# ==============================================================================
# 6. VERIFICAÇÃO DE REPLICAÇÃO (se aplicável)
# ==============================================================================
SLAVE_STATUS=$(mysql -se "SHOW SLAVE STATUS\G" 2>/dev/null)
if [ -n "$SLAVE_STATUS" ]; then
    log "🔄 Replicação:"
    SLAVE_IO=$(echo "$SLAVE_STATUS" | grep "Slave_IO_Running:" | awk '{print $2}')
    SLAVE_SQL=$(echo "$SLAVE_STATUS" | grep "Slave_SQL_Running:" | awk '{print $2}')

    log "   Slave IO: $SLAVE_IO"
    log "   Slave SQL: $SLAVE_SQL"

    if [ "$SLAVE_IO" != "Yes" ] || [ "$SLAVE_SQL" != "Yes" ]; then
        log "   ⚠️  ALERTA: Replicação não está funcionando!"

        ALERT_MSG="🚨 ALERTA: Replicação MySQL Parada

📅 Data: $(date '+%d/%m/%Y %H:%M:%S')
⚠️  Slave IO: $SLAVE_IO
⚠️  Slave SQL: $SLAVE_SQL

A replicação não está funcionando corretamente.
Verifique os logs do MySQL para mais detalhes."

        send_whatsapp_silent "$ALERT_MSG" "monitor_alert_replication"
    fi
    log ""
fi

# ==============================================================================
# 7. ROTAÇÃO DE LOGS
# ==============================================================================
if [ -f "$LOG_FILE" ]; then
    LOG_SIZE_BYTES=$(stat -c%s "$LOG_FILE" 2>/dev/null || stat -f%z "$LOG_FILE" 2>/dev/null)

    # Se log ficar muito grande (>5MB), rotaciona
    if [ "$LOG_SIZE_BYTES" -gt 5242880 ]; then
        log "Rotacionando arquivo de log ($(du -h "$LOG_FILE" | cut -f1))"
        mv "$LOG_FILE" "${LOG_FILE}.$(date +%Y%m%d_%H%M%S)"

        # Remove logs muito antigos (>30 dias)
        find "$LOG_DIR" -name "monitor.log.*" -mtime +30 -delete 2>/dev/null
    fi
fi

log "======================================================================"
log "Monitoramento concluído"
log "======================================================================"
log ""

exit 0
