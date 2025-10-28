FROM ubuntu:20.04

# Define variáveis de ambiente
ENV MYSQL_DATABASE=nossopaineldb \
    DEBIAN_FRONTEND=noninteractive \
    TZ=America/Recife \
    MYSQL_ROOT_PASSWORD_FILE=/run/secrets/mysql_root_password

# Instala MySQL Server 5.7 e dependências necessárias
RUN apt-get update && apt-get install -y \
    mysql-server-5.7 \
    mysql-client-5.7 \
    tzdata \
    cron \
    supervisor \
    nano \
    dos2unix \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Cria usuário mysql se não existir (geralmente já criado pelo pacote)
RUN mkdir -p /var/run/mysqld && \
    chown -R mysql:mysql /var/run/mysqld && \
    chmod 755 /var/run/mysqld

# Cria diretórios necessários para MySQL
RUN mkdir -p /var/lib/mysql /var/log/mysql /backups && \
    chown -R mysql:mysql /var/lib/mysql /var/log/mysql && \
    chmod 755 /backups

# Copia configurações customizadas do MySQL
COPY my.cnf /etc/mysql/conf.d/custom.cnf
RUN chmod 644 /etc/mysql/conf.d/custom.cnf

# Copia script de inicialização (importa dump na primeira execução)
COPY init-db.sh /docker-entrypoint-initdb.d/init-db.sh
RUN chmod +x /docker-entrypoint-initdb.d/init-db.sh && \
    dos2unix /docker-entrypoint-initdb.d/init-db.sh 2>/dev/null || true

# Copia script de backup
COPY backup-cron.sh /usr/local/bin/backup-cron.sh
RUN chmod +x /usr/local/bin/backup-cron.sh && \
    dos2unix /usr/local/bin/backup-cron.sh 2>/dev/null || true

# Copia e configura entrypoint personalizado
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && \
    dos2unix /usr/local/bin/docker-entrypoint.sh 2>/dev/null || true

# Configura cron para backups automáticos (diário às 2h da manhã)
RUN echo "0 2 * * * /usr/local/bin/backup-cron.sh" | crontab -u mysql -

# Expõe porta 3306 (apenas para rede interna Docker)
EXPOSE 3306

# Healthcheck para verificar se MySQL está respondendo
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s \
    CMD mysqladmin ping -h localhost -u root || exit 1

# Define o diretório de trabalho
WORKDIR /var/lib/mysql

# Executa como root (necessário para iniciar MySQL)
USER root

# Entrypoint para inicialização do MySQL
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Comando padrão: iniciar MySQL em foreground
CMD ["mysqld"]
