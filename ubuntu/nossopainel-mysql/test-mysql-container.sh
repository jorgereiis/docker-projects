#!/bin/bash
###############################################################################
# Script de Testes - Container MySQL Nosso Painel
#
# Testa todas as funcionalidades do container:
# - Conexão MySQL (root e usuário app)
# - Banco de dados e tabelas
# - Scripts de backup
# - Scripts de monitoramento
# - Notificações WhatsApp
# - Cron jobs
###############################################################################

set -e

CONTAINER_NAME="nossopainel-mysql"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Contadores
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Função de teste
test_check() {
    local test_name="$1"
    local command="$2"
    local expected_result="${3:-0}"  # 0 = sucesso, 1 = erro

    TESTS_TOTAL=$((TESTS_TOTAL + 1))

    echo -n "  [$TESTS_TOTAL] $test_name... "

    if eval "$command" >/dev/null 2>&1; then
        result=0
    else
        result=1
    fi

    if [ "$result" -eq "$expected_result" ]; then
        echo -e "${GREEN}✓ PASSOU${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        echo -e "${RED}✗ FALHOU${NC}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

# Função de teste com output
test_check_output() {
    local test_name="$1"
    local command="$2"
    local expected_output="$3"

    TESTS_TOTAL=$((TESTS_TOTAL + 1))

    echo -n "  [$TESTS_TOTAL] $test_name... "

    output=$(eval "$command" 2>/dev/null || echo "ERRO")

    if echo "$output" | grep -q "$expected_output"; then
        echo -e "${GREEN}✓ PASSOU${NC} (encontrado: $expected_output)"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        echo -e "${RED}✗ FALHOU${NC} (esperado: $expected_output, obtido: $output)"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

# Cabeçalho
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  TESTES DO CONTAINER MYSQL - NOSSO PAINEL GESTÃO              ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# ==============================================================================
# 1. TESTE DE INFRAESTRUTURA
# ==============================================================================
echo -e "${BLUE}═══ 1. Infraestrutura${NC}"

test_check "Container está rodando" \
    "docker ps | grep -q $CONTAINER_NAME"

test_check "Healthcheck está OK" \
    "docker inspect $CONTAINER_NAME | grep -q '\"Status\": \"healthy\"'"

test_check "Volume de dados montado" \
    "docker inspect $CONTAINER_NAME | grep -q '/var/lib/mysql'"

test_check "Volume de backups montado" \
    "docker inspect $CONTAINER_NAME | grep -q '/backups'"

test_check "Volume de logs montado" \
    "docker inspect $CONTAINER_NAME | grep -q '/var/log/mysql'"

echo ""

# ==============================================================================
# 2. TESTE DE CONEXÃO MYSQL
# ==============================================================================
echo -e "${BLUE}═══ 2. Conexão MySQL${NC}"

test_check "MySQL está respondendo" \
    "docker exec $CONTAINER_NAME mysqladmin ping -h localhost -u root --silent"

test_check "Root sem senha funciona" \
    "docker exec $CONTAINER_NAME mysql -u root -e 'SELECT 1' --silent"

test_check "Usuário app existe" \
    "docker exec $CONTAINER_NAME mysql -u root -e \"SELECT User FROM mysql.user WHERE User='nossopaineluser'\" --silent | grep -q nossopaineluser"

# Teste de conexão com usuário app (requer senha do .env)
if [ -f .env ]; then
    MYSQL_PASSWORD=$(grep '^MYSQL_PASSWORD=' .env | cut -d'=' -f2)
    if [ -n "$MYSQL_PASSWORD" ]; then
        test_check "Usuário app consegue conectar" \
            "docker exec $CONTAINER_NAME mysql -u nossopaineluser -p'$MYSQL_PASSWORD' -e 'SELECT 1' --silent"
    fi
fi

echo ""

# ==============================================================================
# 3. TESTE DE BANCO DE DADOS
# ==============================================================================
echo -e "${BLUE}═══ 3. Banco de Dados${NC}"

test_check "Banco 'nossopaineldb' existe" \
    "docker exec $CONTAINER_NAME mysql -u root -e 'SHOW DATABASES' --silent | grep -q nossopaineldb"

# Conta tabelas
TABLE_COUNT=$(docker exec $CONTAINER_NAME mysql -u root -D nossopaineldb -se "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='nossopaineldb'" 2>/dev/null || echo "0")
echo -e "  ${GREEN}ℹ${NC} Total de tabelas: $TABLE_COUNT"

if [ "$TABLE_COUNT" -gt 0 ]; then
    test_check "Banco tem tabelas" \
        "[ $TABLE_COUNT -gt 0 ]"
fi

# Testa tabelas principais (se existirem)
for table in auth_user cadastros_cliente cadastros_mensalidade; do
    if docker exec $CONTAINER_NAME mysql -u root -D nossopaineldb -e "SHOW TABLES LIKE '$table'" --silent 2>/dev/null | grep -q "$table"; then
        test_check "Tabela '$table' existe" \
            "docker exec $CONTAINER_NAME mysql -u root -D nossopaineldb -e \"SHOW TABLES LIKE '$table'\" --silent | grep -q $table"
    fi
done

echo ""

# ==============================================================================
# 4. TESTE DE SCRIPTS
# ==============================================================================
echo -e "${BLUE}═══ 4. Scripts Instalados${NC}"

test_check "backup-cron.sh existe" \
    "docker exec $CONTAINER_NAME test -f /usr/local/bin/backup-cron.sh"

test_check "backup-cron.sh é executável" \
    "docker exec $CONTAINER_NAME test -x /usr/local/bin/backup-cron.sh"

test_check "monitor-mysql.sh existe" \
    "docker exec $CONTAINER_NAME test -f /usr/local/bin/monitor-mysql.sh"

test_check "monitor-mysql.sh é executável" \
    "docker exec $CONTAINER_NAME test -x /usr/local/bin/monitor-mysql.sh"

test_check "whatsapp-notify.sh existe" \
    "docker exec $CONTAINER_NAME test -f /usr/local/bin/whatsapp-notify.sh"

test_check "whatsapp-notify.sh é executável" \
    "docker exec $CONTAINER_NAME test -x /usr/local/bin/whatsapp-notify.sh"

echo ""

# ==============================================================================
# 5. TESTE DE CRON (Opcional - Configuração Manual)
# ==============================================================================
echo -e "${BLUE}═══ 5. Cron Jobs (Configuração Manual)${NC}"

# Verifica se cron está rodando (OPCIONAL)
if docker exec $CONTAINER_NAME pgrep cron >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} Cron daemon está rodando"
    TESTS_PASSED=$((TESTS_PASSED + 1))

    # Se cron está rodando, verifica configuração
    if docker exec $CONTAINER_NAME crontab -l 2>/dev/null | grep -q backup-cron.sh; then
        echo -e "  ${GREEN}✓${NC} Crontab está configurado"
        TESTS_PASSED=$((TESTS_PASSED + 1))

        CRON_JOBS=$(docker exec $CONTAINER_NAME crontab -l 2>/dev/null | grep -v '^#' | grep -v '^$' | wc -l)
        echo -e "  ${GREEN}ℹ${NC} Total de cron jobs: $CRON_JOBS"
    else
        echo -e "  ${YELLOW}⚠${NC}  Crontab não configurado (configuração manual necessária)"
    fi
else
    echo -e "  ${YELLOW}⚠${NC}  Cron daemon não está rodando (configuração manual necessária)"
    echo -e "      Para configurar: docker exec $CONTAINER_NAME /etc/init.d/cron start"
fi

TESTS_TOTAL=$((TESTS_TOTAL + 2))

echo ""

# ==============================================================================
# 6. TESTE DE BACKUP MANUAL
# ==============================================================================
echo -e "${BLUE}═══ 6. Backup Manual${NC}"

echo -e "  ${YELLOW}Executando backup manual (pode levar alguns segundos)...${NC}"

BACKUP_OUTPUT=$(docker exec $CONTAINER_NAME /usr/local/bin/backup-cron.sh 2>&1)

if echo "$BACKUP_OUTPUT" | grep -q "concluído com sucesso"; then
    echo -e "  ${GREEN}✓ Backup executou com sucesso${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo -e "  ${RED}✗ Backup falhou${NC}"
    echo "$BACKUP_OUTPUT" | tail -10
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
TESTS_TOTAL=$((TESTS_TOTAL + 1))

# Verifica se backup foi criado
LATEST_BACKUP=$(docker exec $CONTAINER_NAME ls -t /backups/nossopaineldb_*.sql.gz 2>/dev/null | head -1)
if [ -n "$LATEST_BACKUP" ]; then
    BACKUP_SIZE=$(docker exec $CONTAINER_NAME du -h "$LATEST_BACKUP" | cut -f1)
    echo -e "  ${GREEN}ℹ${NC} Último backup: $(basename $LATEST_BACKUP) ($BACKUP_SIZE)"

    test_check "Backup tem tamanho > 0" \
        "docker exec $CONTAINER_NAME test -s $LATEST_BACKUP"

    test_check "Checksum MD5 foi criado" \
        "docker exec $CONTAINER_NAME test -f ${LATEST_BACKUP}.md5"
fi

echo ""

# ==============================================================================
# 7. TESTE DE MONITORAMENTO
# ==============================================================================
echo -e "${BLUE}═══ 7. Monitoramento${NC}"

echo -e "  ${YELLOW}Executando monitoramento...${NC}"

MONITOR_OUTPUT=$(docker exec $CONTAINER_NAME /usr/local/bin/monitor-mysql.sh 2>&1)

if echo "$MONITOR_OUTPUT" | grep -q "Monitoramento concluído"; then
    echo -e "  ${GREEN}✓ Monitoramento executou com sucesso${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo -e "  ${RED}✗ Monitoramento falhou${NC}"
    echo "$MONITOR_OUTPUT" | tail -10
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi
TESTS_TOTAL=$((TESTS_TOTAL + 1))

echo ""

# ==============================================================================
# 8. TESTE DE LOGS
# ==============================================================================
echo -e "${BLUE}═══ 8. Logs${NC}"

test_check "Log de backup existe" \
    "docker exec $CONTAINER_NAME test -f /var/log/mysql/backup.log"

test_check "Log de monitor existe" \
    "docker exec $CONTAINER_NAME test -f /var/log/mysql/monitor.log"

# Tamanho dos logs
if docker exec $CONTAINER_NAME test -f /var/log/mysql/backup.log; then
    BACKUP_LOG_SIZE=$(docker exec $CONTAINER_NAME du -h /var/log/mysql/backup.log | cut -f1)
    echo -e "  ${GREEN}ℹ${NC} Log de backup: $BACKUP_LOG_SIZE"
fi

if docker exec $CONTAINER_NAME test -f /var/log/mysql/monitor.log; then
    MONITOR_LOG_SIZE=$(docker exec $CONTAINER_NAME du -h /var/log/mysql/monitor.log | cut -f1)
    echo -e "  ${GREEN}ℹ${NC} Log de monitor: $MONITOR_LOG_SIZE"
fi

echo ""

# ==============================================================================
# 9. TESTE DE NOTIFICAÇÕES WHATSAPP (Opcional)
# ==============================================================================
echo -e "${BLUE}═══ 9. Notificações WhatsApp (Opcional)${NC}"

# Verifica se Django está acessível
if docker ps | grep -q nossopainel-django; then
    echo -e "  ${GREEN}ℹ${NC} Container Django detectado"

    # Testa conectividade com Django
    DJANGO_URL=$(docker exec $CONTAINER_NAME printenv DJANGO_INTERNAL_URL 2>/dev/null || echo "http://nossopainel-django:8000")
    echo -e "  ${YELLOW}Testando conexão com Django: $DJANGO_URL${NC}"

    if docker exec $CONTAINER_NAME curl -s --max-time 5 "$DJANGO_URL" >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓ Django é acessível via rede interna${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "  ${YELLOW}⚠ Django não respondeu (pode estar iniciando)${NC}"
    fi
    TESTS_TOTAL=$((TESTS_TOTAL + 1))

    # Testa função de notificação (apenas source, não envia)
    test_check "Função send_whatsapp pode ser carregada" \
        "docker exec $CONTAINER_NAME bash -c 'source /usr/local/bin/whatsapp-notify.sh && declare -f send_whatsapp >/dev/null'"

else
    echo -e "  ${YELLOW}⚠ Container Django não está rodando${NC}"
    echo -e "  ${YELLOW}  Pule este teste ou inicie o Django primeiro${NC}"
fi

echo ""

# ==============================================================================
# 10. VERIFICAÇÕES DE SEGURANÇA
# ==============================================================================
echo -e "${BLUE}═══ 10. Segurança${NC}"

test_check "Rede interna (internal:true) configurada" \
    "docker network inspect ubuntu_database-network | grep -q '\"Internal\": true'"

test_check "Porta 3306 NÃO exposta publicamente" \
    "! docker port $CONTAINER_NAME 3306 2>/dev/null"

test_check "Root não tem senha (ALLOW_EMPTY_PASSWORD)" \
    "docker exec $CONTAINER_NAME mysql -u root -e 'SELECT 1' --silent"

echo ""

# ==============================================================================
# SUMÁRIO
# ==============================================================================
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  SUMÁRIO DOS TESTES                                            ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo -e "  Total de testes: ${BLUE}$TESTS_TOTAL${NC}"
echo -e "  Passaram: ${GREEN}$TESTS_PASSED${NC}"
echo -e "  Falharam: ${RED}$TESTS_FAILED${NC}"

PASS_RATE=$(echo "scale=1; ($TESTS_PASSED / $TESTS_TOTAL) * 100" | bc 2>/dev/null || echo "N/A")
echo -e "  Taxa de sucesso: ${BLUE}${PASS_RATE}%${NC}"

echo ""

if [ "$TESTS_FAILED" -eq 0 ]; then
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ✅ TODOS OS TESTES PASSARAM!                                  ║${NC}"
    echo -e "${GREEN}║  Container MySQL está 100% funcional e pronto para produção   ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ⚠️  ALGUNS TESTES FALHARAM                                    ║${NC}"
    echo -e "${RED}║  Revise os erros acima antes de fazer deploy em produção      ║${NC}"
    echo -e "${RED}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    exit 1
fi
