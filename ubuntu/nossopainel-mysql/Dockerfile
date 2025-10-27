FROM mysql:5.7

# Define variáveis de ambiente
ENV MYSQL_DATABASE=nossopaineldb
ENV TZ=America/Recife

# Instala timezone data e cron para backups automáticos
RUN apt-get update && \
    apt-get install -y tzdata cron && \
    ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && \
    echo $TZ > /etc/timezone && \
    rm -rf /var/lib/apt/lists/*

# Copia configurações customizadas do MySQL
COPY my.cnf /etc/mysql/conf.d/custom.cnf

# Copia script de inicialização (importa dump na primeira execução)
COPY init-db.sh /docker-entrypoint-initdb.d/
RUN chmod +x /docker-entrypoint-initdb.d/init-db.sh

# Copia script de backup
COPY backup-cron.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup-cron.sh

# Configura cron para backup diário às 3h da manhã
RUN echo "0 3 * * * /usr/local/bin/backup-cron.sh >> /var/log/mysql-backup.log 2>&1" | crontab -

# Cria diretório de backups
RUN mkdir -p /backups && chmod 755 /backups

# Expõe porta 3306 (apenas para rede interna Docker)
EXPOSE 3306

# Healthcheck
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s \
    CMD mysqladmin ping -h localhost -u root -p${MYSQL_ROOT_PASSWORD} || exit 1
