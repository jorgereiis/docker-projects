FROM ubuntu:20.04

ENV PORT=8001

# Define o frontend como não interativo e configura o timezone
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Recife

# Instala as dependências
RUN apt-get update && apt-get install -y \
    python3-pip \
    python3-dev \
    libpq-dev \
    wget\
    git \
    tzdata \
    supervisor \
    build-essential \
    pkg-config \
    curl \
    nano \
    default-libmysqlclient-dev \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxext6 \
    libxrender1 \
    libxtst6 \
    fonts-liberation \
    libappindicator3-1 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /home/django

# Clona o repositório do projeto
RUN git clone https://github.com/jorgereiis/nossopainelgestao.git /home/django/app

RUN mkdir /home/django/app/logs
RUN touch /home/django/app/logs/error.log
RUN mkdir -p /home/django/app/logs/Scheduler
RUN mkdir -p /etc/supervisor/conf.d
RUN mkdir -p /var/log/supervisor

# Define o diretório de trabalho e instala os requisitos
WORKDIR /home/django/app
RUN pip3 install --default-timeout=150 --no-cache-dir -r requirements.txt

# Instala Playwright explicitamente (garante instalação mesmo se falhou no requirements.txt)
RUN pip3 install --no-cache-dir playwright==1.48.0 greenlet==3.1.1

# Instala o navegador Chromium e dependências do Playwright
RUN python3 -m playwright install chromium
RUN python3 -m playwright install-deps

# Expõe a porta para o servidor
EXPOSE 8001

# Healthcheck para verificar se o Django está respondendo
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=60s \
    CMD curl -f http://localhost:8001/ || exit 1

# Configuração do supervisord
RUN echo '[supervisord]' > /etc/supervisor/conf.d/django.conf && \
    echo 'nodaemon=true' >> /etc/supervisor/conf.d/django.conf && \
    echo 'logfile=/var/log/supervisor/supervisord.log' >> /etc/supervisor/conf.d/django.conf && \
    echo 'pidfile=/var/run/supervisord.pid' >> /etc/supervisor/conf.d/django.conf && \
    echo 'loglevel=info' >> /etc/supervisor/conf.d/django.conf && \
    echo '' >> /etc/supervisor/conf.d/django.conf && \
    echo '[program:gunicorn]' >> /etc/supervisor/conf.d/django.conf && \
    echo 'command=gunicorn setup.wsgi:application --bind 0.0.0.0:8001 --workers 3 --threads 2 --worker-class sync --timeout 120 --max-requests 1000 --max-requests-jitter 50 --access-logfile - --error-logfile - --log-level info --name nossopainel-django' >> /etc/supervisor/conf.d/django.conf && \
    echo 'directory=/home/django/app' >> /etc/supervisor/conf.d/django.conf && \
    echo 'autostart=true' >> /etc/supervisor/conf.d/django.conf && \
    echo 'autorestart=true' >> /etc/supervisor/conf.d/django.conf && \
    echo 'stdout_logfile=/dev/stdout' >> /etc/supervisor/conf.d/django.conf && \
    echo 'stdout_logfile_maxbytes=0' >> /etc/supervisor/conf.d/django.conf && \
    echo 'stderr_logfile=/dev/stderr' >> /etc/supervisor/conf.d/django.conf && \
    echo 'stderr_logfile_maxbytes=0' >> /etc/supervisor/conf.d/django.conf && \
    echo 'priority=1' >> /etc/supervisor/conf.d/django.conf && \
    echo 'startsecs=10' >> /etc/supervisor/conf.d/django.conf && \
    echo 'stopwaitsecs=30' >> /etc/supervisor/conf.d/django.conf && \
    echo '' >> /etc/supervisor/conf.d/django.conf && \
    echo '[program:agendamentos]' >> /etc/supervisor/conf.d/django.conf && \
    echo 'command=python3 scripts/agendamentos.py' >> /etc/supervisor/conf.d/django.conf && \
    echo 'directory=/home/django/app' >> /etc/supervisor/conf.d/django.conf && \
    echo 'autostart=true' >> /etc/supervisor/conf.d/django.conf && \
    echo 'autorestart=true' >> /etc/supervisor/conf.d/django.conf && \
    echo 'stdout_logfile=/home/django/app/logs/Scheduler/agendamentos_stdout.log' >> /etc/supervisor/conf.d/django.conf && \
    echo 'stderr_logfile=/home/django/app/logs/Scheduler/agendamentos_stderr.log' >> /etc/supervisor/conf.d/django.conf && \
    echo 'stdout_logfile_maxbytes=10MB' >> /etc/supervisor/conf.d/django.conf && \
    echo 'stderr_logfile_maxbytes=10MB' >> /etc/supervisor/conf.d/django.conf && \
    echo 'stdout_logfile_backups=3' >> /etc/supervisor/conf.d/django.conf && \
    echo 'stderr_logfile_backups=3' >> /etc/supervisor/conf.d/django.conf && \
    echo 'priority=2' >> /etc/supervisor/conf.d/django.conf && \
    echo 'startsecs=10' >> /etc/supervisor/conf.d/django.conf && \
    echo 'stopwaitsecs=60' >> /etc/supervisor/conf.d/django.conf && \
    echo 'killasgroup=true' >> /etc/supervisor/conf.d/django.conf && \
    echo 'stopasgroup=true' >> /etc/supervisor/conf.d/django.conf && \
    echo 'numprocs=1' >> /etc/supervisor/conf.d/django.conf && \
    echo 'process_name=%(program_name)s' >> /etc/supervisor/conf.d/django.conf

