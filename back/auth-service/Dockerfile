FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY auth-service/package*.json ./auth-service/
COPY shared ./shared

RUN npm install && cd auth-service && npm install

COPY auth-service ./auth-service

WORKDIR /app/auth-service
RUN npm run build

FROM node:20-alpine
WORKDIR /app/auth-service

COPY auth-service/package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/auth-service/dist ./dist

EXPOSE 4001
CMD ["npm", "run", "start:prod"]