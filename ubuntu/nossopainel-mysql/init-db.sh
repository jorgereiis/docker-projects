#!/bin/bash
###############################################################################
# Script de Validação do MySQL - Nosso Painel Gestão
#
# NOTA: O entrypoint do mysql:5.7 já importa automaticamente arquivos .sql
# Este script executa DEPOIS da importação para validar os dados
###############################################################################

set -e

echo "======================================================================"
echo "MySQL Validation Script - Nosso Painel Gestão"
echo "======================================================================"

# Aguarda um momento para garantir que o MySQL está pronto
sleep 2

# Verifica se o banco de dados foi criado
if ! mysql -e "USE ${MYSQL_DATABASE};" 2>/dev/null; then
    echo "⚠️  Banco '${MYSQL_DATABASE}' não foi criado!"
    echo "======================================================================"
    exit 1
fi

echo "✅ Banco '${MYSQL_DATABASE}' encontrado."

# Valida contagens (se as tabelas existirem)
echo ""
echo "📊 Validando dados importados:"

USERS=$(mysql -D ${MYSQL_DATABASE} -se "SELECT COUNT(*) FROM auth_user" 2>/dev/null || echo "0")
CLIENTES=$(mysql -D ${MYSQL_DATABASE} -se "SELECT COUNT(*) FROM cadastros_cliente" 2>/dev/null || echo "0")
MENSALIDADES=$(mysql -D ${MYSQL_DATABASE} -se "SELECT COUNT(*) FROM cadastros_mensalidade" 2>/dev/null || echo "0")

echo "   Users: $USERS"
echo "   Clientes: $CLIENTES"
echo "   Mensalidades: $MENSALIDADES"

if [ "$USERS" -gt 0 ] && [ "$CLIENTES" -gt 0 ]; then
    echo "✅ Validação passou! Dados importados corretamente."
elif [ "$USERS" = "0" ] && [ "$CLIENTES" = "0" ]; then
    echo "ℹ️  Banco vazio. Django aplicará as migrations."
else
    echo "⚠️  Aviso: Contagens inesperadas. Verifique os dados."
fi

# Garante permissões para o usuário da aplicação (se foi criado)
if [ -n "${MYSQL_USER}" ]; then
    mysql <<-EOSQL
        GRANT ALL PRIVILEGES ON ${MYSQL_DATABASE}.* TO '${MYSQL_USER}'@'%';
        FLUSH PRIVILEGES;
EOSQL
    echo "✅ Permissões configuradas para usuário '${MYSQL_USER}'"
fi

echo "======================================================================"
echo "✅ Validação concluída com sucesso!"
echo "======================================================================"