# Script de inicialização
RUN echo '#!/bin/bash' > /home/django/app/start.sh && \
    echo 'set -e' >> /home/django/app/start.sh && \
    echo '' >> /home/django/app/start.sh && \
    echo 'echo "🚀 Iniciando aplicação Django em PRODUÇÃO..."' >> /home/django/app/start.sh && \
    echo 'echo "================================================"' >> /home/django/app/start.sh && \
    echo '' >> /home/django/app/start.sh && \
    echo 'if [ "$DEBUG" = "True" ]; then' >> /home/django/app/start.sh && \
    echo '    echo "⚠️  WARNING: DEBUG=True detectado em produção!"' >> /home/django/app/start.sh && \
    echo '    echo "   Configure DEBUG=False no .env"' >> /home/django/app/start.sh && \
    echo 'fi' >> /home/django/app/start.sh && \
    echo '' >> /home/django/app/start.sh && \
    echo 'echo "📦 Criando migrations..."' >> /home/django/app/start.sh && \
    echo 'python3 manage.py makemigrations --merge 2>/dev/null || echo "⚠️  Sem migrations para merge"' >> /home/django/app/start.sh && \
    echo '' >> /home/django/app/start.sh && \
    echo 'echo "📦 Aplicando migrations do banco de dados..."' >> /home/django/app/start.sh && \
    echo 'python3 manage.py migrate --noinput || {' >> /home/django/app/start.sh && \
    echo '    echo "❌ Erro ao aplicar migrations!"' >> /home/django/app/start.sh && \
    echo '    exit 1' >> /home/django/app/start.sh && \
    echo '}' >> /home/django/app/start.sh && \
    echo '' >> /home/django/app/start.sh && \
    echo 'echo "📁 Coletando arquivos estáticos..."' >> /home/django/app/start.sh && \
    echo 'python3 manage.py collectstatic --noinput --clear || {' >> /home/django/app/start.sh && \
    echo '    echo "❌ Erro ao coletar arquivos estáticos!"' >> /home/django/app/start.sh && \
    echo '    exit 1' >> /home/django/app/start.sh && \
    echo '}' >> /home/django/app/start.sh && \
    echo '' >> /home/django/app/start.sh && \
    echo 'echo ""' >> /home/django/app/start.sh && \
    echo 'echo "✅ Inicializando serviços com Supervisor..."' >> /home/django/app/start.sh && \
    echo 'echo "   📡 Gunicorn: 3 workers na porta 8001"' >> /home/django/app/start.sh && \
    echo 'echo "   ⏰ Agendamentos: scripts rodando"' >> /home/django/app/start.sh && \
    echo 'echo "   📋 Logs: logs/Scheduler/"' >> /home/django/app/start.sh && \
    echo 'echo "================================================"' >> /home/django/app/start.sh && \
    echo 'echo ""' >> /home/django/app/start.sh && \
    echo '' >> /home/django/app/start.sh && \
    echo 'exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf' >> /home/django/app/start.sh && \
    chmod +x /home/django/app/start.sh

CMD ["/home/django/app/start.sh"]