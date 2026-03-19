# ══════════════════════════════════════════════════════════════
# ☁️ JETBRAIN CLOUD GAMING — ZERO LOCAL FOOTPRINT
# Puppeteer + Chromium rendert Three.js auf dem Server
# Video wird per Socket.IO JPEG-Stream an den Browser gestreamt
# ══════════════════════════════════════════════════════════════

# ---- Builder: Build Frontend Assets ----
FROM node:25-bookworm-slim AS builder

WORKDIR /app

# Dependencies cachen
COPY package*.json ./
RUN npm ci --prefer-offline || npm install

COPY . .

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=4096"

RUN npm run build

# ════════════════════════════════════════════════════════════
# Runtime: CPU + SwiftShader (WebGL via Software)
# Modern Node 22 environment for better security and performance.
# ════════════════════════════════════════════════════════════
FROM node:25-bookworm-slim AS runner

# Chromium + X11 Dependencies für Headless Rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libasound2 \
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
    libxshmfence1 \
    libpangocairo-1.0-0 \
    libegl1-mesa \
    libgles2-mesa \
    libvulkan1 \
    xvfb \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV PORT=3000
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# ⚡ Auto-Scaling Backend (GPU if available, else SwiftShader)
ENV RENDER_BACKEND=auto
ENV STREAM_PROFILE=aaa
ENV HEADLESS_MODE=new

EXPOSE 3000

# Relevante Dateien kopieren
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/server ./server

# Standard non-root user (node user from official image)
RUN chown -R node:node /app
USER node

# ☁️ Start: xvfb für virtuelles Display + SwiftShader WebGL
CMD ["xvfb-run", "--server-args=-screen 0 1920x1080x24 -ac", "node", "server/stream-server.mjs"]
