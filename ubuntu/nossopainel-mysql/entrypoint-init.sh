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

    # Inicia cron (tenta múltiplos métodos)
    CRON_STARTED=false

    # Método 1: /etc/init.d/cron start
    if [ -f /etc/init.d/cron ]; then
        if /etc/init.d/cron start >/dev/null 2>&1; then
            CRON_STARTED=true
        fi
    fi

    # Método 2: service cron start (se método 1 falhou)
    if [ "$CRON_STARTED" = false ] && command -v service >/dev/null 2>&1; then
        if service cron start >/dev/null 2>&1; then
            CRON_STARTED=true
        fi
    fi

    # Método 3: cron direto (se métodos anteriores falharam)
    if [ "$CRON_STARTED" = false ]; then
        cron >/dev/null 2>&1 || true
    fi

    # Aguarda 1 segundo para cron se estabelecer
    sleep 1

    # Verifica se iniciou
    if pgrep cron >/dev/null 2>&1; then
        CRON_PID=$(pgrep cron)
        echo "✓ Cron daemon iniciado com sucesso (PID: $CRON_PID)"
    else
        echo "⚠️  AVISO: Cron daemon não está rodando"
        echo "  Backups e monitoramento automáticos NÃO funcionarão"
        echo "  Execute manualmente: docker exec nossopainel-mysql cron"
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
