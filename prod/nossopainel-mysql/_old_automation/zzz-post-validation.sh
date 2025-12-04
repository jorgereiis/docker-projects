#!/bin/bash
###############################################################################
# Script de Pós-Validação do MySQL - Nosso Painel Gestão
#
# NOTA: Executado DEPOIS da importação do dump SQL (ordem alfabética: zzz-)
# Este script valida que tudo foi importado corretamente e exibe estatísticas
###############################################################################

echo ""
echo "======================================================================"
echo "MySQL Post-Validation Script - Nosso Painel Gestão"
echo "======================================================================"

# Banco de dados
DB_NAME="${MYSQL_DATABASE:-nossopaineldb}"

echo ""
echo "📊 Validando banco '$DB_NAME'..."

# Aguarda 1 segundo para MySQL processar tudo
sleep 1

# Conta quantas tabelas existem
TABLE_COUNT=$(mysql -D ${DB_NAME} -se "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}'" 2>/dev/null || echo "0")

if ! [[ "$TABLE_COUNT" =~ ^[0-9]+$ ]]; then
    echo "⚠️  Não foi possível contar tabelas"
    TABLE_COUNT=0
fi

echo "   Total de tabelas: $TABLE_COUNT"

if [ "$TABLE_COUNT" -eq 0 ]; then
    echo ""
    echo "⚠️  AVISO: Nenhuma tabela encontrada no banco"
    echo "   Possíveis causas:"
    echo "   - Dump SQL não existe ou está vazio"
    echo "   - Erro durante importação do dump"
    echo "   Django aplicará migrations automaticamente"
else
    echo "   ✅ Banco importado com sucesso!"

    # Estatísticas de tabelas conhecidas do Django
    echo ""
    echo "📊 Estatísticas (tabelas Django):"

    USERS=$(mysql -D ${DB_NAME} -se "SELECT COUNT(*) FROM auth_user" 2>/dev/null || echo "N/A")
    CLIENTES=$(mysql -D ${DB_NAME} -se "SELECT COUNT(*) FROM cadastros_cliente" 2>/dev/null || echo "N/A")
    MENSALIDADES=$(mysql -D ${DB_NAME} -se "SELECT COUNT(*) FROM cadastros_mensalidade" 2>/dev/null || echo "N/A")

    if [ "$USERS" != "N/A" ]; then
        echo "   Usuários (auth_user): $USERS"
    fi
    if [ "$CLIENTES" != "N/A" ]; then
        echo "   Clientes (cadastros_cliente): $CLIENTES"
    fi
    if [ "$MENSALIDADES" != "N/A" ]; then
        echo "   Mensalidades (cadastros_mensalidade): $MENSALIDADES"
    fi

    # Tamanho do banco de dados
    echo ""
    DB_SIZE=$(mysql -se "SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) FROM information_schema.tables WHERE table_schema='${DB_NAME}'" 2>/dev/null || echo "N/A")
    if [ "$DB_SIZE" != "N/A" ]; then
        echo "   Tamanho total do banco: ${DB_SIZE} MB"
    fi

    # Top 5 maiores tabelas
    echo ""
    echo "   Top 5 maiores tabelas:"
    mysql -D ${DB_NAME} -se "
SELECT
    CONCAT('   • ', table_name, ': ', ROUND((data_length + index_length) / 1024 / 1024, 2), ' MB')
FROM information_schema.tables
WHERE table_schema='${DB_NAME}'
ORDER BY (data_length + index_length) DESC
LIMIT 5
" 2>/dev/null || echo "   N/A"
fi

# Valida autenticação do usuário da aplicação
if [ -n "${MYSQL_USER}" ] && [ -n "${MYSQL_PASSWORD}" ]; then
    echo ""
    echo "🔐 Validando autenticação do usuário '${MYSQL_USER}'..."

    USER_CHECK=$(mysql -u ${MYSQL_USER} -p${MYSQL_PASSWORD} -D ${DB_NAME} -se "SELECT 1" 2>/dev/null || echo "0")
    if [ "$USER_CHECK" = "1" ]; then
        echo "   ✅ Autenticação funcionando corretamente"
    else
        echo "   ⚠️  Autenticação do usuário falhou"
        echo "   Verifique MYSQL_USER e MYSQL_PASSWORD no .env"
    fi
fi

echo ""
echo "======================================================================"
echo "✅ Pós-validação concluída"
echo "======================================================================"
echo ""
