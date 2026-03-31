FROM node:20-alpine

WORKDIR /app

# Устанавливаем архиватор
RUN apk add --no-cache 7zip

# Копируем зависимости
COPY package*.json ./
RUN npm install --omit=dev

# Копируем код
COPY server.js .
COPY public/ ./public/

# Системная папка для загрузок
RUN mkdir -p /tmp/rpg-uploads

EXPOSE 3000
CMD ["node", "server.js"]
