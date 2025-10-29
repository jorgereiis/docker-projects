#!/bin/bash
###############################################################################
# Script de Backup Automático MySQL - Nosso Painel Gestão
#
# Executado diariamente às 2h da manhã via cron
# Cria backup compactado e mantém apenas últimos 7 dias
# Envia notificações via WhatsApp (API interna Django)
###############################################################################

# Carrega funções de notificação WhatsApp
if [ -f /usr/local/bin/whatsapp-notify.sh ]; then
    source /usr/local/bin/whatsapp-notify.sh
else
    echo "AVISO: whatsapp-notify.sh não encontrado. Notificações desabilitadas."
    # Define funções dummy para não quebrar o script
    send_whatsapp() { return 0; }
    format_backup_notification() { echo "$@"; }
fi

# Configurações
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DATE_READABLE=$(date '+%d/%m/%Y %H:%M:%S')
BACKUP_DIR="/backups"
BACKUP_FILE="${BACKUP_DIR}/nossopaineldb_${TIMESTAMP}.sql.gz"
DB_NAME="${MYSQL_DATABASE:-nossopaineldb}"
LOG_DIR="/var/log/mysql"
LOG_FILE="${LOG_DIR}/backup.log"
RETENTION_DAYS=7

# Garante que diretórios existem
mkdir -p "$BACKUP_DIR"
mkdir -p "$LOG_DIR"

# Função de log (tanto em arquivo quanto stdout)
log() {
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$message" | tee -a "$LOG_FILE"
}

# Função de log de erro
log_error() {
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] ❌ ERRO: $1"
    echo "$message" | tee -a "$LOG_FILE" >&2
}

# Início do backup
log "======================================================================"
log "Iniciando backup automático do MySQL"
log "======================================================================"
log "Banco: $DB_NAME"
log "Destino: $BACKUP_FILE"

# Verifica espaço em disco antes de começar
DISK_AVAILABLE=$(df -BG "$BACKUP_DIR" | tail -1 | awk '{print $4}' | sed 's/G//')
if [ "$DISK_AVAILABLE" -lt 1 ]; then
    log_error "Espaço em disco insuficiente: apenas ${DISK_AVAILABLE}GB disponível"

    # Envia notificação de erro
    NOTIFICATION=$(format_backup_notification "error" "$BACKUP_FILE" "N/A" "0")
    NOTIFICATION="$NOTIFICATION

⚠️ Espaço em disco insuficiente: ${DISK_AVAILABLE}GB"
    send_whatsapp_silent "$NOTIFICATION" "backup_error"

    exit 1
fi

log "Espaço disponível: ${DISK_AVAILABLE}GB"

# Verifica se MySQL está respondendo
if ! mysqladmin ping -h localhost -u root --silent 2>/dev/null; then
    log_error "MySQL não está respondendo"

    NOTIFICATION=$(format_backup_notification "error" "$BACKUP_FILE" "N/A" "0")
    NOTIFICATION="$NOTIFICATION

⚠️ MySQL não está respondendo"
    send_whatsapp_silent "$NOTIFICATION" "backup_error"

    exit 1
fi

log "MySQL está respondendo ✓"

# Obtém estatísticas do banco ANTES do backup
log ""
log "Coletando estatísticas do banco..."

TABLE_COUNT=$(mysql -D ${DB_NAME} -se "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}'" 2>/dev/null || echo "0")
DB_SIZE_MB=$(mysql -se "SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) FROM information_schema.tables WHERE table_schema='${DB_NAME}'" 2>/dev/null || echo "0")

log "   Tabelas: $TABLE_COUNT"
log "   Tamanho do banco: ${DB_SIZE_MB} MB"

# Inicia cronômetro
BACKUP_START=$(date +%s)

log ""
log "Criando dump do banco '$DB_NAME'..."

# Cria backup com mysqldump
if mysqldump \
    -u root \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    --default-character-set=utf8mb4 \
    --add-drop-table \
    --quick \
    --lock-tables=false \
    "$DB_NAME" 2>/tmp/mysqldump_error.log | gzip -9 > "$BACKUP_FILE"; then

    # Calcula duração
    BACKUP_END=$(date +%s)
    BACKUP_DURATION=$((BACKUP_END - BACKUP_START))

    # Verifica se arquivo foi criado
    if [ -f "$BACKUP_FILE" ]; then
        BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        BACKUP_SIZE_BYTES=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null)

        log "Backup criado com sucesso!"
        log "   Arquivo: $(basename $BACKUP_FILE)"
        log "   Tamanho: $BACKUP_SIZE (${BACKUP_SIZE_BYTES} bytes)"
        log "   Duração: ${BACKUP_DURATION}s"

        # Valida integridade do arquivo .gz
        log ""
        log "Validando integridade do backup..."

        if gunzip -t "$BACKUP_FILE" 2>/dev/null; then
            log "   ✓ Arquivo .gz válido"

            # Calcula checksum MD5
            if command -v md5sum >/dev/null 2>&1; then
                MD5=$(md5sum "$BACKUP_FILE" | cut -d' ' -f1)
                log "   MD5: $MD5"

                # Salva checksum em arquivo separado
                echo "$MD5  $(basename $BACKUP_FILE)" > "${BACKUP_FILE}.md5"
            fi

            # Calcula taxa de compressão
            UNCOMPRESSED_SIZE=$(gunzip -l "$BACKUP_FILE" | tail -1 | awk '{print $2}')
            if [ "$UNCOMPRESSED_SIZE" -gt 0 ]; then
                COMPRESSION_RATIO=$(echo "scale=1; (1 - $BACKUP_SIZE_BYTES / $UNCOMPRESSED_SIZE) * 100" | bc 2>/dev/null || echo "N/A")
                if [ "$COMPRESSION_RATIO" != "N/A" ]; then
                    log "   Taxa de compressão: ${COMPRESSION_RATIO}%"
                fi
            fi

            # Envia notificação de SUCESSO via WhatsApp
            NOTIFICATION=$(format_backup_notification "success" "$BACKUP_FILE" "$BACKUP_SIZE" "$BACKUP_DURATION")
            NOTIFICATION="$NOTIFICATION

