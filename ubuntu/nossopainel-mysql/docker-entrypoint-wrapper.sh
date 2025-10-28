#!/bin/bash
# ==============================================================================
# Wrapper para Entrypoint do MySQL 5.7
# ==============================================================================
# Este script:
# 1. Inicia o cron (para backups automáticos)
# 2. Chama o entrypoint original do MySQL
# ==============================================================================

set -e

echo "================================================"
echo "MySQL 5.7 - Nosso Painel Gestão"
echo "================================================"

# Inicia cron em background para backups automáticos
echo "Iniciando cron para backups automáticos..."
service cron start

echo "Iniciando MySQL..."
echo "================================================"

# Chama o entrypoint original do MySQL 5.7
# Passa todos os argumentos recebidos ($@)
exec /usr/local/bin/docker-entrypoint.sh "$@"
