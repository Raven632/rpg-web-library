# ==========================================
# ЭТАП 1: Сборка фронтенда (React/Vite)
# ==========================================
FROM node:20 AS builder

WORKDIR /app/frontend

# Копируем конфиги и ставим зависимости фронтенда
COPY frontend/package*.json ./
RUN npm install

# Копируем весь исходный код React и собираем статику
COPY frontend/ ./
RUN npm run build
# На выходе получаем готовую папку /app/frontend/dist

# ==========================================
# ЭТАП 2: Сборка Бэкенда и финальный релиз
# ==========================================
FROM node:20

WORKDIR /app

# Подключаем нужные репозитории (из твоего старого конфига)
RUN sed -i 's/Components: main/Components: main contrib non-free non-free-firmware/g' /etc/apt/sources.list.d/debian.sources || true

# Устанавливаем системные зависимости: wget, curl, ffmpeg, python3, build-essential
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    ffmpeg \
    python3 \
    build-essential \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && wget -q https://github.com/ip7z/7zip/releases/download/26.00/7z2600-linux-x64.tar.xz \
    && tar xf 7z2600-linux-x64.tar.xz 7zz \
    && mv 7zz /usr/local/bin/7zz \
    && rm -f 7z2600-linux-x64.tar.xz

# Переходим в рабочую папку API
WORKDIR /app/api

# Копируем конфиги бэкенда и ставим зависимости
COPY --chown=node:node api/package*.json ./
RUN npm install --omit=dev
RUN npm install sqlite3 --build-from-source
RUN npm install sqlite

# Копируем весь исходный код бэкенда (включая api/public/rpg-fixes.js)
COPY --chown=node:node api/ ./

# МАГИЯ: Забираем собранный сайт из первого этапа 
# и кладем его ВНУТРЬ папки public нашего бэкенда!
COPY --chown=node:node --from=builder /app/frontend/dist/ ./public/

USER node
EXPOSE 3000

# Запускаем сервер
CMD ["node", "server.js"]