📊 Estatísticas:
   • Tabelas: $TABLE_COUNT
   • Tamanho do banco: ${DB_SIZE_MB} MB"

            if send_whatsapp_silent "$NOTIFICATION" "backup_success"; then
                log "   ✓ Notificação WhatsApp enviada"
            fi

        else
            log_error "Arquivo de backup está corrompido!"

            # Envia notificação de ERRO
            NOTIFICATION=$(format_backup_notification "error" "$BACKUP_FILE" "$BACKUP_SIZE" "$BACKUP_DURATION")
            NOTIFICATION="$NOTIFICATION

⚠️ Arquivo está corrompido e não pode ser restaurado"
            send_whatsapp_silent "$NOTIFICATION" "backup_error"

            # Remove arquivo corrompido
            rm -f "$BACKUP_FILE"
            exit 1
        fi

    else
        log_error "Arquivo de backup não foi criado!"

        NOTIFICATION=$(format_backup_notification "error" "$BACKUP_FILE" "N/A" "$BACKUP_DURATION")
        NOTIFICATION="$NOTIFICATION

⚠️ Arquivo de backup não foi criado no disco"
        send_whatsapp_silent "$NOTIFICATION" "backup_error"

        exit 1
    fi
else
    # mysqldump falhou
    BACKUP_END=$(date +%s)
    BACKUP_DURATION=$((BACKUP_END - BACKUP_START))

    log_error "mysqldump falhou!"

    if [ -f /tmp/mysqldump_error.log ]; then
        log "Detalhes do erro:"
        cat /tmp/mysqldump_error.log | tee -a "$LOG_FILE"
    fi

    NOTIFICATION=$(format_backup_notification "error" "$BACKUP_FILE" "N/A" "$BACKUP_DURATION")
    if [ -f /tmp/mysqldump_error.log ]; then
        ERROR_DETAIL=$(head -3 /tmp/mysqldump_error.log | tr '\n' ' ')
        NOTIFICATION="$NOTIFICATION

⚠️ Erro: $ERROR_DETAIL"
    fi
    send_whatsapp_silent "$NOTIFICATION" "backup_error"

    exit 1
fi

# Remove backups antigos (mantém últimos N dias)
log ""
log "Limpando backups antigos (>${RETENTION_DAYS} dias)..."

# Lista arquivos antes da limpeza
BEFORE_COUNT=$(find "$BACKUP_DIR" -name "nossopaineldb_*.sql.gz" 2>/dev/null | wc -l)

# Remove arquivos antigos
find "$BACKUP_DIR" -name "nossopaineldb_*.sql.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null
find "$BACKUP_DIR" -name "nossopaineldb_*.sql.gz.md5" -mtime +${RETENTION_DAYS} -delete 2>/dev/null

# Lista arquivos após limpeza
AFTER_COUNT=$(find "$BACKUP_DIR" -name "nossopaineldb_*.sql.gz" 2>/dev/null | wc -l)
DELETED=$((BEFORE_COUNT - AFTER_COUNT))

if [ "$DELETED" -gt 0 ]; then
    log "   Removidos: $DELETED arquivo(s)"
else
    log "   Nenhum backup antigo para remover"
fi

log "   Total de backups mantidos: $AFTER_COUNT"

# Lista backups existentes
log ""
log "Backups disponíveis (últimos 5):"
ls -lh "$BACKUP_DIR"/nossopaineldb_*.sql.gz 2>/dev/null | tail -5 | while read -r line; do
    log "   $line"
done

# Espaço em disco após backup
DISK_USED=$(df -h "$BACKUP_DIR" | tail -1 | awk '{print $5}')
log ""
log "Uso do disco (${BACKUP_DIR}): $DISK_USED"

# Rotação de logs (mantém últimos 30 dias)
if [ -f "$LOG_FILE" ]; then
    LOG_SIZE=$(du -h "$LOG_FILE" | cut -f1)
    LOG_LINES=$(wc -l < "$LOG_FILE")

    # Se log ficar muito grande (>10MB ou >50000 linhas), rotaciona
    LOG_SIZE_BYTES=$(stat -c%s "$LOG_FILE" 2>/dev/null || stat -f%z "$LOG_FILE" 2>/dev/null)
    if [ "$LOG_SIZE_BYTES" -gt 10485760 ] || [ "$LOG_LINES" -gt 50000 ]; then
        log "Rotacionando arquivo de log (tamanho: $LOG_SIZE, linhas: $LOG_LINES)"
        mv "$LOG_FILE" "${LOG_FILE}.$(date +%Y%m%d_%H%M%S)"

        # Remove logs muito antigos (>30 dias)
        find "$LOG_DIR" -name "backup.log.*" -mtime +30 -delete 2>/dev/null
    fi
fi

log ""
log "======================================================================"
log "Backup automático concluído com sucesso!"
log "======================================================================"
log ""

exit 0
