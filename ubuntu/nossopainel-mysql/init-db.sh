#!/bin/bash
###############################################################################
# Script de Inicialização do MySQL - Nosso Painel Gestão
#
# NOTA: Executado pelo entrypoint do mysql:8.0-debian após criar banco/usuário
# Este script apenas configura permissões adicionais
# O dump SQL (nossopaineldb.sql) será importado automaticamente pelo
# entrypoint DEPOIS deste script (ordem alfabética)
###############################################################################

echo "======================================================================"
echo "MySQL Init Script - Nosso Painel Gestão"
echo "======================================================================"

# Banco de dados (já foi criado pelo entrypoint)
DB_NAME="${MYSQL_DATABASE:-nossopaineldb}"

echo ""
echo "ℹ️  Banco de dados: $DB_NAME"
echo "ℹ️  Este script configura permissões básicas"
echo "ℹ️  O dump SQL será importado automaticamente pelo entrypoint"
echo ""

# Garante permissões para o usuário da aplicação
if [ -n "${MYSQL_USER}" ]; then
    echo "🔐 Configurando permissões para '${MYSQL_USER}'..."

    # Durante a fase de inicialização, comandos mysql funcionam sem autenticação
    mysql <<-EOSQL 2>/dev/null || true
        -- Garante todas as permissões no banco da aplicação
        GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${MYSQL_USER}'@'%';
        FLUSH PRIVILEGES;
EOSQL

    if [ $? -eq 0 ]; then
        echo "   ✅ Permissões configuradas"
    fi
else
    echo "⚠️  Variável MYSQL_USER não definida"
fi

echo ""
echo "======================================================================"
echo "✅ Configuração de permissões concluída"
echo "======================================================================"
echo ""
