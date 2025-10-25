FROM ubuntu:20.04

ENV PORT=8001

# Define o frontend como não interativo e configura o timezone
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Recife

# Instala as dependências
RUN apt-get update && apt-get install -y \
    python3-pip python3-dev libpq-dev wget git tzdata

WORKDIR /home/django

# Clona o repositório do projeto
RUN git clone https://github.com/jorgereiis/nossopainelgestao.git /home/django/app

# Copiar arquivos essenciais para o projeto
#COPY ./.env /home/django/app
#COPY ./database/db.sqlite3 /home/django/app

RUN mkdir /home/django/app/logs
RUN touch /home/django/app/logs/error.log
RUN mkdir -p /home/django/app/logs/Scheduler

# Define o diretório de trabalho e instala os requisitos
WORKDIR /home/django/app
RUN pip3 install --default-timeout=120 --no-cache-dir -r requirements.txt

# Expõe a porta para o servidor
EXPOSE 8001

# Faz as migrações e roda o servidor
#CMD ["sh", "-c", "python3 manage.py makemigrations && python3 manage.py migrate && python3 manage.py collectstatic --noinput && gunicorn --bind 0.0.0.0:8001 setup.wsgi:application"]
#CMD ["sh", "-c", "python3 manage.py makemigrations --merge && python3 manage.py migrate && python3 manage.py collectstatic --noinput && python3 manage.py runserver 0.0.0.0:8001"]

# Configuração do supervisord
RUN echo '[supervisord]\n\
nodaemon=true\n\
logfile=/var/log/supervisor/supervisord.log\n\
pidfile=/var/run/supervisord.pid\n\
loglevel=info\n\
\n\
[program:gunicorn]\n\
command=gunicorn setup.wsgi:application --bind 0.0.0.0:8001 --workers 3 --threads 2 --worker-class sync --timeout 120 --max-requests 1000 --max-requests-jitter 50 --access-logfile - --error-logfile - --log-level info --name nossopainel-django\n\
directory=/home/django/app\n\
autostart=true\n\
autorestart=true\n\
stdout_logfile=/dev/stdout\n\
stdout_logfile_maxbytes=0\n\
stderr_logfile=/dev/stderr\n\
stderr_logfile_maxbytes=0\n\
priority=1\n\
startsecs=10\n\
stopwaitsecs=30\n\
\n\
[program:agendamentos]\n\
command=python3 scripts/agendamentos.py\n\
directory=/home/django/app\n\
autostart=true\n\
autorestart=true\n\
stdout_logfile=/home/django/app/logs/Scheduler/agendamentos_stdout.log\n\
stderr_logfile=/home/django/app/logs/Scheduler/agendamentos_stderr.log\n\
stdout_logfile_maxbytes=10MB\n\
stderr_logfile_maxbytes=10MB\n\
stdout_logfile_backups=3\n\
stderr_logfile_backups=3\n\
priority=2\n\
startsecs=10\n\
stopwaitsecs=60\n\
killasgroup=true\n\
stopasgroup=true\n\
' > /etc/supervisor/conf.d/django.conf

# Script de inicialização
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
echo "🚀 Iniciando aplicação Django em PRODUÇÃO..."\n\
echo "================================================"\n\
\n\
# Verificar variáveis críticas\n\
if [ "$DEBUG" = "True" ]; then\n\
    echo "⚠️  WARNING: DEBUG=True detectado em produção!"\n\
    echo "   Configure DEBUG=False no .env"\n\
fi\n\
\n\
# Criar migrations\n\
echo "📦 Criando migrations..."\n\
python3 manage.py makemigrations --merge || {\n\
    echo "⚠️  Aviso: Problema ao criar migrations (continuando...)"\n\
}\n\
\n\
echo "📦 Aplicando migrations do banco de dados..."\n\
python3 manage.py migrate --noinput || {\n\
    echo "❌ Erro ao aplicar migrations!"\n\
    exit 1\n\
}\n\
\n\
# Coletar arquivos estáticos\n\
echo "📁 Coletando arquivos estáticos..."\n\
python3 manage.py collectstatic --noinput --clear || {\n\
    echo "❌ Erro ao coletar arquivos estáticos!"\n\
    exit 1\n\
}\n\
\n\
echo ""\n\
echo "✅ Inicializando serviços com Supervisor..."\n\
echo "   📡 Gunicorn:"\n\
echo "      • Workers: 3"\n\
echo "      • Threads por worker: 2"\n\
echo "      • Bind: 0.0.0.0:8001"\n\
echo "      • Timeout: 120s"\n\
echo "   ⏰ Agendamentos (scripts/agendamentos.py):"\n\
echo "      • 08:00 - GP Futebol"\n\
echo "      • 10:00 - GP Vendas (manhã)"\n\
echo "      • 12:00 - Scheduled Tasks"\n\
echo "      • 17:00 - Mensalidades Canceladas"\n\
echo "      • 20:00 - GP Vendas (noite)"\n\
echo "      • 23:00 - Telegram Connection"\n\
echo "      • 23:50 - Upload Telegram"\n\
echo "      • A cada 60min - Backup DB"\n\
echo "      • A cada 1min - Envios Agendados"\n\
echo "   📋 Logs:"\n\
echo "      • Gunicorn: stdout/stderr"\n\
echo "      • Agendamentos: logs/Scheduler/"\n\
echo "      • Supervisor: /var/log/supervisor/"\n\
echo "================================================"\n\
echo ""\n\
\n\
# Iniciar Supervisor\n\
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf\n\
' > /home/django/app/start.sh && chmod +x /home/django/app/start.sh

CMD ["/home/django/app/start.sh"]