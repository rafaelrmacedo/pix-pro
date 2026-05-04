# base build
FROM node:20-alpine AS base
WORKDIR /app/back
COPY package*.json ./
RUN npm install --omit=dev
COPY shared ./shared

# service build
FROM base
WORKDIR /app/back/api-gateway
COPY api-gateway/package*.json ./
COPY api-gateway/src ./src

EXPOSE 4000
CMD ["npm", "start"]
