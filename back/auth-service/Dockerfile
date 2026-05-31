# Step 1: Build NestJS application
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package definitions and shared folder
COPY package*.json ./
COPY auth-service/package*.json ./auth-service/
COPY shared ./shared

# Install all dependencies (including devDependencies) to enable build
RUN npm install

# Copy auth-service source code
COPY auth-service ./auth-service

# Build NestJS
WORKDIR /app/auth-service
RUN npm run build

# Step 2: Production run stage
FROM node:20-alpine
WORKDIR /app/auth-service

# Copy package.json and install only production dependencies
COPY auth-service/package*.json ./
RUN npm install --omit=dev

# Copy compiled code from builder stage
COPY --from=builder /app/auth-service/dist ./dist

EXPOSE 4001
CMD ["npm", "run", "start:prod"]