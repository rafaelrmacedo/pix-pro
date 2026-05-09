# base build
FROM node:20-alpine AS base
WORKDIR /app/back
COPY package*.json ./
RUN npm install --omit=dev
COPY shared ./shared

# service build
FROM base
WORKDIR /app/back/image-processing-service
COPY image-processing-service/package*.json ./
RUN npm install --omit=dev
COPY image-processing-service/src ./src

ENV NODE_PATH=/app/back/node_modules
EXPOSE 4002
CMD ["npm", "start"]