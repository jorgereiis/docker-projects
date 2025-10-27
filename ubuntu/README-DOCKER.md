# Docker - Nosso Painel Gestão

Documentação completa para deploy em produção usando Docker.

## 📋 Arquitetura

### SERVIDOR 1: Django + MySQL + Nginx + Certbot
- `mysql-build.yml` - Container MySQL 8.0
- `django-build.yml` - Container Django + Nginx + Certbot

### SERVIDOR 2: WPPConnect (WhatsApp API)
- `wppconnect-build.yml` - Container WPPConnect + Nginx

---

## 🚀 Deploy Rápido

### SERVIDOR 1

```bash
cd docker/ubuntu

# 1. Configurar variáveis de ambiente
cp .env.example .env
nano .env  # Preencher MYSQL_PASSWORD

# 2. (OPCIONAL) Copiar dump SQL para importação inicial
cp /caminho/do/nossopaineldb.sql nossopainel-mysql/nossopaineldb.sql

# 3. Iniciar containers
./start-servidor1.sh

# 4. Verificar logs
docker logs nossopainel-mysql
docker logs nossopainel-django
docker logs nossopainel-nginx
```

### SERVIDOR 2

```bash
cd docker/ubuntu

# Iniciar WPPConnect
./start-servidor2.sh

# Verificar logs
docker logs wppconnect-server
docker logs wppconnect-nginx
```

---

## 🔒 Segurança do MySQL

### ✅ MySQL 100% Protegido

O MySQL está configurado com **múltiplas camadas de segurança**:

1. **Rede Interna Isolada (`database-network`)**
   - `internal: true` - NÃO permite acesso externo
   - Apenas containers na mesma rede conseguem ver o MySQL

2. **SEM Porta Exposta**
   - NÃO há `ports: 3306:3306` no mysql-build.yml
   - Impossível acessar de fora do Docker

3. **Acesso Restrito**
   - Apenas o container `nossopainel-django` tem acesso
   - Nginx, Certbot e outros NÃO conseguem acessar

4. **Verificação de Segurança**
   ```bash
   # Tentar conectar de FORA do Docker (deve FALHAR)
   mysql -h IP_SERVIDOR -u nossopaineluser -p
   # Resultado esperado: Connection refused ou timeout

   # Conectar de DENTRO do Django (deve FUNCIONAR)
   docker exec nossopainel-django mysql -h nossopainel-mysql -u nossopaineluser -p
   # Resultado esperado: conecta normalmente

   # Tentar de outro container (deve FALHAR)
   docker exec nossopainel-nginx ping nossopainel-mysql
   # Resultado esperado: host not found
   ```

---

## 📦 Estrutura de Arquivos

```
docker/ubuntu/
├── .env.example                 # Template de variáveis de ambiente
├── .env                        # Variáveis (criar a partir do .example)
│
├── mysql-build.yml             # Container MySQL
├── django-build.yml            # Containers Django + Nginx + Certbot
├── wppconnect-build.yml        # Containers WPPConnect + Nginx
│
├── start-servidor1.sh          # Inicia SERVIDOR 1
├── stop-servidor1.sh           # Para SERVIDOR 1
├── start-servidor2.sh          # Inicia SERVIDOR 2
├── stop-servidor2.sh           # Para SERVIDOR 2
│
├── nossopainel-mysql/
│   ├── Dockerfile              # Imagem MySQL customizada
│   ├── my.cnf                  # Configurações MySQL
│   ├── init-db.sh              # Script de inicialização
│   ├── backup-cron.sh          # Backup automático (cron diário)
│   ├── data/                   # Dados do MySQL (persistente)
│   ├── backups/                # Backups automáticos
│   └── logs/                   # Logs do MySQL
│
├── nossopainel-django/
│   ├── Dockerfile              # Já existe
│   ├── .env                    # Variáveis Django (com DB_ENGINE=mysql)
│   ├── mediafiles/
│   ├── staticfiles/
│   └── database/               # Logs
│
└── [outros diretórios...]
```

---

## 🔧 Configuração Detalhada

### 1. Variáveis de Ambiente (.env)

```bash
# SERVIDOR 1 - docker/ubuntu/.env
MYSQL_USER=nossopaineluser
MYSQL_PASSWORD=SuaSenhaUserForte456!@#
```

```bash
# SERVIDOR 1 - nossopainel-django/.env
DEBUG=False
DB_ENGINE=mysql
DB_HOST=nossopainel-mysql
DB_PORT=3306
DB_NAME=nossopaineldb
DB_USER=nossopaineluser
DB_PASSWORD=SuaSenhaUserForte456!@#
SECRET_KEY=...
# ... outras variáveis Django
```

### 2. Importação do Dump SQL (Primeira Execução)

