FROM node:20-bullseye as builder

ENV PORT=21465
ENV YARN_IGNORE_ENGINE=true

RUN apt-get update && \
    apt-get install -y build-essential python3 make g++ git

WORKDIR /home/node
RUN git clone https://github.com/wppconnect-team/wppconnect-server.git /home/node/app

WORKDIR /home/node/app

COPY ./config.ts /home/node/app/src

# Compila para dist/
RUN yarn build --ignore-engines

# ------------------------------------------------------------------

FROM node:20-bullseye
WORKDIR /home/node/app

# Dependências do sistema + Chrome + libvips (sharp)
RUN apt-get update && apt-get install -y \
    build-essential python3 make g++ \
    libvips-dev \
    curl wget unzip fontconfig \
    gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 \
    libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 \
    libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 \
    libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 \
    libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 \
    libxi6 libxrandr2 libxrender1 libxss1 libxtst6 fonts-liberation \
    libappindicator1 libnss3 xdg-utils libxss-dev libu2f-udev \
    && rm -rf /var/lib/apt/lists/*

# Instala o Chrome
RUN wget -c https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && dpkg -i google-chrome-stable_current_amd64.deb || apt-get install -f -y \
    && rm google-chrome-stable_current_amd64.deb

# Copia o projeto já compilado
COPY --from=builder /home/node/app .

# Remove binários pré-compilados do sharp e recompila do zero
RUN npm uninstall sharp && npm install --build-from-source sharp

EXPOSE 21465

# Sobe em produção usando o dist compilado
CMD ["node", "dist/server.js"]