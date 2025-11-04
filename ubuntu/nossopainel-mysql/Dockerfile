# ==============================================================================
# MySQL 8.0 Container - Nosso Painel Gestão (CONFIGURAÇÃO MANUAL)
# ==============================================================================
# Base: MySQL 8.0 com Debian (suporte até 2026)
# Referência: https://hub.docker.com/_/mysql
#
# IMPORTANTE: Este Dockerfile NÃO configura automações
# Todas as configurações (cron, importação de banco) devem ser feitas MANUALMENTE
# ==============================================================================

FROM mysql:8.0-debian

# Define variáveis de ambiente
ENV MYSQL_DATABASE=nossopaineldb \
    TZ=America/Recife

# Instala pacotes extras necessários
# Remove repositório MySQL (chave GPG expirada)
RUN rm -f /etc/apt/sources.list.d/mysql.list && \
    apt-get update && apt-get install -y \
    iputils-ping \
    cron \
    nano \
    dos2unix \
    curl \
    bc \
    && rm -rf /var/lib/apt/lists/*

# Cria diretórios necessários
RUN mkdir -p /backups && chmod 755 /backups
RUN mkdir -p /var/log/mysql && chown mysql:mysql /var/log/mysql

# ==============================================================================
# CONFIGURAÇÕES MYSQL
# ==============================================================================

# Copia configurações customizadas do MySQL
COPY my.cnf /etc/mysql/conf.d/custom.cnf
RUN chmod 644 /etc/mysql/conf.d/custom.cnf

# ==============================================================================
# SCRIPTS DISPONÍVEIS PARA USO MANUAL
# ==============================================================================

# Script de backup
COPY backup-cron.sh /usr/local/bin/backup-cron.sh
RUN chmod +x /usr/local/bin/backup-cron.sh && \
    dos2unix /usr/local/bin/backup-cron.sh 2>/dev/null || true

# Script de monitoramento
COPY monitor-mysql.sh /usr/local/bin/monitor-mysql.sh
RUN chmod +x /usr/local/bin/monitor-mysql.sh && \
    dos2unix /usr/local/bin/monitor-mysql.sh 2>/dev/null || true

# Helper de notificações WhatsApp
COPY whatsapp-notify.sh /usr/local/bin/whatsapp-notify.sh
RUN chmod +x /usr/local/bin/whatsapp-notify.sh && \
    dos2unix /usr/local/bin/whatsapp-notify.sh 2>/dev/null || true

# ==============================================================================
# PORTA E HEALTHCHECK
# ==============================================================================

# Expõe porta 3306 (apenas rede interna Docker)
EXPOSE 3306

# Healthcheck básico
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s \
    CMD mysqladmin ping -h localhost -u root || exit 1

# ==============================================================================
# ENTRYPOINT E CMD PADRÃO (SEM CUSTOMIZAÇÕES)
# ==============================================================================
# Usa o entrypoint padrão do mysql:8.0-debian
# ENTRYPOINT ["docker-entrypoint.sh"]
# CMD ["mysqld"]
# ==============================================================================
