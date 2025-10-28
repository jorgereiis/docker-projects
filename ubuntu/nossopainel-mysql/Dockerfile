# ==============================================================================
# MySQL 5.7 Container - Nosso Painel Gestão
# ==============================================================================
# Base: Imagem oficial MySQL 5.7 (Debian com bash disponível)
# Referência: https://hub.docker.com/_/mysql
# ==============================================================================

FROM mysql:5.7

# Define variáveis de ambiente
# Nota: A imagem mysql:5.7 já reconhece estas variáveis automaticamente
ENV MYSQL_DATABASE=nossopaineldb \
    TZ=America/Recife

# Instala pacotes extras necessários
# MySQL 5.7 e bash já estão incluídos na imagem base
RUN apt-get update && apt-get install -y \
    cron \
    nano \
    dos2unix \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Cria diretório de backups
RUN mkdir -p /backups && chmod 755 /backups

# Copia configurações customizadas do MySQL
# A imagem mysql:5.7 carrega automaticamente arquivos de /etc/mysql/conf.d/
COPY my.cnf /etc/mysql/conf.d/custom.cnf
RUN chmod 644 /etc/mysql/conf.d/custom.cnf

# Copia script de inicialização (importa dump na primeira execução)
# A imagem mysql:5.7 executa automaticamente scripts em /docker-entrypoint-initdb.d/
# Ordem: *.sh (executados), depois *.sql (importados), depois *.sql.gz (descompactados e importados)
COPY init-db.sh /docker-entrypoint-initdb.d/init-db.sh
RUN chmod +x /docker-entrypoint-initdb.d/init-db.sh && \
    dos2unix /docker-entrypoint-initdb.d/init-db.sh 2>/dev/null || true

# Copia script de backup
COPY backup-cron.sh /usr/local/bin/backup-cron.sh
RUN chmod +x /usr/local/bin/backup-cron.sh && \
    dos2unix /usr/local/bin/backup-cron.sh 2>/dev/null || true

# Configura cron para backups automáticos (diário às 2h da manhã)
RUN echo "0 2 * * * /usr/local/bin/backup-cron.sh" | crontab -

# Copia wrapper de entrypoint para iniciar cron + MySQL
COPY docker-entrypoint-wrapper.sh /usr/local/bin/docker-entrypoint-wrapper.sh
RUN chmod +x /usr/local/bin/docker-entrypoint-wrapper.sh && \
    dos2unix /usr/local/bin/docker-entrypoint-wrapper.sh 2>/dev/null || true

# Expõe porta 3306 (apenas para rede interna Docker)
# Nota: A imagem mysql:5.7 já expõe a porta 3306, mas mantemos explícito
EXPOSE 3306

# Healthcheck para verificar se MySQL está respondendo
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s \
    CMD mysqladmin ping -h localhost -u root -p${MYSQL_ROOT_PASSWORD} || exit 1

# ==============================================================================
# ENTRYPOINT E CMD
# ==============================================================================
# Usamos um wrapper que:
# 1. Inicia cron (para backups automáticos)
# 2. Chama o entrypoint original do mysql:5.7
#
# O entrypoint original do MySQL faz:
# 1. Inicializa o banco na primeira execução
# 2. Cria usuário e banco configurados via ENV
# 3. Executa scripts em /docker-entrypoint-initdb.d/
# 4. Inicia MySQL em foreground
# ==============================================================================

ENTRYPOINT ["/usr/local/bin/docker-entrypoint-wrapper.sh"]
CMD ["mysqld"]
