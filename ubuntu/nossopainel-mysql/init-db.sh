#!/bin/bash
###############################################################################
# Script de Validação e Importação do MySQL - Nosso Painel Gestão
#
# NOTA: Executado pelo entrypoint do mysql:8.0-debian após criar banco/usuário
# Este script importa o dump SQL se existir e valida os dados
###############################################################################

# Não usar set -e global para ter controle fino de erros
# set -e

# Trap para erros críticos
trap 'echo "❌ ERRO CRÍTICO na linha $LINENO. Abortando."; exit 1' ERR

echo "======================================================================"
echo "MySQL Post-Init Script - Nosso Painel Gestão"
echo "======================================================================"

# Aguarda MySQL estar pronto com retry
MAX_RETRIES=10
RETRY_COUNT=0
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if mysqladmin ping -h localhost -u root --silent 2>/dev/null; then
        echo "✅ MySQL está pronto!"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "⏳ Aguardando MySQL estar pronto ($RETRY_COUNT/$MAX_RETRIES)..."
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "❌ ERRO: MySQL não está respondendo após $MAX_RETRIES tentativas"
    exit 1
fi

# Banco de dados (já foi criado pelo entrypoint)
DB_NAME="${MYSQL_DATABASE:-nossopaineldb}"

echo ""
echo "📊 Verificando banco '$DB_NAME'..."

# Conta quantas tabelas existem com verificação robusta
TABLE_COUNT=$(mysql -D ${DB_NAME} -se "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}'" 2>/dev/null || echo "0")

if ! [[ "$TABLE_COUNT" =~ ^[0-9]+$ ]]; then
    echo "⚠️  AVISO: Não foi possível contar tabelas. Assumindo banco vazio."
    TABLE_COUNT=0
fi

echo "   Tabelas existentes: $TABLE_COUNT"

if [ "$TABLE_COUNT" -eq 0 ]; then
    echo ""
    echo "📦 Banco vazio. Verificando se há dump SQL para importar..."

    DUMP_FILE="/docker-entrypoint-initdb.d/nossopaineldb.sql"

    if [ -f "$DUMP_FILE" ]; then
        DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
        echo "📥 Importando dump: $DUMP_FILE (tamanho: $DUMP_SIZE)"
        echo "   (Isso pode levar alguns minutos...)"

        IMPORT_START=$(date +%s)

        if mysql ${DB_NAME} < "$DUMP_FILE" 2>/tmp/import_error.log; then
            IMPORT_END=$(date +%s)
            IMPORT_TIME=$((IMPORT_END - IMPORT_START))
            echo "✅ Dump importado com sucesso em ${IMPORT_TIME}s!"

            # Valida importação contando tabelas novamente
            NEW_COUNT=$(mysql -D ${DB_NAME} -se "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}'" 2>/dev/null || echo "0")

            if [ "$NEW_COUNT" -gt 0 ]; then
                echo "   ✅ Importação validada: $NEW_COUNT tabelas criadas"
            else
                echo "   ⚠️  AVISO: Dump importado mas nenhuma tabela foi criada"
            fi
        else
            echo "❌ ERRO ao importar dump!"
            if [ -f /tmp/import_error.log ]; then
                echo "   Detalhes do erro:"
                cat /tmp/import_error.log | head -10
            fi
            echo "   O banco ficará vazio. Django aplicará migrations."
        fi
    else
        echo "ℹ️  Nenhum dump encontrado em: $DUMP_FILE"
        echo "   Django aplicará migrations automaticamente."
    fi
else
    echo "✅ Banco já possui $TABLE_COUNT tabelas."
    echo "   Inicialização anterior detectada. Pulando importação."
fi

# Garante permissões para o usuário da aplicação
if [ -n "${MYSQL_USER}" ]; then
    echo ""
    echo "🔐 Configurando permissões para '${MYSQL_USER}'..."

    if mysql <<-EOSQL 2>/dev/null
        GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${MYSQL_USER}'@'%';
        FLUSH PRIVILEGES;
EOSQL
    then
        echo "✅ Permissões configuradas com sucesso!"

        # Verifica se usuário tem acesso
        USER_COUNT=$(mysql -u ${MYSQL_USER} -p${MYSQL_PASSWORD} -D ${DB_NAME} -se "SELECT 1" 2>/dev/null || echo "0")
        if [ "$USER_COUNT" = "1" ]; then
            echo "   ✅ Usuário '${MYSQL_USER}' autenticado com sucesso"
        else
            echo "   ⚠️  AVISO: Não foi possível validar autenticação do usuário"
        fi
    else
        echo "   ⚠️  AVISO: Erro ao configurar permissões"
    fi
else
    echo ""
    echo "ℹ️  Variável MYSQL_USER não definida. Pulando configuração de permissões."
fi

# Valida contagens (se houver tabelas)
FINAL_TABLE_COUNT=$(mysql -D ${DB_NAME} -se "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}'" 2>/dev/null || echo "0")

if [ "$FINAL_TABLE_COUNT" -gt 0 ]; then
    echo ""
    echo "📊 Estatísticas do banco '$DB_NAME':"
    echo "   Total de tabelas: $FINAL_TABLE_COUNT"

    # Tenta buscar estatísticas de tabelas conhecidas
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
    DB_SIZE=$(mysql -se "SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) FROM information_schema.tables WHERE table_schema='${DB_NAME}'" 2>/dev/null || echo "N/A")
    if [ "$DB_SIZE" != "N/A" ]; then
        echo "   Tamanho do banco: ${DB_SIZE} MB"
    fi
fi

echo ""
echo "======================================================================"
echo "✅ Inicialização concluída com sucesso!"
echo "======================================================================"
echo ""
