# ============================================================================
# ARC Business Suite — Frontend (React + Nginx)
# Multi-stage build: build React → serve via nginx with /api reverse-proxy
# ============================================================================

# ---- Stage 1: Build React ----
FROM node:20-alpine AS build

WORKDIR /app

# Build-time env vars (passed via docker-compose build args)
ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}

# Install deps (cache layer)
# Copy package.json wajib; yarn.lock optional (kalau ada → reproducible install)
COPY package.json ./
COPY yarn.lock* ./
RUN if [ -f yarn.lock ]; then \
      yarn install --frozen-lockfile --network-timeout 600000; \
    else \
      yarn install --network-timeout 600000; \
    fi

# Build
COPY . .
RUN yarn build

# ---- Stage 2: Serve via Nginx ----
FROM nginx:1.27-alpine

# Copy built static files
COPY --from=build /app/build /usr/share/nginx/html

# Custom nginx config (SPA routing + /api reverse proxy + gzip)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Non-root nginx already configured in base image
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost/ > /dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
