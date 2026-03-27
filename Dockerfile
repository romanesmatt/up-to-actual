# ── Stage 1: Install dependencies ─────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production --ignore-scripts=false

# ── Stage 2: Runtime ──────────────────────────────────────────
FROM node:22-alpine

LABEL maintainer="Matt Romanes"
LABEL description="Up Bank → Actual Budget transaction sync"

WORKDIR /app

# Copy application code and production dependencies
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/

# Create data directory for Actual Budget cache
RUN mkdir -p /app/actual-data

# Install crontab — runs sync daily at 2am (container timezone)
# Cron output is redirected to /proc/1/fd/1 (Docker stdout)
RUN echo '0 2 * * * cd /app && /usr/local/bin/node src/index.js >> /proc/1/fd/1 2>> /proc/1/fd/2' > /etc/crontabs/root

# Health check — validates config and API connectivity
HEALTHCHECK --interval=6h --timeout=30s --start-period=10s --retries=2 \
  CMD node src/healthcheck.js

# Default environment
ENV NODE_ENV=production
ENV ACTUAL_DATA_DIR=/app/actual-data

# Start crond in the foreground
CMD ["crond", "-f", "-l", "2"]
