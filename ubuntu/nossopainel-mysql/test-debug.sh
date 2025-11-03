#!/bin/bash
###############################################################################
# Script de DEBUG - Teste de Autenticação MySQL
###############################################################################

echo "======================================================================"
echo "DEBUG: Teste de Autenticação MySQL"
echo "======================================================================"
echo ""

# 1. Verifica onde está executando
echo "1. Diretório atual:"
pwd
echo ""

# 2. Verifica se .env existe
echo "2. Procurando arquivo .env:"
if [ -f .env ]; then
    echo "   ✓ Encontrado: .env"
    ls -la .env
else
    echo "   ✗ NÃO encontrado: .env"
fi
echo ""

# 3. Tenta ler senha
echo "3. Lendo MYSQL_PASSWORD do .env:"
if [ -f .env ]; then
    MYSQL_PASSWORD=$(grep '^MYSQL_PASSWORD=' .env | cut -d'=' -f2)
    echo "   Senha lida: [$MYSQL_PASSWORD]"
    echo "   Tamanho: ${#MYSQL_PASSWORD} caracteres"
else
    echo "   ✗ Arquivo .env não existe"
fi
echo ""

# 4. Testa comando direto (COM senha hardcoded que funciona)
echo "4. Testando comando direto (senha hardcoded):"
RESULTADO=$(docker exec nossopainel-mysql mysql -u nossopaineluser -p'DbP4$$N0ss0P4n3ll' -e 'SELECT 1' --silent 2>&1)
echo "   Resultado: [$RESULTADO]"
if echo "$RESULTADO" | grep -q '^1$'; then
    echo "   ✓ SUCESSO com senha hardcoded"
else
    echo "   ✗ FALHOU com senha hardcoded"
fi
echo ""

# 5. Testa comando com senha do .env
echo "5. Testando comando com senha do .env:"
if [ -n "$MYSQL_PASSWORD" ]; then
    echo "   Usando senha: [$MYSQL_PASSWORD]"

    RESULTADO=$(docker exec nossopainel-mysql mysql -u nossopaineluser -p"$MYSQL_PASSWORD" -e 'SELECT 1' --silent 2>&1)
    echo "   Resultado: [$RESULTADO]"

    if echo "$RESULTADO" | grep -q '^1$'; then
        echo "   ✓ SUCESSO"
    else
        echo "   ✗ FALHOU"
    fi
else
    echo "   ✗ Senha não foi lida do .env"
fi
echo ""

# 6. Compara senhas
echo "6. Comparação de senhas:"
echo "   Esperada: [DbP4\$\$N0ss0P4n3ll]"
echo "   Lida:     [$MYSQL_PASSWORD]"
if [ "$MYSQL_PASSWORD" = "DbP4\$\$N0ss0P4n3ll" ]; then
    echo "   ✓ Senhas IGUAIS"
else
    echo "   ✗ Senhas DIFERENTES!"

    # Mostra em hexadecimal para ver caracteres ocultos
    echo ""
    echo "   Hex esperado: $(echo -n 'DbP4$$N0ss0P4n3ll' | xxd -p)"
    echo "   Hex lido:     $(echo -n "$MYSQL_PASSWORD" | xxd -p)"
fi
echo ""

echo "======================================================================"
echo "Fim do debug"
echo "======================================================================"
