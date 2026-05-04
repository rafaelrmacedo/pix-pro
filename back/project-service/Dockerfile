# base build
FROM node:20-alpine AS base
WORKDIR /app/back
COPY package*.json ./
RUN npm install --omit=dev
COPY shared ./shared

# service build
FROM base
WORKDIR /app/back/project-service
COPY project-service/package*.json ./
COPY project-service/src ./src

EXPOSE 4003
CMD ["npm", "start"]