**Opção A - Importação Automática:**
```bash
# Copiar dump para o diretório MySQL
cp /caminho/do/backup.sql nossopainel-mysql/nossopaineldb.sql

# Descomentar linha no mysql-build.yml:
# volumes:
#   - ./nossopainel-mysql/nossopaineldb.sql:/docker-entrypoint-initdb.d/nossopaineldb.sql:ro

# Iniciar (importará automaticamente na primeira vez)
./start-servidor1.sh
```

**Opção B - Importação Manual:**
```bash
# Iniciar MySQL vazio
./start-servidor1.sh

# Importar dump manualmente
docker exec -i nossopainel-mysql mysql -u root -p"$MYSQL_ROOT_PASSWORD" nossopaineldb < backup.sql
```

**Opção C - Usar backup_mysql.sh:**
```bash
# No ambiente de desenvolvimento
./backup_mysql.sh

# Transferir para produção
scp backups_mysql/nossopaineldb_*.sql.gz usuario@servidor:/tmp/

# No servidor de produção
gunzip nossopaineldb_*.sql.gz
docker exec -i nossopainel-mysql mysql -u root -p nossopaineldb < nossopaineldb_*.sql
```

---

## 📊 Gerenciamento

### Ver logs
```bash
# Logs do MySQL
docker logs nossopainel-mysql
docker logs -f nossopainel-mysql --tail 100

# Logs do Django
docker logs nossopainel-django
docker exec nossopainel-django tail -f logs/Scheduler/scheduler.log

# Logs do Nginx
docker logs nossopainel-nginx
```

### Acessar containers
```bash
# MySQL (executar comandos SQL)
docker exec -it nossopainel-mysql mysql -u root -p

# Django (executar manage.py)
docker exec -it nossopainel-django python manage.py shell
docker exec -it nossopainel-django python manage.py migrate

# Bash no container
docker exec -it nossopainel-django bash
```

### Backups Manuais
```bash
# Backup manual do MySQL
docker exec nossopainel-mysql /usr/local/bin/backup-cron.sh

# Listar backups
docker exec nossopainel-mysql ls -lh /backups/

# Copiar backup para host
docker cp nossopainel-mysql:/backups/nossopaineldb_20251027_030000.sql.gz ./
```

### Restart de containers
```bash
# Restart individual
docker restart nossopainel-mysql
docker restart nossopainel-django
docker restart nossopainel-nginx

# Restart todos (SERVIDOR 1)
./stop-servidor1.sh
./start-servidor1.sh
```

---

## 🩺 Healthchecks

Todos os containers têm healthchecks configurados:

```bash
# Ver status de saúde
docker ps --format "table {{.Names}}\t{{.Status}}"

# Healthcheck específico
docker inspect --format='{{.State.Health.Status}}' nossopainel-mysql
# Possíveis: starting, healthy, unhealthy
```

**Ordem de Inicialização Garantida:**
1. MySQL inicia primeiro
2. Django aguarda MySQL ficar `healthy`
3. Nginx aguarda Django ficar `healthy`

---

## 🔄 Atualizações

### Atualizar código Django
```bash
# 1. Para o Django
docker stop nossopainel-django nossopainel-nginx

# 2. Rebuild da imagem (puxa código novo do Git)
docker-compose -f django-build.yml build nossopainel-django

# 3. Reinicia
docker-compose -f django-build.yml up -d
```

### Aplicar Migrations
```bash
docker exec nossopainel-django python manage.py migrate
```

---

## ⚠️ Troubleshooting

### MySQL não inicia
```bash
# Ver logs
docker logs nossopainel-mysql

# Problemas comuns:
# - Porta 3306 já em uso: parar MySQL local
# - Permissões em data/: chown -R 999:999 nossopainel-mysql/data/
# - Senha incorreta no .env
```

### Django não conecta no MySQL
```bash
# Verificar variáveis de ambiente
docker exec nossopainel-django env | grep DB_

# Testar conexão
docker exec nossopainel-django python manage.py dbshell

# Ver logs de erro
docker logs nossopainel-django
```

### Erro "database is locked"
✅ **Resolvido!** Ao usar MySQL, este erro NÃO deve mais acontecer.

---

## 📝 Checklist de Produção

- [ ] `.env` criado e preenchido com senhas fortes
- [ ] `.env` com permissões 600 (`chmod 600 .env`)
- [ ] Dump SQL preparado (se necessário)
- [ ] Firewall configurado (liberar portas 80/443)
- [ ] DNS apontando para o servidor
- [ ] Certificado SSL configurado (Certbot)
- [ ] Backups automáticos testados
- [ ] Healthchecks validados
- [ ] MySQL inacessível de fora (teste de segurança)
- [ ] Monitoramento configurado
- [ ] Documentação de rollback preparada

---

## 🆘 Suporte

Em caso de problemas:

1. Verificar logs: `docker logs <container>`
2. Verificar healthcheck: `docker ps`
3. Verificar redes: `docker network inspect database-network`
4. Consultar logs do sistema: `journalctl -u docker`

---

**Última atualização:** 27/10/2025
**Versão:** 1.0
