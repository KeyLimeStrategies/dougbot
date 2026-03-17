FROM node:20-alpine

# Install dependencies for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Create data directory for SQLite (Railway volume mounts here)
RUN mkdir -p /data && chmod 777 /data

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_DIR=/data

EXPOSE 3000

CMD ["npm", "start"]
