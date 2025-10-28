#!/bin/bash
###############################################################################
# Script de Inicialização do MySQL - Nosso Painel Gestão
#
# Executa apenas na PRIMEIRA inicialização do container
# Se o banco 'nossopaineldb' já existir, não faz nada
###############################################################################

set -e

echo "======================================================================"
echo "MySQL Initialization Script - Nosso Painel Gestão"
echo "======================================================================"

# Verifica se o banco de dados já existe
if mysql -e "USE nossopaineldb;" 2>/dev/null; then
    echo "✅ Banco 'nossopaineldb' já existe. Pulando inicialização."
    echo "======================================================================"
    exit 0
fi

echo "🔄 Banco 'nossopaineldb' não encontrado. Iniciando importação..."

# Verifica se o dump existe
DUMP_FILE="/docker-entrypoint-initdb.d/nossopaineldb.sql"

if [ ! -f "$DUMP_FILE" ]; then
    echo "⚠️  Arquivo de dump não encontrado: $DUMP_FILE"
    echo "   Criando banco vazio..."

    mysql -u root -p"${MYSQL_ROOT_PASSWORD}" <<-EOSQL
        CREATE DATABASE IF NOT EXISTS nossopaineldb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
        GRANT ALL PRIVILEGES ON nossopaineldb.* TO '${MYSQL_USER}'@'%';
        FLUSH PRIVILEGES;
EOSQL

    echo "✅ Banco criado (vazio). Django aplicará as migrations."
    echo "======================================================================"
    exit 0
fi

echo "📦 Importando dump: $DUMP_FILE"
echo "   Isso pode levar alguns minutos..."

# Importa o dump
if mysql -u root -p"${MYSQL_ROOT_PASSWORD}" nossopaineldb < "$DUMP_FILE"; then
    echo "✅ Dump importado com sucesso!"

    # Valida contagens
    echo ""
    echo "📊 Validando dados importados:"

    USERS=$(mysql -u root -p"${MYSQL_ROOT_PASSWORD}" -D nossopaineldb -se "SELECT COUNT(*) FROM auth_user" 2>/dev/null || echo "0")
    CLIENTES=$(mysql -u root -p"${MYSQL_ROOT_PASSWORD}" -D nossopaineldb -se "SELECT COUNT(*) FROM cadastros_cliente" 2>/dev/null || echo "0")
    MENSALIDADES=$(mysql -u root -p"${MYSQL_ROOT_PASSWORD}" -D nossopaineldb -se "SELECT COUNT(*) FROM cadastros_mensalidade" 2>/dev/null || echo "0")

    echo "   Users: $USERS"
    echo "   Clientes: $CLIENTES"
    echo "   Mensalidades: $MENSALIDADES"

    if [ "$USERS" -gt 0 ] && [ "$CLIENTES" -gt 0 ]; then
        echo "✅ Validação passou! Dados importados corretamente."
    else
        echo "⚠️  Aviso: Contagens parecem estar zeradas. Verifique o dump."
    fi

    # Garante permissões para o usuário da aplicação
    mysql -u root -p"${MYSQL_ROOT_PASSWORD}" <<-EOSQL
        GRANT ALL PRIVILEGES ON nossopaineldb.* TO '${MYSQL_USER}'@'%';
        FLUSH PRIVILEGES;
EOSQL

    echo "✅ Permissões configuradas para usuário '${MYSQL_USER}'"
else
    echo "❌ ERRO ao importar dump!"
    echo "   O container continuará, mas o banco estará vazio."
    echo "   Você precisará importar manualmente."
    exit 1
fi

echo "======================================================================"
echo "✅ Inicialização concluída com sucesso!"
echo "======================================================================"
