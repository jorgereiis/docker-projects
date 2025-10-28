#!/bin/bash
###############################################################################
# Script para Resetar Senha Root do MySQL para Vazio
# Nosso Painel Gestão
###############################################################################

set -e

echo "======================================================================"
echo "Reset de Senha Root do MySQL - Nosso Painel Gestão"
echo "======================================================================"
echo ""
echo "Este script irá remover a senha do usuário root do MySQL."
echo ""
read -p "Deseja continuar? (s/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Ss]$ ]]; then
    echo "Operação cancelada."
    exit 1
fi

echo ""
echo "1. Parando container MySQL..."
docker compose -f mysql-build.yml stop nossopainel-mysql

echo ""
echo "2. Iniciando MySQL em modo safe (sem validação de senha)..."
docker run -d --rm \
    --name mysql-temp-reset \
    --network ubuntu_database-network \
    -v "$(pwd)/nossopainel-mysql/data:/var/lib/mysql" \
    -e MYSQL_ALLOW_EMPTY_PASSWORD=yes \
    mysql:8.0-debian \
    mysqld --skip-grant-tables --skip-networking=0

echo "   Aguardando MySQL iniciar (30 segundos)..."
sleep 30

echo ""
echo "3. Resetando senha root..."
docker exec mysql-temp-reset mysql -u root <<-EOSQL
    FLUSH PRIVILEGES;
    ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '';
    ALTER USER 'root'@'%' IDENTIFIED WITH mysql_native_password BY '';
    FLUSH PRIVILEGES;
EOSQL

echo ""
echo "4. Parando container temporário..."
docker stop mysql-temp-reset

echo ""
echo "5. Reiniciando container normal..."
docker compose -f mysql-build.yml start nossopainel-mysql

echo ""
echo "6. Aguardando container ficar healthy (45 segundos)..."
sleep 45

echo ""
echo "======================================================================"
echo "✅ Reset concluído com sucesso!"
echo "======================================================================"
echo ""
echo "Testando conexão sem senha:"
docker exec nossopainel-mysql mysql -u root -e "SELECT 'Conexão bem-sucedida!' as Status;"

echo ""
echo "Pronto! Root agora não tem senha."
