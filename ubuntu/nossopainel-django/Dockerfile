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

#RUN mkdir /home/django/app/logs
#RUN touch /home/django/app/logs/error.log

# Define o diretório de trabalho e instala os requisitos
WORKDIR /home/django/app
RUN pip3 install --default-timeout=120 --no-cache-dir -r requirements.txt

# Expõe a porta para o servidor
EXPOSE 8001

# Faz as migrações e roda o servidor
#CMD ["sh", "-c", "python3 manage.py makemigrations && python3 manage.py migrate && python3 manage.py collectstatic --noinput && gunicorn --bind 0.0.0.0:8001 setup.wsgi:application"]
#CMD ["sh", "-c", "python3 manage.py makemigrations --merge && python3 manage.py migrate && python3 manage.py collectstatic --noinput && python3 manage.py runserver 0.0.0.0:8001"]

# Criar script de inicialização
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
python3 manage.py makemigrations --merge || {\n\
    echo "❌ Erro ao criar migrations!"\n\
    exit 1\n\
}\n\
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
echo "✅ Inicializando Gunicorn..."\n\
echo "   Workers: 3"\n\
echo "   Threads por worker: 2"\n\
echo "   Bind: 0.0.0.0:8001"\n\
echo "   Timeout: 120s"\n\
echo "================================================"\n\
echo ""\n\
\n\
# Iniciar Gunicorn\n\
exec gunicorn setup.wsgi:application \\\n\
    --bind 0.0.0.0:8001 \\\n\
    --workers 3 \\\n\
    --threads 2 \\\n\
    --worker-class sync \\\n\
    --timeout 120 \\\n\
    --max-requests 1000 \\\n\
    --max-requests-jitter 50 \\\n\
    --access-logfile - \\\n\
    --error-logfile - \\\n\
    --log-level info \\\n\
    --name nossopainel-django\n\
' > /home/django/app/start.sh && chmod +x /home/django/app/start.sh

# Comando de inicialização
CMD ["/home/django/app/start.sh"]