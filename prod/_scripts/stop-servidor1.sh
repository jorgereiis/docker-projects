#!/bin/bash

###############################################################################
# Script de Parada - SERVIDOR 1
# Para Django + MySQL + Nginx + Certbot
###############################################################################

echo "🛑 Parando containers do SERVIDOR 1..."

docker-compose -f django-build.yml down
docker-compose -f mysql-build.yml down

echo "✅ Todos os containers do SERVIDOR 1 foram parados"
echo "📊 Status:"
docker ps --filter "name=nossopainel" --format "table {{.Names}}\t{{.Status}}"
