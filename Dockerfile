# ══════════════════════════════════════════════════════════════
# ☁️ JETBRAIN CLOUD GAMING — ZERO LOCAL FOOTPRINT
# Puppeteer + Chromium rendert Three.js auf dem Server
# Video wird per WebRTC an den Browser gestreamt
# ══════════════════════════════════════════════════════════════

# ---- Builder: Build Frontend Assets ----
FROM node:18-slim AS builder

WORKDIR /app

# Dependencies cachen
COPY package*.json ./
RUN npm ci --prefer-offline || npm install

COPY . .

# dist bereinigen
RUN rm -rf dist dist/assets

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=4096"

RUN npm run build

# ════════════════════════════════════════════════════════════
# Runtime: Node.js + Chromium für Cloud-Rendering
# ════════════════════════════════════════════════════════════
FROM node:18-slim AS runner

# Chromium-Dependencies für Puppeteer installieren
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    libasound2 \
    libpangocairo-1.0-0 \
    libxshmfence1 \
    libgles2 \
    libegl1 \
    libvulkan1 \
    mesa-vulkan-drivers \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV PORT=7860
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV STREAM_PROFILE=aaa
ENV HEADLESS_MODE=new
ENV RENDER_BACKEND=software
EXPOSE 7860

# Relevante Dateien kopieren
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/server ./server

# Hugging Face Spaces unterstützen nonroot Users
USER node

# ☁️ Start Cloud-Gaming-Server (stream-server.mjs mit Puppeteer)
CMD ["node", "server/stream-server.mjs"]
