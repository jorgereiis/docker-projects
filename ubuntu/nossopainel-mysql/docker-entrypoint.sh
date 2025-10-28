#!/bin/bash
set -eo pipefail

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}MySQL 5.7 Container - Inicializando${NC}"
echo -e "${GREEN}=====================================${NC}"

# Função para log
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Verifica se é a primeira inicialização
DATADIR="/var/lib/mysql"
FIRST_RUN=false

if [ ! -d "$DATADIR/mysql" ]; then
    FIRST_RUN=true
    log "Primeira inicialização detectada."

    # Inicializa o diretório de dados do MySQL
    log "Inicializando MySQL data directory..."
    mysqld --initialize-insecure --user=mysql --datadir="$DATADIR"

    if [ $? -ne 0 ]; then
        error "Falha ao inicializar MySQL data directory"
        exit 1
    fi

    log "MySQL data directory inicializado com sucesso"
fi

# Inicia MySQL em background para configuração inicial
if [ "$FIRST_RUN" = true ]; then
    log "Iniciando MySQL temporariamente para configuração..."
    mysqld --user=mysql --datadir="$DATADIR" --skip-networking --socket=/tmp/mysql_init.sock &
    MYSQL_PID=$!

    # Aguarda MySQL estar pronto
    log "Aguardando MySQL iniciar..."
    for i in {30..0}; do
        if mysqladmin ping --socket=/tmp/mysql_init.sock &> /dev/null; then
            break
        fi
        sleep 1
    done

    if [ "$i" = 0 ]; then
        error "MySQL não iniciou no tempo esperado"
        kill -s TERM "$MYSQL_PID" 2>/dev/null || true
        exit 1
    fi

    log "MySQL iniciado. Configurando..."

    # Lê variáveis de ambiente
    MYSQL_ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:-}"
    MYSQL_DATABASE="${MYSQL_DATABASE:-nossopaineldb}"
    MYSQL_USER="${MYSQL_USER:-nossopaineluser}"
    MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"

    # Se senha root não fornecida, gera uma
    if [ -z "$MYSQL_ROOT_PASSWORD" ]; then
        warn "MYSQL_ROOT_PASSWORD não definida. Gerando senha..."
        MYSQL_ROOT_PASSWORD=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 32 | head -n 1)
        log "Senha root gerada: $MYSQL_ROOT_PASSWORD"
    fi

    # Executa configuração SQL
    log "Configurando usuário root e permissões..."
    mysql --socket=/tmp/mysql_init.sock <<-EOSQL
        DELETE FROM mysql.user WHERE User='';
        DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');
        ALTER USER 'root'@'localhost' IDENTIFIED BY '${MYSQL_ROOT_PASSWORD}';
        CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EOSQL

    # Cria usuário se especificado
    if [ -n "$MYSQL_USER" ] && [ -n "$MYSQL_PASSWORD" ]; then
        log "Criando usuário: $MYSQL_USER"
        mysql --socket=/tmp/mysql_init.sock <<-EOSQL
            CREATE USER IF NOT EXISTS '${MYSQL_USER}'@'%' IDENTIFIED BY '${MYSQL_PASSWORD}';
            GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* TO '${MYSQL_USER}'@'%';
            GRANT RELOAD, PROCESS ON *.* TO '${MYSQL_USER}'@'%';
            FLUSH PRIVILEGES;
EOSQL
    fi

    log "Configuração inicial concluída"

    # Executa scripts de inicialização (apenas .sh)
    # Scripts .sql serão processados pelo init-db.sh
    if [ -d "/docker-entrypoint-initdb.d" ]; then
        log "Executando scripts de inicialização..."
        for f in /docker-entrypoint-initdb.d/*.sh; do
            if [ -f "$f" ]; then
                log "Executando: $f"
                if [ -x "$f" ]; then
                    export MYSQL_ROOT_PASSWORD
                    export MYSQL_DATABASE
                    export MYSQL_USER
                    export MYSQL_PASSWORD
                    "$f"
                    unset MYSQL_ROOT_PASSWORD
                fi
            fi
        done
        log "Scripts de inicialização concluídos"
    fi

    # Para MySQL temporário
    log "Parando MySQL temporário..."
    mysqladmin shutdown --socket=/tmp/mysql_init.sock -uroot -p"${MYSQL_ROOT_PASSWORD}" 2>/dev/null || kill -s TERM "$MYSQL_PID"
    wait "$MYSQL_PID" 2>/dev/null || true

    log "Configuração inicial finalizada!"
fi

# Inicia cron para backups
log "Iniciando cron para backups automáticos..."
service cron start 2>/dev/null || true

log "======================================"
log "Iniciando MySQL em modo produção..."
log "======================================"

# Inicia MySQL em foreground
exec mysqld --user=mysql --datadir="$DATADIR" "$@"
