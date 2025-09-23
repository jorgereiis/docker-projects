FROM node:22.19.0-bullseye as builder

WORKDIR /home/node/app

# Dependências de compilação
RUN apt-get update && apt-get install -y \
    wget git build-essential python3 make g++ \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev libvips-dev \
    jq \
    && rm -rf /var/lib/apt/lists/*

# Clonar projeto
RUN git clone https://github.com/wppconnect-team/wppconnect-server.git .

COPY ./config.ts /home/node/app/src

# Injetar resolução para forçar sharp compatível em TODAS as dependências
RUN jq '.resolutions.sharp="^0.33.4"' package.json > package.json.tmp && mv package.json.tmp package.json

# Instalar dependências
RUN yarn install --frozen-lockfile --ignore-optional

# Forçar sharp compatível já no build
RUN rm -rf node_modules/sharp/vendor \
 && npm install sharp@^0.33.4 --build-from-source --force --verbose

# -----------------------------------------

FROM node:22.19.0-bullseye
WORKDIR /home/node/app

# Dependências necessárias no runtime
RUN apt-get update && apt-get install -y \
    build-essential python3 make g++ \
    libvips-dev libvips42 \
    wget unzip fontconfig ca-certificates curl \
    libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
    libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 \
    libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 \
    libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 \
    libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 \
    libxtst6 fonts-liberation libappindicator1 libnss3 xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Chrome
RUN wget -c https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && dpkg -i google-chrome-stable_current_amd64.deb || apt-get -fy install \
    && rm google-chrome-stable_current_amd64.deb

# Copiar do builder
COPY --from=builder /home/node/app .

# Rebuild de TODOS os sharp dentro da árvore (incluindo os de @wppconnect-team/wppconnect)
RUN find node_modules -type d -name "sharp" \
    -exec rm -rf {}/vendor \; \
    -exec npm rebuild sharp --build-from-source --force --verbose --prefix {} \;

EXPOSE 21465