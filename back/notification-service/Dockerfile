# base build
FROM node:20-alpine AS base
WORKDIR /app/back
COPY package*.json ./
RUN npm install --omit=dev
COPY shared ./shared

# service build
FROM base
WORKDIR /app/back/notification-service
COPY notification-service/package*.json ./
COPY notification-service/src ./src

ENV NODE_PATH=/app/back/node_modules
EXPOSE 4004
CMD ["npm", "start"]