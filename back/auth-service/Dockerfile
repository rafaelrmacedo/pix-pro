FROM node:20-alpine AS base
WORKDIR /app/back
COPY package*.json ./
RUN npm install --omit=dev
COPY shared ./shared

FROM base
WORKDIR /app/back/auth-service
COPY auth-service/package*.json ./
COPY auth-service/src ./src

EXPOSE 4001
CMD ["npm", "run", "start:prod"]