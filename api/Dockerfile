FROM node:20

WORKDIR /app

# Подключаем нужные репозитории
RUN sed -i 's/Components: main/Components: main contrib non-free non-free-firmware/g' /etc/apt/sources.list.d/debian.sources || true

# Устанавливаем ТОЛЬКО необходимое: wget (для скачивания 7zz) и curl (для японского прокси)
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    python3 \
    build-essential \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && wget -q https://github.com/ip7z/7zip/releases/download/26.00/7z2600-linux-x64.tar.xz \
    && tar xf 7z2600-linux-x64.tar.xz 7zz \
    && mv 7zz /usr/local/bin/7zz \
    && rm -f 7z2600-linux-x64.tar.xz

COPY package*.json ./
RUN npm install --omit=dev
RUN npm install sqlite3 --build-from-source
RUN npm install sqlite

COPY server.js .
COPY public/ ./public/

USER node
EXPOSE 3000
CMD ["node", "server.js"]