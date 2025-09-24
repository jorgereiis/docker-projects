FROM node:20-bullseye as builder

ENV PORT=21465
ENV YARN_IGNORE_ENGINE=true
ENV NODE_ENV=development

# Dependências para compilar o sharp
RUN apt-get update && \
    apt-get install -y build-essential python3 make g++ git libvips-dev

WORKDIR /home/node
RUN git clone https://github.com/wppconnect-team/wppconnect-server.git /home/node/app

WORKDIR /home/node/app
COPY ./config.ts /home/node/app/src

# Instala dependências incluindo devDependencies
RUN yarn install --ignore-engines --frozen-lockfile

# Compila TypeScript e Babel (gera dist/)
RUN npx tsc && npx babel src --out-dir dist --extensions ".ts,.tsx" --source-maps inline --copy-files

# ------------------------------------------------------------------

FROM node:20-bullseye
WORKDIR /home/node/app

# Dependências do sistema + Chrome + libvips (sharp)
RUN apt-get update && apt-get install -y \
    build-essential python3 make g++ libvips-dev \
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

COPY --from=builder /home/node/app .

# 🔑 Remove qualquer binário pré-compilado e recompila sharp para sua CPU
RUN npm uninstall sharp && npm install --build-from-source sharp --force

EXPOSE 21465

CMD ["node", "dist/server.js"]
