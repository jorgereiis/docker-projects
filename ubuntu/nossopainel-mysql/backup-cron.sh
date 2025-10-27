#!/bin/bash
###############################################################################
# Script de Backup Automático MySQL - Nosso Painel Gestão
#
# Executado diariamente às 3h da manhã via cron
# Cria backup compactado e mantém apenas últimos 7 dias
###############################################################################

set -e

# Configurações
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="/backups"
BACKUP_FILE="${BACKUP_DIR}/nossopaineldb_${TIMESTAMP}.sql.gz"
DB_NAME="nossopaineldb"

# Garante que diretório de backup existe
mkdir -p "$BACKUP_DIR"

echo "======================================================================"
echo "[$(date)] Iniciando backup automático do MySQL"
echo "======================================================================"

# Verifica se variável de senha existe
if [ -z "$MYSQL_ROOT_PASSWORD" ]; then
    echo "❌ ERRO: MYSQL_ROOT_PASSWORD não definida!"
    exit 1
fi

# Cria backup
echo "📦 Criando dump do banco '$DB_NAME'..."

if mysqldump \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    --default-character-set=utf8mb4 \
    --add-drop-table \
    --quick \
    --lock-tables=false \
    "$DB_NAME" | gzip -9 > "$BACKUP_FILE"; then

    # Verifica se arquivo foi criado
    if [ -f "$BACKUP_FILE" ]; then
        BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        echo "✅ Backup criado com sucesso!"
        echo "   Arquivo: $BACKUP_FILE"
        echo "   Tamanho: $BACKUP_SIZE"
    else
        echo "❌ ERRO: Arquivo de backup não foi criado!"
        exit 1
    fi
else
    echo "❌ ERRO ao criar backup!"
    exit 1
fi

# Remove backups antigos (mantém últimos 7 dias)
echo ""
echo "🧹 Limpando backups antigos (>7 dias)..."

DELETED=$(find "$BACKUP_DIR" -name "nossopaineldb_*.sql.gz" -mtime +7 -delete -print | wc -l)

if [ "$DELETED" -gt 0 ]; then
    echo "   Removidos: $DELETED arquivo(s)"
else
    echo "   Nenhum backup antigo para remover"
fi

# Lista backups existentes
echo ""
echo "📁 Backups disponíveis:"
ls -lh "$BACKUP_DIR"/nossopaineldb_*.sql.gz 2>/dev/null | tail -5 || echo "   Nenhum backup encontrado"

echo "======================================================================"
echo "✅ Backup automático concluído com sucesso!"
echo "======================================================================"
