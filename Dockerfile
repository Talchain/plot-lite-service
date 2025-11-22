# syntax=docker/dockerfile:1
FROM node:20-slim

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json package-lock.json* .npmrc* ./
RUN npm ci --no-audit --no-fund

# Copy the rest
COPY . .

RUN npm run build

# Create non-root user and set ownership
RUN groupadd -r appgroup && useradd -r -g appgroup appuser && \
    chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

EXPOSE 4311
CMD ["npm", "start"]