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
# RUN git clone https://github.com/jorgereiis/nossopainelgestao.git /home/django/app

# Copiar arquivos essenciais para o projeto
COPY ./.env /home/django/app
COPY ./database/db.sqlite3 /home/django/app

# Define o diretório de trabalho e instala os requisitos
WORKDIR /home/django/app
RUN pip3 install --no-cache-dir -r requirements.txt

# Expõe a porta para o servidor
EXPOSE 8001

# Faz as migrações e roda o servidor
#CMD ["sh", "-c", "python3 manage.py makemigrations && python3 manage.py migrate && python3 manage.py collectstatic --noinput && gunicorn --bind 0.0.0.0:8001 setup.wsgi:application"]
CMD ["sh", "-c", "python3 manage.py makemigrations && python3 manage.py migrate && python3 manage.py collectstatic --noinput && python3 manage.py runserver 0.0.0.0:8001"]
