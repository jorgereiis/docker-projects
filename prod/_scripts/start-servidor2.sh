#!/bin/bash

###############################################################################
# Script de Inicialização - SERVIDOR 2
# WPPConnect + Nginx
###############################################################################

set -e

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║             SERVIDOR 2: WPPConnect + Nginx                   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Cria diretórios necessários
echo "➤ Criando diretórios..."
mkdir -p wppconnect-server/backups
mkdir -p wppconnect-server/tokens
mkdir -p wppconnect-server/sessions

# Inicia WPPConnect
echo ""
echo "════════════════════════════════════════════════════════════"
echo "Inicializando WPPConnect + Nginx"
echo "════════════════════════════════════════════════════════════"

docker-compose -f wppconnect-build.yml up -d

echo ""
echo "✅ SERVIDOR 2 iniciado!"
echo ""
echo "📊 Status:"
docker ps --filter "name=wppconnect" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "📌 Acesse: http://SEU_IP_SERVIDOR/"
echo "📌 Para parar: ./stop-servidor2.sh"
