FROM node:18-bullseye as builder

ENV PORT=21465

RUN apt-get update && \
    apt-get install -y wget git

WORKDIR /home/node
RUN git clone https://github.com/wppconnect-team/wppconnect-server.git /home/node/app

WORKDIR /home/node/app

COPY ./config.ts /home/node/app/src

RUN yarn install

FROM node:18-bullseye
WORKDIR /home/node/app

# Instalar dependências do sistema operacional
RUN apt-get update && apt-get install -y \
    curl \
    dirmngr \
    apt-transport-https \
    lsb-release \
    ca-certificates \
    libgbm-dev \
    wget \
    unzip \
    fontconfig \
    locales \
    gconf-service \
    libasound2 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    fonts-liberation \
    libappindicator1 \
    libnss3 \
    xdg-utils \
    libxss-dev \
    libu2f-udev


RUN wget -c https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && dpkg -i google-chrome-stable_current_amd64.deb || apt-get install -f \
    && rm google-chrome-stable_current_amd64.deb

COPY --from=builder /home/node/app .
EXPOSE 21465
