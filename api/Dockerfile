FROM node:20

WORKDIR /app

RUN sed -i 's/main$/main contrib non-free non-free-firmware/g' /etc/apt/sources.list.d/debian.sources || true

# 1. Устанавливаем архиватор (p7zip-full дает команду 7z) и Chromium с поддержкой азиатских шрифтов
RUN apt-get update && apt-get install -y \
    7zip \
    unrar \ 
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    python3 \
    build-essential \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

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

# 6. Создаем системную папку для загрузок
RUN mkdir -p /tmp/rpg-uploads

EXPOSE 3000
CMD ["node", "server.js"]