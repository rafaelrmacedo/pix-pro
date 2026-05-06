FROM node:20-alpine AS base
WORKDIR /app/back
COPY package*.json ./
RUN npm install --omit=dev
COPY shared ./shared

FROM base
WORKDIR /app/back/project-service
COPY project-service/package*.json ./
COPY project-service/src ./src

ENV NODE_PATH=/app/back/node_modules
EXPOSE 4003
CMD ["npm", "start"]

