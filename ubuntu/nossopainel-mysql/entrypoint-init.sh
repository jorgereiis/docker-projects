#!/bin/bash
###############################################################################
# Entrypoint Wrapper - Nosso Painel MySQL Container
#
# Este script é executado ANTES do entrypoint padrão do MySQL
# Funções:
# 1. Inicia o cron daemon (para backups e monitoramento automáticos)
# 2. Chama o entrypoint original do MySQL (docker-entrypoint.sh)
###############################################################################

set -e

echo "======================================================================"
echo "Entrypoint Init - Nosso Painel MySQL"
echo "======================================================================"

# Inicia o cron daemon em background
if command -v cron >/dev/null 2>&1; then
    echo "✓ Iniciando cron daemon..."

    # Garante que crontab está configurado
    if crontab -l >/dev/null 2>&1; then
        CRON_COUNT=$(crontab -l | grep -v '^#' | grep -v '^$' | wc -l)
        echo "  Cron jobs configurados: $CRON_COUNT"

        # Lista jobs (apenas comentário)
        crontab -l | grep -v '^#' | grep -v '^$' | while read -r line; do
            echo "  • $line"
        done
    else
        echo "  ⚠️  AVISO: Nenhum cron job configurado"
    fi

    # Inicia cron
    cron

    # Verifica se iniciou
    if pgrep cron >/dev/null 2>&1; then
        echo "✓ Cron daemon iniciado com sucesso"
    else
        echo "⚠️  AVISO: Falha ao iniciar cron daemon"
    fi
else
    echo "⚠️  AVISO: Comando 'cron' não encontrado"
fi

echo ""
echo "✓ Iniciando MySQL..."
echo "======================================================================"
echo ""

# Chama o entrypoint original do MySQL
# O entrypoint padrão do mysql:8.0-debian está em /usr/local/bin/docker-entrypoint.sh
exec /usr/local/bin/docker-entrypoint.sh "$@"
