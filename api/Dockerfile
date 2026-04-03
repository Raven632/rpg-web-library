FROM node:20

WORKDIR /app

# RUN sed -i 's/main$/main contrib non-free non-free-firmware/g' /etc/apt/sources.list.d/debian.sources || true

RUN sed -i 's/Components: main/Components: main contrib non-free non-free-firmware/g' /etc/apt/sources.list.d/debian.sources || true

# 1. Устанавливаем архиваторы: 7zip, 7zip-rar (плагин) и unar (Идеален для японского Shift-JIS)
# 1. Устанавливаем современные архиваторы: 7zip (дает 7zz), unrar и unar
RUN apt-get update && apt-get install -y \
    wget \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    python3 \
    build-essential \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && wget -q https://github.com/ip7z/7zip/releases/download/26.00/7z2600-linux-x64.tar.xz \
    && tar xf 7z2600-linux-x64.tar.xz 7zz \
    && mv 7zz /usr/local/bin/7zz \
    && rm -f 7z2600-linux-x64.tar.xz

# 2. Копируем файлы конфигурации npm
COPY package*.json ./

# 3. Устанавливаем твои основные пакеты
RUN npm install --omit=dev

RUN npm install sqlite3 --build-from-source
RUN npm install sqlite

# 4. Устанавливаем Puppeteer и модули для обхода Cloudflare
RUN npm install puppeteer-core puppeteer-extra puppeteer-extra-plugin-stealth

# 5. Копируем исходный код проекта
COPY server.js .
COPY public/ ./public/

# 6. Создаем системную папку для быстрой загрузки
RUN mkdir -p /tmp/rpg-uploads

EXPOSE 3000
CMD ["node", "server.js"]