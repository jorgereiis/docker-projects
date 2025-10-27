#!/bin/bash
###############################################################################
# Script de Inicialização - SERVIDOR 1
# Django + MySQL + Nginx + Certbot
#
# Uso: ./start-servidor1.sh
###############################################################################

set -e

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        SERVIDOR 1: Django + MySQL + Nginx + Certbot         ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Verifica se .env existe
if [ ! -f .env ]; then
    echo -e "${RED}❌ Arquivo .env não encontrado!${NC}"
    echo -e "${YELLOW}➤ Copie o arquivo .env.example e configure:${NC}"
    echo "   cp .env.example .env"
    echo "   nano .env"
    exit 1
fi

# Verifica permissões do .env
if [ "$(stat -c %a .env)" != "600" ]; then
    echo -e "${YELLOW}⚠️  Ajustando permissões do .env...${NC}"
    chmod 600 .env
fi

# Cria diretórios necessários
echo -e "${YELLOW}➤ Criando diretórios necessários...${NC}"
mkdir -p nossopainel-mysql/data
mkdir -p nossopainel-mysql/backups
mkdir -p nossopainel-mysql/logs
mkdir -p nossopainel-django/mediafiles
mkdir -p nossopainel-django/staticfiles
mkdir -p nossopainel-django/database
echo -e "${GREEN}✅ Diretórios criados${NC}"

# Verifica se dump SQL existe
if [ ! -f nossopainel-mysql/nossopaineldb.sql ]; then
    echo -e "${YELLOW}⚠️  Dump SQL não encontrado: nossopainel-mysql/nossopaineldb.sql${NC}"
    echo ""
    exit 1
fi

# Inicia MySQL primeiro
echo -e "\n${YELLOW}════════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}ETAPA 1: Inicializando MySQL${NC}"
echo -e "${YELLOW}════════════════════════════════════════════════════════════${NC}"

docker-compose -f mysql-build.yml up -d

echo -e "${YELLOW}➤ Aguardando MySQL ficar pronto (healthcheck)...${NC}"
echo -e "${YELLOW}   Isso pode levar até 30 segundos...${NC}"

# Aguarda healthcheck do MySQL
TIMEOUT=60
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker inspect --format='{{.State.Health.Status}}' nossopainel-mysql 2>/dev/null | grep -q "healthy"; then
        echo -e "${GREEN}✅ MySQL pronto!${NC}"
        break
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
    echo -n "."
done

if [ $ELAPSED -ge $TIMEOUT ]; then
    echo -e "\n${RED}❌ MySQL demorou muito para ficar pronto!${NC}"
    echo -e "${YELLOW}   Verifique os logs: docker logs nossopainel-mysql${NC}"
    exit 1
fi

# Inicia Django, Nginx e Certbot
echo -e "\n${YELLOW}════════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}ETAPA 2: Inicializando Django, Nginx e Certbot${NC}"
echo -e "${YELLOW}════════════════════════════════════════════════════════════${NC}"

docker-compose -f django-build.yml up -d

echo -e "${YELLOW}➤ Aguardando Django ficar pronto (healthcheck)...${NC}"

# Aguarda healthcheck do Django
TIMEOUT=90
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker inspect --format='{{.State.Health.Status}}' nossopainel-django 2>/dev/null | grep -q "healthy"; then
        echo -e "${GREEN}✅ Django pronto!${NC}"
        break
    fi
    sleep 2
    ELAPSED=$((ELAPSED + 2))
    echo -n "."
done

if [ $ELAPSED -ge $TIMEOUT ]; then
    echo -e "\n${YELLOW}⚠️  Django demorou para ficar pronto${NC}"
    echo -e "${YELLOW}   Mas pode estar funcionando. Verifique os logs.${NC}"
fi

# Status final
echo -e "\n${YELLOW}════════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}STATUS DOS CONTAINERS${NC}"
echo -e "${YELLOW}════════════════════════════════════════════════════════════${NC}"

docker ps --filter "name=nossopainel" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo -e "\n${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              SERVIDOR 1 INICIADO COM SUCESSO!                ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}📌 Próximos passos:${NC}"
echo ""
echo -e "1. Verifique os logs:"
echo "   ${BLUE}docker logs nossopainel-mysql${NC}"
echo "   ${BLUE}docker logs nossopainel-django${NC}"
echo "   ${BLUE}docker logs nossopainel-nginx${NC}"
echo ""
echo -e "2. Acesse a aplicação:"
echo "   ${BLUE}http://SEU_IP_SERVIDOR${NC}"
echo ""
echo -e "3. Para parar os containers:"
echo "   ${BLUE}./stop-servidor1.sh${NC}"
echo ""
