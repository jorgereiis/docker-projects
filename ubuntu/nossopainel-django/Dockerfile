FROM ubuntu:20.04

ENV PORT=8001

# Define o frontend como não interativo e configura o timezone
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Recife

# Instala as dependências
RUN apt-get update && apt-get install -y \
    python3-pip python3-dev libpq-dev wget git tzdata supervisor && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /home/django

# Clona o repositório do projeto
RUN git clone https://github.com/jorgereiis/nossopainelgestao.git /home/django/app

# Copiar arquivos essenciais para o projeto
#COPY ./.env /home/django/app
#COPY ./database/db.sqlite3 /home/django/app

RUN mkdir /home/django/app/logs
RUN touch /home/django/app/logs/error.log
RUN mkdir -p /home/django/app/logs/Scheduler
RUN mkdir -p /etc/supervisor/conf.d
RUN mkdir -p /var/log/supervisor

# Define o diretório de trabalho e instala os requisitos
WORKDIR /home/django/app
RUN pip3 install --default-timeout=120 --no-cache-dir -r requirements.txt

# Expõe a porta para o servidor
EXPOSE 8001

# Faz as migrações e roda o servidor
#CMD ["sh", "-c", "python3 manage.py makemigrations && python3 manage.py migrate && python3 manage.py collectstatic --noinput && gunicorn --bind 0.0.0.0:8001 setup.wsgi:application"]
#CMD ["sh", "-c", "python3 manage.py makemigrations --merge && python3 manage.py migrate && python3 manage.py collectstatic --noinput && python3 manage.py runserver 0.0.0.0:8001"]

# Configuração do supervisord (arquivo mais legível)
COPY <<EOF /etc/supervisor/conf.d/django.conf
[supervisord]
nodaemon=true
logfile=/var/log/supervisor/supervisord.log
pidfile=/var/run/supervisord.pid
loglevel=info

[program:gunicorn]
command=gunicorn setup.wsgi:application --bind 0.0.0.0:8001 --workers 3 --threads 2 --worker-class sync --timeout 120 --max-requests 1000 --max-requests-jitter 50 --access-logfile - --error-logfile - --log-level info --name nossopainel-django
directory=/home/django/app
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
priority=1
startsecs=10
stopwaitsecs=30

[program:agendamentos]
command=python3 scripts/agendamentos.py
directory=/home/django/app
autostart=true
autorestart=true
stdout_logfile=/home/django/app/logs/Scheduler/agendamentos_stdout.log
stderr_logfile=/home/django/app/logs/Scheduler/agendamentos_stderr.log
stdout_logfile_maxbytes=10MB
stderr_logfile_maxbytes=10MB
stdout_logfile_backups=3
stderr_logfile_backups=3
priority=2
startsecs=10
stopwaitsecs=60
killasgroup=true
stopasgroup=true
numprocs=1
process_name=%(program_name)s
EOF

# Script de inicialização
COPY <<'EOF' /home/django/app/start.sh
#!/bin/bash
set -e

echo "🚀 Iniciando aplicação Django em PRODUÇÃO..."
echo "================================================"

# Verificar variáveis críticas
if [ "$DEBUG" = "True" ]; then
    echo "⚠️  WARNING: DEBUG=True detectado em produção!"
    echo "   Configure DEBUG=False no .env"
fi

# Criar migrations
echo "📦 Criando migrations..."
python3 manage.py makemigrations --merge 2>/dev/null || echo "⚠️  Sem migrations para merge"

echo "📦 Aplicando migrations do banco de dados..."
python3 manage.py migrate --noinput || {
    echo "❌ Erro ao aplicar migrations!"
    exit 1
}

# Coletar arquivos estáticos
echo "📁 Coletando arquivos estáticos..."
python3 manage.py collectstatic --noinput --clear || {
    echo "❌ Erro ao coletar arquivos estáticos!"
    exit 1
}

echo ""
echo "✅ Inicializando serviços com Supervisor..."
echo "   📡 Gunicorn:"
echo "      • Workers: 3"
echo "      • Threads por worker: 2"
echo "      • Bind: 0.0.0.0:8001"
echo "      • Timeout: 120s"
echo "   ⏰ Agendamentos (scripts/agendamentos.py):"
echo "      • 08:00 - GP Futebol"
echo "      • 10:00 - GP Vendas (manhã)"
echo "      • 12:00 - Scheduled Tasks"
echo "      • 17:00 - Mensalidades Canceladas"
echo "      • 20:00 - GP Vendas (noite)"
echo "      • 23:00 - Telegram Connection"
echo "      • 23:50 - Upload Telegram"
echo "      • A cada 60min - Backup DB"
echo "      • A cada 1min - Envios Agendados"
echo "   📋 Logs:"
echo "      • Gunicorn: stdout/stderr"
echo "      • Agendamentos: logs/Scheduler/"
echo "      • Supervisor: /var/log/supervisor/"
echo "================================================"
echo ""

# Iniciar Supervisor
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
EOF

RUN chmod +x /home/django/app/start.sh

CMD ["/home/django/app/start.sh"]