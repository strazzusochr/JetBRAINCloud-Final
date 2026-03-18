/**
 * 🔴 CLOUD-RENDERING SERVER V2 — ZERO LOCAL LOAD — HIGH PERFORMANCE
 * 
 * Optimized for smooth gameplay:
 *   - WebSocket binary frames (lower latency than MJPEG HTTP)
 *   - Reduced viewport (960x540) for faster captures
 *   - Aggressive JPEG compression (quality 35)
 *   - Double-buffered capture (capture next while sending current)
 *   - MJPEG fallback for initial load
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

function parseAllowedOrigins(raw) {
  return String(raw || 'http://127.0.0.1:3001,http://localhost:3001,http://127.0.0.1:7860,http://localhost:7860,https://wrzzzrzr-jetbrain.hf.space,https://huggingface.co')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const WS_SHARED_TOKEN = String(process.env.WS_SHARED_TOKEN || '');
const API_ADMIN_TOKEN = String(process.env.API_ADMIN_TOKEN || '');
const NO_REMOTE_COMPUTE = String(process.env.NO_REMOTE_COMPUTE || 'true').toLowerCase() === 'true';
const ALLOWED_COMPUTE_HOSTS = new Set(
  String(process.env.ALLOWED_COMPUTE_HOSTS || '127.0.0.1,localhost')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  // In Docker/HF: viewer is served from same origin — always allow
  if (origin.includes('huggingface.co') || origin.includes('.hf.space')) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('origin_denied'));
    },
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 5e6 // 5MB for binary frames
});

// ─── Internal static server for Puppeteer ───
const internalApp = express();
const internalServer = createServer(internalApp);
internalApp.use(express.static(path.join(__dirname, '../dist')));
internalApp.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

const STREAM_PROFILES = {
  low: { width: 960, height: 540, jpegQuality: 35, fps: 24 },
  medium: { width: 1280, height: 720, jpegQuality: 60, fps: 30 },
  high: { width: 1600, height: 900, jpegQuality: 75, fps: 45 },
  aaa: { width: 1920, height: 1080, jpegQuality: 85, fps: 60 },
};

function getArgValue(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

const selectedProfileKey = String(
  getArgValue('profile') || process.env.STREAM_PROFILE || 'low'
).toLowerCase();
let currentProfileKey = STREAM_PROFILES[selectedProfileKey] ? selectedProfileKey : 'low';

const INTERNAL_PORT_REQUESTED = Number(process.env.INTERNAL_PORT) || 3099;
let internalPort = INTERNAL_PORT_REQUESTED;
const PUBLIC_PORT = process.env.PORT || 7860;
const RENDER_BACKEND = String(process.env.RENDER_BACKEND || 'hardware').toLowerCase();
const HEADLESS_MODE = String(
  process.env.HEADLESS_MODE || 'new'
).toLowerCase();
const FALLBACK_BRAVE_PATH_WIN = 'C:\\Program Files\\BraveSoftware\\Brave-Browser-Nightly\\Application\\brave.exe';

if (NO_REMOTE_COMPUTE) {
  const targetHost = String(process.env.RENDER_TARGET_HOST || 'localhost').trim();
  if (!ALLOWED_COMPUTE_HOSTS.has(targetHost)) {
    throw new Error(`NO_REMOTE_COMPUTE verletzt: ${targetHost} ist nicht erlaubt`);
  }
}

const endpointWindowMs = Number(process.env.API_RATE_WINDOW_MS || 10_000);
const endpointMaxRequests = Number(process.env.API_RATE_MAX_REQUESTS || 30);
const endpointBuckets = new Map();

function allowEndpointRequest(key) {
  const now = Date.now();
  const bucket = endpointBuckets.get(key) || { count: 0, ts: now };
  if (now - bucket.ts > endpointWindowMs) {
    bucket.count = 0;
    bucket.ts = now;
  }
  bucket.count += 1;
  endpointBuckets.set(key, bucket);
  return bucket.count <= endpointMaxRequests;
}

function requireAdminToken(req, res) {
  if (!API_ADMIN_TOKEN) return true;
  const token = req.headers['x-admin-token'];
  if (token !== API_ADMIN_TOKEN) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }
  return true;
}

function resolveBrowserExecutablePath() {
  const fromEnv = process.env.BROWSER_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  if (process.platform === 'win32' && fs.existsSync(FALLBACK_BRAVE_PATH_WIN)) {
    return FALLBACK_BRAVE_PATH_WIN;
  }

  return undefined;
}

function getHeadlessOption() {
  if (HEADLESS_MODE === 'false' || HEADLESS_MODE === '0' || HEADLESS_MODE === 'off') return false;
  if (HEADLESS_MODE === 'true' || HEADLESS_MODE === '1' || HEADLESS_MODE === 'on') return true;
  return 'new';
}

function getStreamSettings() {
  const profile = STREAM_PROFILES[currentProfileKey] || STREAM_PROFILES.low;
  const width = Number(process.env.STREAM_WIDTH || profile.width);
  const height = Number(process.env.STREAM_HEIGHT || profile.height);
  const jpegQuality = Number(process.env.STREAM_JPEG_QUALITY || profile.jpegQuality);
  const fps = Number(process.env.STREAM_FPS || profile.fps);
  const frameInterval = Math.floor(1000 / fps);
  return { profileKey: currentProfileKey, width, height, jpegQuality, fps, frameInterval };
}

function getChromiumArgs(settings) {
  const commonArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--enable-usermedia-screen-capturing',
    '--allow-http-screen-capture',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-extensions',
    '--disable-default-apps',
    '--no-first-run',
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
    '--disable-features=UseEcoQoSForBackgroundProcess',
    `--window-size=${settings.width},${settings.height}`,
    '--hide-scrollbars'
  ];

  if (RENDER_BACKEND === 'software') {
    return [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--disable-gpu',
      ...commonArgs
    ];
  }

  // Hardware first: required for realistic 1080p60 targets.
  return [
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--use-angle=d3d11',
    ...commonArgs
  ];
}

let page = null;
let browser = null;
let isStreaming = false;
let frameCount = 0;
let lastFpsTime = Date.now();
let currentFps = 0;
let internalServerStarted = false;
let captureTimeout = null;
let isSwitchingProfile = false;
let captureGeneration = 0;
let rendererSocketId = null;
let rendererTransportSource = 'none';
const viewerSocketIds = new Set();
let latestHudState = null;
const transportMetrics = {
  rendererFps: 0,
  viewerFps: 0,
  width: 0,
  height: 0,
  updatedAt: 0,
};

// ─── MJPEG fallback for <img> tag ───
const mjpegClients = new Set();

app.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  mjpegClients.add(res);
  req.on('close', () => mjpegClients.delete(res));
});

// ─── Serve lightweight client ───
app.get('/', (req, res) => {
  res.send(getClientHTML());
});

app.get('/health', (req, res) => {
  const settings = getStreamSettings();
  res.json({
    status: 'ok',
    fps: transportMetrics.viewerFps || transportMetrics.rendererFps || currentFps,
    rendererFps: transportMetrics.rendererFps,
    viewerFps: transportMetrics.viewerFps,
    clients: viewerSocketIds.size,
    profile: settings.profileKey,
    width: settings.width,
    height: settings.height,
    transportSource: rendererTransportSource,
    internalPort,
    publicPort: PUBLIC_PORT,
  });
});

app.post('/api/profile/:profile', async (req, res) => {
  const sourceIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (!allowEndpointRequest(`profile:${sourceIp}`)) {
    res.status(429).json({ ok: false, error: 'rate_limited' });
    return;
  }
  if (!requireAdminToken(req, res)) return;

  const requested = String(req.params.profile || '').toLowerCase();
  if (!STREAM_PROFILES[requested]) {
    res.status(400).json({ ok: false, error: 'Unknown profile', allowed: Object.keys(STREAM_PROFILES) });
    return;
  }
  if (isSwitchingProfile) {
    res.status(409).json({ ok: false, error: 'Profile switch already in progress' });
    return;
  }

  try {
    isSwitchingProfile = true;
    await switchProfile(requested);
    const settings = getStreamSettings();
    res.json({ ok: true, profile: settings.profileKey, width: settings.width, height: settings.height, fps: settings.fps });
  } catch (error) {
    console.error('❌ Profile switch failed:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Failed to switch profile' });
  } finally {
    isSwitchingProfile = false;
  }
});

// ─── WebSocket: frames OUT, input IN ───
io.on('connection', (socket) => {
  const socketOrigin = String(socket.handshake.headers.origin || '');
  if (!isAllowedOrigin(socketOrigin)) {
    socket.disconnect(true);
    return;
  }

  if (WS_SHARED_TOKEN) {
    const token = String(socket.handshake.auth?.token || '');
    if (token !== WS_SHARED_TOKEN) {
      socket.disconnect(true);
      return;
    }
  }

  const wsWindowMs = Number(process.env.WS_RATE_WINDOW_MS || 10_000);
  const wsMaxEvents = Number(process.env.WS_RATE_MAX_EVENTS || 300);
  let wsCount = 0;
  let wsWindowStart = Date.now();

  socket.onAny(() => {
    const now = Date.now();
    if (now - wsWindowStart > wsWindowMs) {
      wsCount = 0;
      wsWindowStart = now;
    }
    wsCount += 1;
    if (wsCount > wsMaxEvents) {
      socket.disconnect(true);
    }
  });

  console.log('🎮 Client connected:', socket.id);

  socket.on('register-role', (payload = {}) => {
    const role = payload.role === 'renderer' ? 'renderer' : 'viewer';
    socket.data.role = role;
    console.log(`[SOCKET] register-role received:`, role, 'socket.id:', socket.id);

    if (role === 'renderer') {
      rendererSocketId = socket.id;
      rendererTransportSource = payload.transportSource || 'canvas';
      console.log(`🛰️ Renderer registered: ${socket.id} (${rendererTransportSource})`);
      io.emit('renderer-ready', {
        rendererId: rendererSocketId,
        transportSource: rendererTransportSource,
        profile: getStreamSettings().profileKey,
      });
      if (latestHudState) {
        socket.emit('hud-state', latestHudState);
      }
      return;
    }

    viewerSocketIds.add(socket.id);
    console.log(`[SOCKET] viewerSocketIds after add:`, Array.from(viewerSocketIds));
    if (rendererSocketId) {
      socket.emit('renderer-ready', {
        rendererId: rendererSocketId,
        transportSource: rendererTransportSource,
        profile: getStreamSettings().profileKey,
      });
    }
    if (latestHudState) {
      socket.emit('hud-state', latestHudState);
    }
  });

  socket.on('webrtc-signal', ({ targetId, payload } = {}) => {
    if (!targetId || !payload) return;
    io.to(targetId).emit('webrtc-signal', {
      fromId: socket.id,
      payload,
    });
  });

  socket.on('renderer-stats', (stats = {}) => {
    if (socket.id !== rendererSocketId) return;
    if (typeof stats.fps === 'number' && Number.isFinite(stats.fps)) {
      transportMetrics.rendererFps = Math.max(0, Math.round(stats.fps));
      currentFps = transportMetrics.rendererFps;
    }
    if (typeof stats.width === 'number' && Number.isFinite(stats.width)) transportMetrics.width = Math.round(stats.width);
    if (typeof stats.height === 'number' && Number.isFinite(stats.height)) transportMetrics.height = Math.round(stats.height);
    transportMetrics.updatedAt = Date.now();
    io.emit('transport-metrics', {
      rendererFps: transportMetrics.rendererFps,
      viewerFps: transportMetrics.viewerFps,
      width: transportMetrics.width,
      height: transportMetrics.height,
      transportSource: rendererTransportSource,
    });
  });

  socket.on('viewer-stats', (stats = {}) => {
    console.log(`[SOCKET] viewer-stats received:`, stats, 'socket.id:', socket.id, 'viewerSocketIds:', Array.from(viewerSocketIds));
    if (!viewerSocketIds.has(socket.id)) {
      console.log(`[SOCKET] viewer-stats ignored, socket.id not in viewerSocketIds`);
      return;
    }
    if (typeof stats.fps === 'number' && Number.isFinite(stats.fps)) {
      transportMetrics.viewerFps = Math.max(0, Math.round(stats.fps));
      currentFps = transportMetrics.viewerFps || transportMetrics.rendererFps;
    }
    transportMetrics.updatedAt = Date.now();
    io.emit('transport-metrics', {
      rendererFps: transportMetrics.rendererFps,
      viewerFps: transportMetrics.viewerFps,
      width: transportMetrics.width,
      height: transportMetrics.height,
      transportSource: rendererTransportSource,
    });
  });

  socket.on('hud-state', (payload) => {
    if (socket.id !== rendererSocketId || !payload) return;
    latestHudState = payload;
    socket.broadcast.emit('hud-state', payload);
  });

  socket.on('hud-command', (payload = {}) => {
    if (!rendererSocketId) return;
    io.to(rendererSocketId).emit('hud-command', payload);
  });

  socket.on('time-command', (payload = {}) => {
    if (!rendererSocketId) return;
    io.to(rendererSocketId).emit('time-command', payload);
  });

  socket.on('keydown', async (data) => {
    if (!page) return;
    try { await page.keyboard.down(data.key); } catch(e) {}
  });

  socket.on('keyup', async (data) => {
    if (!page) return;
    try { await page.keyboard.up(data.key); } catch(e) {}
  });

  socket.on('mousemove', async (data) => {
    if (!page) return;
    try { await page.mouse.move(data.x, data.y); } catch(e) {}
  });

  socket.on('mousedown', async (data) => {
    if (!page) return;
    try { await page.mouse.down({ button: data.button || 'left' }); } catch(e) {}
  });

  socket.on('mouseup', async (data) => {
    if (!page) return;
    try { await page.mouse.up({ button: data.button || 'left' }); } catch(e) {}
  });

  socket.on('click', async (data) => {
    if (!page) return;
    try { await page.mouse.click(data.x, data.y); } catch(e) {}
  });

  socket.on('disconnect', () => {
    viewerSocketIds.delete(socket.id);
    console.log(`[SOCKET] viewerSocketIds after delete:`, Array.from(viewerSocketIds));
    if (socket.id === rendererSocketId) {
      rendererSocketId = null;
      rendererTransportSource = 'none';
      latestHudState = null;
      transportMetrics.rendererFps = 0;
      io.emit('renderer-stopped');
    } else if (rendererSocketId) {
      io.to(rendererSocketId).emit('viewer-disconnected', { viewerId: socket.id });
    }
    console.log('🎮 Client disconnected:', socket.id);
  });
});

// ─── Optimized frame capture ───
async function captureLoop(generation) {
  if (generation !== captureGeneration) return;
  if (!page || !isStreaming) return;
  const settings = getStreamSettings();

  const startTime = Date.now();

  try {
    const screenshot = await page.screenshot({
      type: 'jpeg',
      quality: settings.jpegQuality,
      encoding: 'binary',
      optimizeForSpeed: true
    });

    // Send via WebSocket (binary, low latency)
    io.volatile.emit('frame', screenshot);

    // MJPEG fallback
    for (const client of mjpegClients) {
      try {
        client.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${screenshot.length}\r\n\r\n`);
        client.write(screenshot);
        client.write('\r\n');
      } catch (e) { mjpegClients.delete(client); }
    }

    // FPS counter
    frameCount++;
    const now = Date.now();
    if (now - lastFpsTime >= 1000) {
      currentFps = frameCount;
      frameCount = 0;
      lastFpsTime = now;
    }
  } catch (e) {
    const message = String(e?.message || e);
    if (!/Session closed|Target closed/i.test(message)) {
      console.error('Capture error:', message);
    }
  }

  // Dynamic interval: compensate for capture time
  const elapsed = Date.now() - startTime;
  const nextDelay = Math.max(1, settings.frameInterval - elapsed);
  captureTimeout = setTimeout(() => captureLoop(generation), nextDelay);
}

async function ensureInternalServer() {
  if (internalServerStarted) return;
  await new Promise((resolve) => {
    internalServer.listen(INTERNAL_PORT_REQUESTED, '127.0.0.1', () => {
      const addr = internalServer.address();
      if (addr && typeof addr === 'object' && addr.port) {
        internalPort = addr.port;
      }
      console.log(`📦 Internal app on :${internalPort}`);
      internalServerStarted = true;
      resolve();
    });
  });
}

async function stopCloudRenderer() {
  captureGeneration += 1;
  isStreaming = false;
  if (captureTimeout) {
    clearTimeout(captureTimeout);
    captureTimeout = null;
  }

  if (page) {
    try {
      await page.close();
    } catch (error) {
      console.warn('⚠️ page.close failed:', error?.message || error);
    }
    page = null;
  }

  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      console.warn('⚠️ browser.close failed:', error?.message || error);
    }
    browser = null;
  }
}

async function bootstrapRendererTransport(settings) {
  const publicOrigin = `http://127.0.0.1:${PUBLIC_PORT}`;
  const result = await page.evaluate(async ({ publicOrigin, fps }) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    async function ensureSocketIoClient() {
      if (window.io) return;
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${publicOrigin}/socket.io/socket.io.js`;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    async function waitForBestCanvas(timeoutMs = 30000) {
      const start = performance.now();
      while (performance.now() - start < timeoutMs) {
        const canvases = Array.from(document.querySelectorAll('canvas'));
        const best = canvases
          .filter((canvas) => canvas.width > 0 && canvas.height > 0)
          .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
        if (best) return best;
        await wait(200);
      }
      throw new Error('No captureable canvas found');
    }

    function getStore() {
      return window.__GAME_STORE__;
    }

    function timeToMinutes(value) {
      const [hours, minutes] = String(value || '00:00').split(':').map(Number);
      return (hours * 60) + minutes;
    }

    function buildHudState() {
      const store = getStore();
      const state = store?.getState?.();
      const timeline = window.__EVENT_TIMELINE__ || [];
      if (!state) return null;

      const inGameTime = state.gameState.inGameTime;
      const currentMinutes = timeToMinutes(inGameTime);
      const timelineItems = timeline
        .filter((event, index, source) => event.description && index === source.findIndex((entry) => entry.time === event.time && entry.action === event.action && entry.npcType === event.npcType))
        .filter((event) => timeToMinutes(event.time) >= currentMinutes - 15)
        .sort((a, b) => {
          const aMinutes = timeToMinutes(a.time);
          const bMinutes = timeToMinutes(b.time);
          const aCurrent = aMinutes <= currentMinutes && aMinutes >= currentMinutes - 15;
          const bCurrent = bMinutes <= currentMinutes && bMinutes >= currentMinutes - 15;
          if (aCurrent && !bCurrent) return -1;
          if (!aCurrent && bCurrent) return 1;
          if (aCurrent && bCurrent) return bMinutes - aMinutes;
          return aMinutes - bMinutes;
        })
        .slice(0, 8)
        .map((event) => {
          const eventMinutes = timeToMinutes(event.time);
          const isCurrent = eventMinutes <= currentMinutes && eventMinutes >= currentMinutes - 15;
          return {
            time: event.time,
            title: `${event.action} ${event.npcType}${event.count > 0 ? ` (${event.count}x)` : ''}`,
            description: event.description.replace(/^.{5} — /, ''),
            isCurrent,
          };
        });

      return {
        inGameTime,
        isTimePaused: state.gameState.isTimePaused,
        tensionLevel: state.gameState.tensionLevel,
        timeSpeed: state.gameState.timeSpeed,
        currentPhaseLabel: state.gameState.currentPhaseLabel,
        npcCount: state.npcs.length,
        masterVolume: state.gameState.masterVolume,
        muted: state.gameState.muted,
        playerReputation: state.gameState.playerReputation,
        moralScore: state.gameState.moralScore,
        physical: 85,
        armor: 100,
        stamina: 60,
        escalation: Math.floor(state.gameState.tensionLevel / 5),
        missions: [
          { color: '#00ff88', text: 'Beobachtungsposten Nordseite erreichen (0/1)' },
          { color: '#ffcc00', text: 'Martin Krause identifizieren und die Menge filmen (0/1)' },
          { color: '#ffcc00', text: 'Situation deeskalieren oder Randalierer zerstreuen (0/5)' },
        ],
        timelineItems,
      };
    }

    async function tryTabCapture() {
      if (!navigator.mediaDevices?.getDisplayMedia) return null;
      try {
        document.title = 'Corona Control Stream Renderer';
        const media = await Promise.race([
          navigator.mediaDevices.getDisplayMedia({
            video: {
              frameRate: fps,
              width: { ideal: window.innerWidth },
              height: { ideal: window.innerHeight },
              displaySurface: 'browser',
            },
            audio: false,
            preferCurrentTab: true,
            selfBrowserSurface: 'include',
            monitorTypeSurfaces: 'exclude',
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('tab capture timeout')), 1500)),
        ]);
        return media;
      } catch (error) {
        console.warn('tab capture unavailable, falling back to canvas capture', error?.message || error);
        return null;
      }
    }

    await ensureSocketIoClient();
    const canvas = await waitForBestCanvas();
    const tabStream = await tryTabCapture();
    const stream = tabStream || canvas.captureStream(fps);
    const transportSource = tabStream ? 'tab-webrtc' : 'canvas-webrtc';
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.contentHint = 'detail';
    }

    if (window.__rendererTransport?.socket) {
      try { window.__rendererTransport.socket.disconnect(); } catch (error) {}
    }

    const socket = window.io(publicOrigin, {
      transports: ['polling', 'websocket'],
      upgrade: true,
      rememberUpgrade: false,
      reconnection: true,
      timeout: 20000,
    });
    const peers = new Map();
    let frameCount = 0;
    let lastTime = performance.now();
    let lastHudSerialized = '';

    function closePeer(viewerId) {
      const peer = peers.get(viewerId);
      if (peer) {
        try { peer.close(); } catch (error) {}
      }
      peers.delete(viewerId);
    }

    async function ensurePeer(viewerId) {
      let peer = peers.get(viewerId);
      if (peer) return peer;

      peer = new RTCPeerConnection({ iceServers: [] });
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc-signal', {
            targetId: viewerId,
            payload: { candidate: event.candidate },
          });
        }
      };
      peer.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
          closePeer(viewerId);
        }
      };
      peers.set(viewerId, peer);
      return peer;
    }

    socket.on('connect', () => {
      socket.emit('register-role', {
        role: 'renderer',
        transportSource,
      });
    });

    socket.on('webrtc-signal', async ({ fromId, payload }) => {
      if (!fromId || !payload) return;
      const peer = await ensurePeer(fromId);

      if (payload.type === 'offer') {
        await peer.setRemoteDescription(payload);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit('webrtc-signal', {
          targetId: fromId,
          payload: peer.localDescription,
        });
        return;
      }

      if (payload.type === 'answer') {
        await peer.setRemoteDescription(payload);
        return;
      }

      if (payload.candidate) {
        try {
          await peer.addIceCandidate(payload.candidate);
        } catch (error) {
          console.warn('ICE candidate rejected', error?.message || error);
        }
      }
    });

    socket.on('viewer-disconnected', ({ viewerId }) => {
      closePeer(viewerId);
    });

    socket.on('time-command', ({ action, value } = {}) => {
      const store = getStore();
      const api = store?.getState?.();
      if (!api) return;
      const commands = {
        advanceHour: api.advanceHour,
        rewindHour: api.rewindHour,
        advanceMinute: api.advanceMinute,
        rewindMinute: api.rewindMinute,
        toggleTimePause: api.toggleTimePause,
        setTimeSpeed: api.setTimeSpeed,
      };
      if (action === 'setTimeSpeed' && typeof value === 'number') {
        commands.setTimeSpeed(value);
        return;
      }
      if (commands[action]) {
        commands[action]();
      }
    });

    socket.on('hud-command', ({ action, value } = {}) => {
      const store = getStore();
      const api = store?.getState?.();
      if (!api) return;
      if (action === 'setMuted') api.setMuted(Boolean(value));
      if (action === 'setMasterVolume' && typeof value === 'number') api.setMasterVolume(value);
    });

    function tick(now) {
      frameCount += 1;
      if (now - lastTime >= 1000) {
        const hudState = buildHudState();
        if (hudState) {
          const serialized = JSON.stringify(hudState);
          if (serialized !== lastHudSerialized) {
            socket.emit('hud-state', hudState);
            lastHudSerialized = serialized;
          }
        }
        socket.emit('renderer-stats', {
          fps: frameCount,
          width: tabStream ? window.innerWidth : canvas.width,
          height: tabStream ? window.innerHeight : canvas.height,
        });
        frameCount = 0;
        lastTime = now;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    window.__rendererTransport = { socket, peers, stream };
    return {
      source: transportSource,
      width: tabStream ? window.innerWidth : canvas.width,
      height: tabStream ? window.innerHeight : canvas.height,
    };
  }, { publicOrigin, fps: settings.fps });

  rendererTransportSource = result.source;
  return result;
}

// ─── Launch Puppeteer ───
async function startCloudRenderer() {
  const settings = getStreamSettings();
  const executablePath = resolveBrowserExecutablePath();
  console.log('🚀 Starting Cloud Renderer V2 (Optimized)...');
  console.log(`🎛️ Stream profile: ${settings.profileKey}`);
  console.log(`🧠 Render backend: ${RENDER_BACKEND}`);
  console.log(`🪟 Headless mode: ${HEADLESS_MODE}`);
  if (executablePath) {
    console.log(`🌐 Browser binary: ${executablePath}`);
  } else {
    console.log('🌐 Browser binary: Puppeteer bundled Chromium');
  }
  console.log(`🖼️ Resolution: ${settings.width}x${settings.height} | JPEG: ${settings.jpegQuality} | FPS: ${settings.fps}`);
  console.log(`🔗 Client URL: http://127.0.0.1:${PUBLIC_PORT}/`);
  console.log(`🔒 Internal renderer URL (do not open manually): http://127.0.0.1:${internalPort}/`);

  await ensureInternalServer();

  browser = await puppeteer.launch({
    headless: getHeadlessOption(),
    executablePath,
    args: getChromiumArgs(settings)
  });

  page = await browser.newPage();
  await page.setViewport({ width: settings.width, height: settings.height, deviceScaleFactor: 1 });

  console.log('🌍 Loading game...');
  await page.goto(`http://127.0.0.1:${internalPort}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });

  // Wait for Three.js canvas to appear
  await page.waitForSelector('canvas', { timeout: 30000 }).catch(() => {
    console.log('⚠️ No canvas found, starting capture anyway');
  });

  const rendererInfo = await bootstrapRendererTransport(settings);
  console.log(`✅ Game loaded! Starting WebRTC stream at ${settings.fps} FPS target (${rendererInfo.source})`);
  io.emit('profile-changed', settings);
  isStreaming = true;
}

async function switchProfile(newProfile) {
  if (newProfile === currentProfileKey) {
    io.emit('profile-changed', getStreamSettings());
    return;
  }

  const previousProfile = currentProfileKey;
  console.log(`🎛️ Switching profile: ${previousProfile} -> ${newProfile}`);
  io.emit('profile-switching', { from: previousProfile, to: newProfile });
  currentProfileKey = newProfile;

  try {
    await stopCloudRenderer();
    await startCloudRenderer();
    console.log(`✅ Profile active: ${newProfile}`);
  } catch (error) {
    currentProfileKey = previousProfile;
    await stopCloudRenderer();
    await startCloudRenderer();
    throw error;
  }
}

// ─── Client HTML (WebSocket-based, much smoother) ───
function getClientHTML() {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Corona Control — Cloud Gaming</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #000;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      overflow: hidden;
      font-family: 'Segoe UI', sans-serif;
    }
    video#display {
      width: 100vw;
      height: 100vh;
      object-fit: contain;
      background: #000;
    }
    #hud {
      position: fixed;
      top: 8px;
      left: 8px;
      color: #0f0;
      font-size: 11px;
      font-family: monospace;
      background: rgba(0,0,0,0.7);
      padding: 4px 8px;
      border-radius: 3px;
      z-index: 1000;
      pointer-events: none;
    }
    #loading {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #fff;
      font-size: 20px;
      z-index: 2000;
      text-align: center;
    }
    #quality {
      position: fixed;
      right: 10px;
      top: 10px;
      z-index: 2500;
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      max-width: 380px;
      justify-content: flex-end;
    }
    .qbtn {
      border: 1px solid #2f2f2f;
      background: rgba(0, 0, 0, 0.78);
      color: #e7e7e7;
      padding: 6px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.02em;
      transition: transform 0.12s ease, border-color 0.12s ease, color 0.12s ease;
    }
    .qbtn:hover { transform: translateY(-1px); border-color: #6b6b6b; }
    .qbtn.active { color: #0f0; border-color: #0f0; }
    .qbtn:disabled { opacity: 0.55; cursor: wait; }
    #remoteHud {
      position: fixed;
      inset: 0;
      pointer-events: none;
      font-family: 'Outfit', 'Segoe UI', sans-serif;
      color: #fff;
      z-index: 1800;
    }
    #remoteHud[data-hidden="true"] { opacity: 0; }
    #hudScaler {
      position: fixed;
      left: 10px;
      top: 38px;
      z-index: 2600;
      display: flex;
      gap: 4px;
      pointer-events: auto;
    }
    .hudctl {
      border: 1px solid rgba(255,255,255,0.18);
      background: rgba(0,0,0,0.72);
      color: #d8e7ef;
      padding: 5px 8px;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
    }
    .hud-stage {
      position: absolute;
      inset: 0;
      transform-origin: top left;
      pointer-events: none;
    }
    .hud-panel {
      background: rgba(10,10,10,0.82);
      border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 10px 30px rgba(0,0,0,0.45);
      border-radius: 16px;
      backdrop-filter: blur(10px);
    }
    .hud-left { position: absolute; top: 40px; left: 40px; width: 380px; padding: 24px; }
    .hud-top { position: absolute; top: 40px; left: 50%; transform: translateX(-50%); text-align: center; }
    .hud-right { position: absolute; top: 20px; right: 20px; width: 380px; padding: 24px; background: transparent; border: none; box-shadow: none; }
    .hud-bottom { position: absolute; left: 50%; bottom: 40px; transform: translateX(-50%); display: flex; gap: 16px; align-items: center; pointer-events: none; }
    .hud-chip {
      padding: 6px 10px;
      background: rgba(0,0,0,0.45);
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      border: 1px solid rgba(255,255,255,0.12);
    }
    .status { margin-bottom: 16px; }
    .status-label { font-size: 14px; font-weight: 800; color: #ffcc00; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 6px; text-shadow: 0 1px 4px rgba(0,0,0,0.9); }
    .status-track { height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden; border: 1px solid rgba(255,255,255,0.05); }
    .status-fill { height: 100%; }
    .timeline-wrap { max-height: 260px; overflow-y: auto; padding-right: 10px; display: flex; flex-direction: column; gap: 8px; }
    .timeline-item { display: flex; gap: 12px; font-size: 14px; font-family: monospace; padding: 10px 12px; border-radius: 6px; }
    .timeline-time { font-weight: bold; min-width: 45px; }
    .timeline-desc { margin-top: 4px; font-size: 13px; font-style: italic; font-family: 'Outfit', sans-serif; }
    .control-group, .info-group, .audio-group { display: flex; align-items: center; gap: 8px; pointer-events: auto; }
    .control-group, .info-group, .audio-group { background: rgba(10,10,10,0.6); padding: 10px 16px; border-radius: 12px; backdrop-filter: blur(5px); border: 2px solid rgba(255,255,255,0.08); }
    .time-btn {
      background: rgba(10,10,10,0.6);
      border: 2px solid rgba(255,255,255,0.08);
      color: #ffcc00;
      padding: 6px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 16px;
      font-weight: bold;
      min-width: 45px;
      pointer-events: auto;
    }
    .divider { height: 36px; width: 2px; background: rgba(255,255,255,0.15); }
    .spinner {
      border: 3px solid #333;
      border-top: 3px solid #0f0;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 10px auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="hud">☁️ CLOUD GAMING | STREAM FPS: <span id="fps">--</span></div>
  <div id="quality">
    <button class="qbtn" data-profile="low">Low</button>
    <button class="qbtn" data-profile="medium">Mittel</button>
    <button class="qbtn" data-profile="high">High</button>
    <button class="qbtn" data-profile="aaa">AAA</button>
  </div>
  <div id="loading">
    <div class="spinner"></div>
    Connecting to Cloud Renderer...
  </div>
  <div id="hudScaler">
    <button class="hudctl" data-hud-scale="down">HUD-</button>
    <button class="hudctl" data-hud-scale="reset">100%</button>
    <button class="hudctl" data-hud-scale="up">HUD+</button>
  </div>
  <div id="remoteHud" data-hidden="true">
    <div class="hud-stage" id="hudStage">
      <div class="hud-panel hud-left" id="hudLeft"></div>
      <div class="hud-top" id="hudTop"></div>
      <div class="hud-right" id="hudRight"></div>
      <div class="hud-bottom" id="hudBottom"></div>
    </div>
  </div>
  <video id="display" autoplay playsinline muted></video>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const video = document.getElementById('display');
    const loading = document.getElementById('loading');
    const fpsEl = document.getElementById('fps');
    const socket = io(window.location.origin, {
      path: '/socket.io',
      transports: ['polling', 'websocket'],
      upgrade: true,
      rememberUpgrade: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 20000,
      forceNew: false,
      withCredentials: false,
    });
    const buttons = Array.from(document.querySelectorAll('.qbtn'));
    const remoteHud = document.getElementById('remoteHud');
    const hudStage = document.getElementById('hudStage');
    const hudLeft = document.getElementById('hudLeft');
    const hudTop = document.getElementById('hudTop');
    const hudRight = document.getElementById('hudRight');
    const hudBottom = document.getElementById('hudBottom');
    const hudScaleButtons = Array.from(document.querySelectorAll('[data-hud-scale]'));

    let renderWidth = 1920;
    let renderHeight = 1080;
    let activeProfile = '${currentProfileKey}';
    let switching = false;
    let rendererId = null;
    let peer = null;
    let hudState = null;
    let hudScale = Number(localStorage.getItem('remote-hud-scale')) || 1;
    let metrics = { rendererFps: 0, viewerFps: 0, transportSource: 'unknown' };
    let connectErrorCount = 0;
    let fallbackToPollingOnly = false;

    let frameCount = 0;
    let lastFpsTime = Date.now();

    function escapeHtml(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function setHudScale(nextScale) {
      hudScale = Math.max(0.6, Math.min(1.35, Number(nextScale) || 1));
      localStorage.setItem('remote-hud-scale', String(hudScale));
      hudStage.style.transform = 'scale(' + hudScale + ')';
      hudStage.style.width = (100 / hudScale) + '%';
      hudStage.style.height = (100 / hudScale) + '%';
      const resetButton = document.querySelector('[data-hud-scale="reset"]');
      if (resetButton) resetButton.textContent = Math.round(hudScale * 100) + '%';
    }

    function statusBar(label, value, color) {
      return '<div class="status">'
        + '<div class="status-label">' + escapeHtml(label) + '</div>'
        + '<div class="status-track"><div class="status-fill" style="width:' + Math.max(0, Math.min(100, Number(value) || 0)) + '%;background:' + color + ';box-shadow:0 0 10px ' + color + '"></div></div>'
        + '</div>';
    }

    function sendTimeCommand(action, value) {
      socket.emit('time-command', { action, value });
    }

    function sendHudCommand(action, value) {
      socket.emit('hud-command', { action, value });
    }

    function renderRemoteHud() {
      if (!hudState) return;
      remoteHud.dataset.hidden = 'false';

      hudLeft.innerHTML = [
        statusBar('Physische Verfassung', hudState.physical, '#ff4444'),
        statusBar('Schutzweste', hudState.armor, '#ffcc00'),
        statusBar('Ausdauer', hudState.stamina, '#00ccff'),
        '<div style="height:1px;background:rgba(255,255,255,0.1);margin:24px 0"></div>',
        statusBar('Karma / Ansehen', Math.max(0, Math.min(100, 50 + Math.round(hudState.playerReputation / 2))), '#ffaa00'),
        statusBar('Lage-Spannung', hudState.tensionLevel, '#888888'),
        statusBar('Volks-Moral', hudState.moralScore, '#ffff00'),
        statusBar('Eskalationsstufe', hudState.escalation * 5, '#ffcc00'),
      ].join('');

      hudTop.innerHTML = ''
        + '<div class="hud-panel" style="padding:8px 24px;border:2px solid #00ccff;border-radius:20px;box-shadow:0 0 20px rgba(0,204,255,0.3);margin-bottom:8px;background:rgba(10,10,10,0.9)">'
        + '<span style="color:#ffcc00;font-size:14px;font-weight:bold;text-transform:uppercase;letter-spacing:2px">LIVE <span style="color:#00ccff">REMOTE</span> HUD</span>'
        + '</div>'
        + '<div class="hud-panel" style="display:inline-block;padding:6px 16px;border-radius:12px;background:rgba(10,10,10,0.85)">'
        + '<span style="color:#88ddff;font-size:12px;font-weight:600;letter-spacing:0.5px">' + escapeHtml(hudState.currentPhaseLabel) + '</span>'
        + '</div>';

      const missions = (hudState.missions || []).map((mission) => '<li style="margin-bottom:10px;display:flex;gap:10px;align-items:flex-start"><span style="color:' + mission.color + ';margin-top:1px">●</span><span style="color:' + mission.color + '">' + escapeHtml(mission.text) + '</span></li>').join('');
      const timeline = (hudState.timelineItems || []).map((item) => {
        const color = item.isCurrent ? '#00ff88' : '#ffcc00';
        const bg = item.isCurrent ? 'rgba(0,255,136,0.15)' : 'rgba(0,0,0,0.3)';
        const border = item.isCurrent ? '#00ff88' : '#cc9900';
        const descColor = item.isCurrent ? '#fff' : '#ffcc00';
        return '<div class="timeline-item" style="background:' + bg + ';border-left:3px solid ' + border + '">'
          + '<div class="timeline-time" style="color:' + color + '">' + escapeHtml(item.time) + '</div>'
          + '<div style="flex:1"><div style="color:' + color + '">' + escapeHtml(item.title) + '</div><div class="timeline-desc" style="color:' + descColor + '">' + escapeHtml(item.description) + '</div></div>'
          + '</div>';
      }).join('');

      hudRight.innerHTML = ''
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
        + '<h3 style="margin:0;color:#00ccff;font-size:18px;text-transform:uppercase;letter-spacing:1.5px;font-weight:800">Streifen-Protokoll</h3>'
        + '<div style="display:flex;gap:8px;align-items:center">'
        + '<div class="hud-chip" style="color:#00ff88">RENDER ' + Math.round(metrics.rendererFps || 0) + ' FPS</div>'
        + '<div class="hud-chip" style="color:#00ccff">VIDEO ' + Math.round(metrics.viewerFps || 0) + ' FPS</div>'
        + '</div></div>'
        + '<ul style="list-style:none;padding:0;margin:0 0 20px 0;font-size:13px;line-height:1.6">' + missions + '</ul>'
        + '<div style="height:1px;background:rgba(255,255,255,0.2);margin-bottom:16px"></div>'
        + '<h4 style="margin:0 0 16px 0;color:#00ccff;font-size:18px;text-transform:uppercase;letter-spacing:1.5px;font-weight:800">Einsatz-Timeline</h4>'
        + '<div class="timeline-wrap">' + timeline + '</div>';

      const timeSpeed = Number(hudState.timeSpeed || 1);
      const isReverse = timeSpeed < 0;
      const absSpeed = Math.abs(timeSpeed);
      const volumePct = hudState.muted ? 0 : Math.round((hudState.masterVolume || 0) * 100);
      const speedButtons = [1,2,3,4,5,10,20].map((speed) => '<button class="time-btn" data-speed="' + speed + '">' + speed + 'x▶</button>').join('');
      const reverseButtons = [20,10,5,4,3,2,1].map((speed) => '<button class="time-btn" data-speed="-' + speed + '">◀' + speed + 'x</button>').join('');

      hudBottom.innerHTML = ''
        + '<div class="control-group">' + reverseButtons + '</div>'
        + '<div class="divider"></div>'
        + '<div class="control-group">'
        + '<button class="time-btn" data-action="rewindHour">-1H</button>'
        + '<button class="time-btn" data-action="rewindMinute">-1M</button>'
        + '<button class="time-btn" data-action="toggleTimePause">' + (hudState.isTimePaused ? '▶' : '⏸') + '</button>'
        + '<button class="time-btn" data-action="advanceMinute">+1M</button>'
        + '<button class="time-btn" data-action="advanceHour">+1H</button>'
        + '</div>'
        + '<div class="divider"></div>'
        + '<div class="control-group">' + speedButtons + '</div>'
        + '<div class="divider"></div>'
        + '<div class="info-group"><span style="color:' + (isReverse ? '#ff6666' : '#ffcc00') + ';font-size:28px;font-weight:bold;font-family:monospace">' + (isReverse ? '◀ ' : '') + escapeHtml(hudState.inGameTime) + (!isReverse ? ' ▶' : '') + '</span><span style="color:' + (isReverse ? '#ff4444' : '#00ccff') + ';font-weight:bold;font-size:20px">' + absSpeed + 'x</span></div>'
        + '<div class="divider"></div>'
        + '<div class="info-group"><span style="color:' + (hudState.tensionLevel > 70 ? '#ff4444' : hudState.tensionLevel > 40 ? '#ffaa00' : '#00ccff') + ';font-weight:bold;font-size:20px;font-family:monospace">⚡' + escapeHtml(hudState.tensionLevel) + '%</span><span style="color:#00ccff;font-weight:bold;font-size:22px">👥' + escapeHtml(hudState.npcCount) + '</span></div>'
        + '<div class="divider"></div>'
        + '<div class="audio-group"><button class="time-btn" data-audio-toggle="1">' + (hudState.muted ? '🔇' : '🔊') + '</button><input id="remoteVolume" type="range" min="0" max="100" value="' + volumePct + '" style="width:100px;height:6px;accent-color:#00ccff"><span style="color:#888;font-size:18px;font-family:monospace;min-width:40px;font-weight:bold">' + volumePct + '%</span></div>';

      hudBottom.querySelectorAll('[data-action]').forEach((button) => {
        button.onclick = () => sendTimeCommand(button.dataset.action);
      });
      hudBottom.querySelectorAll('[data-speed]').forEach((button) => {
        button.onclick = () => sendTimeCommand('setTimeSpeed', Number(button.dataset.speed));
      });
      const volume = document.getElementById('remoteVolume');
      if (volume) {
        volume.oninput = (event) => sendHudCommand('setMasterVolume', Number(event.target.value) / 100);
      }
      const toggle = hudBottom.querySelector('[data-audio-toggle]');
      if (toggle) {
        toggle.onclick = () => sendHudCommand('setMuted', !hudState.muted);
      }
    }

    function trackVideoFrames() {
      if (typeof video.requestVideoFrameCallback === 'function') {
        const loop = () => {
          frameCount++;
          video.requestVideoFrameCallback(loop);
        };
        video.requestVideoFrameCallback(loop);
        return;
      }

      video.addEventListener('timeupdate', () => {
        frameCount++;
      });
    }

    function closePeer() {
      if (peer) {
        try { peer.close(); } catch (error) {}
        peer = null;
      }
      video.srcObject = null;
    }

    async function startViewerPeer(nextRendererId) {
      if (!nextRendererId) return;
      rendererId = nextRendererId;
      closePeer();

      peer = new RTCPeerConnection({ iceServers: [] });
      peer.ontrack = (event) => {
        const [stream] = event.streams;
        if (stream) {
          video.srcObject = stream;
          video.play().catch(() => {});
          loading.style.display = 'none';
        }
      };
      peer.onicecandidate = (event) => {
        if (event.candidate && rendererId) {
          socket.emit('webrtc-signal', {
            targetId: rendererId,
            payload: { candidate: event.candidate },
          });
        }
      };
      peer.onconnectionstatechange = () => {
        if (['disconnected', 'failed', 'closed'].includes(peer.connectionState)) {
          loading.style.display = 'block';
          loading.innerHTML = '<div class="spinner"></div>Reconnecting video stream...';
        }
      };

      const offer = await peer.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: false });
      await peer.setLocalDescription(offer);
      socket.emit('webrtc-signal', {
        targetId: rendererId,
        payload: peer.localDescription,
      });
    }

    function refreshButtons() {
      buttons.forEach((btn) => {
        const isActive = btn.dataset.profile === activeProfile;
        btn.classList.toggle('active', isActive);
        btn.disabled = switching;
      });
    }

    function setProfileUi(settings) {
      if (!settings) return;
      if (typeof settings.width === 'number') renderWidth = settings.width;
      if (typeof settings.height === 'number') renderHeight = settings.height;
      if (settings.profileKey) activeProfile = settings.profileKey;
      if (settings.profile) activeProfile = settings.profile;
      refreshButtons();
    }

    async function requestProfile(profile) {
      if (switching || profile === activeProfile) return;
      switching = true;
      refreshButtons();
      loading.style.display = 'block';
      loading.innerHTML = '<div class="spinner"></div>Switching profile to ' + profile.toUpperCase() + '...';
      try {
        const resp = await fetch('/api/profile/' + profile, { method: 'POST' });
        if (!resp.ok) throw new Error('Switch request failed');
      } catch (error) {
        console.error(error);
      } finally {
        switching = false;
        refreshButtons();
      }
    }

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => requestProfile(btn.dataset.profile));
    });
    hudScaleButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.hudScale;
        if (action === 'down') setHudScale(hudScale - 0.1);
        if (action === 'up') setHudScale(hudScale + 0.1);
        if (action === 'reset') setHudScale(1);
      });
    });
    refreshButtons();
    setHudScale(hudScale);
    trackVideoFrames();

    function registerViewerRole() {
      socket.emit('register-role', { role: 'viewer' });
    }

    socket.on('connect', () => {
      connectErrorCount = 0;
      registerViewerRole();
      console.log('Connected to cloud renderer');
      if (!rendererId) {
        loading.style.display = 'block';
        loading.innerHTML = '<div class="spinner"></div>Connected. Waiting for renderer...';
      }
    });

    socket.on('renderer-ready', async ({ rendererId: nextRendererId, profile }) => {
      if (profile) {
        activeProfile = profile;
        refreshButtons();
      }
      if (nextRendererId && nextRendererId !== rendererId) {
        loading.style.display = 'block';
        loading.innerHTML = '<div class="spinner"></div>Connecting WebRTC video...';
        await startViewerPeer(nextRendererId);
      }
    });

    socket.on('renderer-stopped', () => {
      closePeer();
      loading.style.display = 'block';
      loading.innerHTML = '<div class="spinner"></div>Renderer restarting...';
      remoteHud.dataset.hidden = 'true';
    });

    socket.on('hud-state', (payload) => {
      hudState = payload;
      renderRemoteHud();
    });

    socket.on('transport-metrics', (payload = {}) => {
      metrics = {
        rendererFps: Number(payload.rendererFps) || 0,
        viewerFps: Number(payload.viewerFps) || 0,
        transportSource: payload.transportSource || 'unknown',
      };
      renderRemoteHud();
    });

    socket.on('webrtc-signal', async ({ fromId, payload }) => {
      if (!peer || fromId !== rendererId || !payload) return;

      if (payload.type === 'answer') {
        await peer.setRemoteDescription(payload);
        return;
      }

      if (payload.candidate) {
        try {
          await peer.addIceCandidate(payload.candidate);
        } catch (error) {
          console.error('ICE candidate error', error);
        }
      }
    });

    socket.on('profile-changed', (settings) => {
      setProfileUi(settings);
      loading.style.display = 'none';
    });

    socket.on('profile-switching', (payload) => {
      loading.style.display = 'block';
      loading.innerHTML = '<div class="spinner"></div>Switching to ' + String(payload?.to || '').toUpperCase() + '...';
    });

    // FPS counter
    setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastFpsTime) / 1000;
      const fps = Math.round(frameCount / elapsed);
      fpsEl.textContent = fps;
      socket.emit('viewer-stats', { fps });
      frameCount = 0;
      lastFpsTime = now;
    }, 1000);

    // Forward keyboard
    document.addEventListener('keydown', (e) => {
      e.preventDefault();
      socket.emit('keydown', { key: e.key, code: e.code });
    });
    document.addEventListener('keyup', (e) => {
      e.preventDefault();
      socket.emit('keyup', { key: e.key, code: e.code });
    });

    // Forward mouse (scaled to stream viewport)
    video.addEventListener('mousemove', (e) => {
      const rect = video.getBoundingClientRect();
      const x = Math.round((e.clientX - rect.left) / rect.width * renderWidth);
      const y = Math.round((e.clientY - rect.top) / rect.height * renderHeight);
      socket.emit('mousemove', { x, y });
    });
    video.addEventListener('mousedown', (e) => {
      const rect = video.getBoundingClientRect();
      const x = Math.round((e.clientX - rect.left) / rect.width * renderWidth);
      const y = Math.round((e.clientY - rect.top) / rect.height * renderHeight);
      socket.emit('click', { x, y });
      socket.emit('mousedown', { button: e.button === 0 ? 'left' : 'right' });
    });
    video.addEventListener('mouseup', (e) => {
      socket.emit('mouseup', { button: e.button === 0 ? 'left' : 'right' });
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // Reconnect handling
    socket.on('disconnect', (reason) => {
      loading.style.display = 'block';
      loading.innerHTML = '<div class="spinner"></div>Reconnecting... (' + String(reason || 'network') + ')';
      closePeer();
    });

    socket.on('connect_error', (error) => {
      connectErrorCount += 1;
      loading.style.display = 'block';
      loading.innerHTML = '<div class="spinner"></div>Socket reconnect fallback (polling/websocket)...';
      console.warn('Socket connect_error:', error?.message || error);

      // If websocket upgrades keep failing, force long-polling only to avoid black-screen hangs.
      if (!fallbackToPollingOnly && connectErrorCount >= 3) {
        fallbackToPollingOnly = true;
        loading.innerHTML = '<div class="spinner"></div>WebSocket blocked. Switching to polling-only...';
        try {
          socket.io.opts.transports = ['polling'];
          socket.io.opts.upgrade = false;
          socket.disconnect();
          socket.connect();
        } catch (fallbackError) {
          console.warn('Polling-only fallback failed:', fallbackError?.message || fallbackError);
        }
      }
    });
  </script>
</body>
</html>`;
}

// ─── Start ───
httpServer.listen(PUBLIC_PORT, '0.0.0.0', () => {
  console.log('🌐 Cloud Gaming Server on port', PUBLIC_PORT);
  startCloudRenderer().catch(err => {
    console.error('❌ Failed:', err);
  });
});
