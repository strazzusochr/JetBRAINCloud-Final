# 🌌 JetBRAIN: Zero-Footprint AAA Cloud Engine

Welcome to the **JetBRAIN Cloud** repository. This project is a cutting-edge 3D web application designed to run entirely in the cloud with **zero local hardware footprint** (No local WebGL/GPU usage).

---

## 🏗️ Project Architecture & Concept

- **Frontend**: A high-performance React application utilizing **Three.js** for 3D rendering.
- **Backend (Stream Server)**: A Node.js environment that launches a headless Chromium instance via **Puppeteer**.
- **The Magic**: The game is rendered on the server. A high-speed **CDP (Chrome DevTools Protocol) Screencast** captures the frames at up to 60 FPS and streams them via **Socket.IO** to the client's `<canvas>`.
- **AAA Graphics**: Optimized for 1080p60 streaming with server-side EGL/Hardware acceleration.

---

## 📂 Folder Structure

- **`/server`**: Contains `stream-server.mjs`. This is the core engine that manages the browser instance and video streaming.
- **`/projects/3d-ki-game-cloud`**: The main frontend React/Vite project.
  - `/src`: Components (`HUD.tsx`, `GameCanvas.tsx`), Systems, and Stores (`gameStore.ts`).
  - `/public`: Static assets including proxy compatibility patches (`theme.css`, `index.css`).
- **`/.devcontainer`**: Crucial Docker infrastructure. Pre-installs 40+ Linux libraries required for headless Chromium.

---

## 🛠️ Tech Stack

- **Core**: TypeScript, React, Vite.
- **3D**: Three.js (Procedural Mesh System, LOD Management).
- **Socket**: Socket.IO (Low-latency frame & input transmission).
- **Automation**: Puppeteer (Headless Browser Management).
- **Styling**: Vanilla CSS (Modern Aesthetics).

---

## 🚀 How to Start

### 1. In Codeanywhere (Recommended)
The project includes a **Dev Container**. 
- Simply open the repository and select **"Rebuild and Reopen in Container"**.
- All dependencies (Chromium, Node, Libs) will be installed automatically.

### 2. Manual Start
```bash
# Terminal 1: Frontend
cd projects/3d-ki-game-cloud
npm install
npm run dev

# Terminal 2: Stream Server (The Engine)
node server/stream-server.mjs
```

---

## ⚠️ Known Issues & Fixes (For the incoming Coder)

- **400 Bad Request**: Fixed by adding placeholder `theme.css` and `index.css` in `/public`.
- **HMR Blocking**: Proxy settings in `vite.config.ts` are set to `allowedHosts: true` and `clientPort: 443`.
- **Missing Libs**: Dockerfile in `.devcontainer` handles `libatk`, `libgbm`, etc.

---

**Mission Goal:** Maintain 1080p60 FPS with < 50ms latency for a true AAA experience.
