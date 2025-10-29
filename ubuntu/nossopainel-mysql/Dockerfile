# ==============================================================================
# MySQL 8.0 Container - Nosso Painel Gestão
# ==============================================================================
# Base: MySQL 8.0 com Debian (suporte até 2026)
# Migração de MySQL 5.7 → 8.0 devido a EOL e problemas com repositórios
# Referência: https://hub.docker.com/_/mysql
# ==============================================================================

FROM mysql:8.0-debian

# Define variáveis de ambiente
# Nota: A imagem mysql:8.0 reconhece estas variáveis automaticamente
ENV MYSQL_DATABASE=nossopaineldb \
    TZ=America/Recife

# Instala pacotes extras necessários
# MySQL 8.0 e bash já estão incluídos na imagem base
# Nota: Removemos o repositório MySQL (chave GPG expirada) pois só precisamos dos repos Debian
RUN rm -f /etc/apt/sources.list.d/mysql.list && \
    apt-get update && apt-get install -y \
    cron \
    nano \
    dos2unix \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Cria diretório de backups
RUN mkdir -p /backups && chmod 755 /backups

# Copia configurações customizadas do MySQL
# A imagem mysql:8.0 carrega automaticamente arquivos de /etc/mysql/conf.d/
COPY my.cnf /etc/mysql/conf.d/custom.cnf
RUN chmod 644 /etc/mysql/conf.d/custom.cnf

# Copia scripts de inicialização
# A imagem mysql:8.0 executa automaticamente scripts em /docker-entrypoint-initdb.d/
# Ordem alfabética: init-db.sh → nossopaineldb.sql → zzz-post-validation.sh
COPY init-db.sh /docker-entrypoint-initdb.d/init-db.sh
RUN chmod +x /docker-entrypoint-initdb.d/init-db.sh && \
    dos2unix /docker-entrypoint-initdb.d/init-db.sh 2>/dev/null || true

COPY zzz-post-validation.sh /docker-entrypoint-initdb.d/zzz-post-validation.sh
RUN chmod +x /docker-entrypoint-initdb.d/zzz-post-validation.sh && \
    dos2unix /docker-entrypoint-initdb.d/zzz-post-validation.sh 2>/dev/null || true

# Copia script de backup
COPY backup-cron.sh /usr/local/bin/backup-cron.sh
RUN chmod +x /usr/local/bin/backup-cron.sh && \
    dos2unix /usr/local/bin/backup-cron.sh 2>/dev/null || true

# Copia script de monitoramento
COPY monitor-mysql.sh /usr/local/bin/monitor-mysql.sh
RUN chmod +x /usr/local/bin/monitor-mysql.sh && \
    dos2unix /usr/local/bin/monitor-mysql.sh 2>/dev/null || true

# Copia função helper de notificações WhatsApp
COPY whatsapp-notify.sh /usr/local/bin/whatsapp-notify.sh
RUN chmod +x /usr/local/bin/whatsapp-notify.sh && \
    dos2unix /usr/local/bin/whatsapp-notify.sh 2>/dev/null || true

# Configura cron jobs automáticos
# - Backup: diário às 2h da manhã
# - Monitor: a cada 6 horas (0h, 6h, 12h, 18h)
RUN echo "0 2 * * * /usr/local/bin/backup-cron.sh >> /var/log/mysql/backup-cron.log 2>&1" | crontab - && \
    echo "0 */6 * * * /usr/local/bin/monitor-mysql.sh >> /var/log/mysql/monitor-cron.log 2>&1" | crontab -

# Copia entrypoint wrapper (inicia cron + MySQL)
COPY entrypoint-init.sh /usr/local/bin/entrypoint-init.sh
RUN chmod +x /usr/local/bin/entrypoint-init.sh && \
    dos2unix /usr/local/bin/entrypoint-init.sh 2>/dev/null || true

# Expõe porta 3306 (apenas para rede interna Docker)
# Nota: A imagem mysql:8.0 já expõe a porta 3306, mas mantemos explícito
EXPOSE 3306

# Healthcheck para verificar se MySQL está respondendo
# Root sem senha (MYSQL_ALLOW_EMPTY_PASSWORD=yes)
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s \
    CMD mysqladmin ping -h localhost -u root || exit 1

# ==============================================================================
# ENTRYPOINT E CMD
# ==============================================================================
# Usa entrypoint customizado que:
# 1. Inicia cron daemon (para backups e monitoramento automáticos)
# 2. Chama o entrypoint padrão do mysql:8.0-debian que:
#    - Inicializa o banco na primeira execução
#    - Cria usuário e banco configurados via ENV
#    - Executa scripts em /docker-entrypoint-initdb.d/
#    - Inicia MySQL em foreground
# ==============================================================================
ENTRYPOINT ["/usr/local/bin/entrypoint-init.sh"]
CMD ["mysqld"]
