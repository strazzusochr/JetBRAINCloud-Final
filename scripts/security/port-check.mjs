import net from 'node:net';

const FALLBACK_MIN = 3000;
const FALLBACK_MAX = 3010;
const fallbackRange = Array.from({ length: FALLBACK_MAX - FALLBACK_MIN + 1 }, (_, i) => FALLBACK_MIN + i);

function getRequestedPorts(env = process.env) {
  return {
    DEV_PORT: Number(env.DEV_PORT || env.VITE_PORT || 3001),
    STREAM_PORT: Number(env.STREAM_PORT || env.PORT || 7860),
    WS_PORT: Number(env.WS_PORT || env.SOCKET_PORT || 3000),
    AUTONOMY_PORT: Number(env.AUTONOMY_PORT || env.INTERNAL_PORT || 3099),
  };
}

function keysForMode(selectedMode) {
  if (selectedMode === 'stream') return ['STREAM_PORT', 'WS_PORT', 'AUTONOMY_PORT'];
  if (selectedMode === 'autonomy') return ['STREAM_PORT', 'AUTONOMY_PORT'];
  return ['DEV_PORT', 'STREAM_PORT', 'WS_PORT', 'AUTONOMY_PORT'];
}

function isPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function isFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function resolvePort(preferred, reserved) {
  if (!reserved.has(preferred) && await isFree(preferred)) return preferred;
  for (const candidate of fallbackRange) {
    if (reserved.has(candidate)) continue;
    if (await isFree(candidate)) return candidate;
  }
  throw new Error(`Kein freier Port im Fallback-Bereich ${FALLBACK_MIN}-${FALLBACK_MAX}`);
}

export async function resolvePorts(mode = 'all', env = process.env) {
  const keys = keysForMode(String(mode).toLowerCase());
  const requested = getRequestedPorts(env);
  const resolved = {};
  const reserved = new Set();

  for (const key of keys) {
    const preferred = requested[key];
    if (!isPort(preferred)) {
      throw new Error(`${key} ist ungueltig: ${preferred}`);
    }
    resolved[key] = await resolvePort(preferred, reserved);
    reserved.add(resolved[key]);
  }

  return resolved;
}

export function applyResolvedPorts(targetEnv, resolved) {
  for (const [key, value] of Object.entries(resolved)) {
    if (key === 'DEV_PORT') targetEnv.DEV_PORT = String(value);
    if (key === 'STREAM_PORT') targetEnv.STREAM_PORT = String(value);
    if (key === 'WS_PORT') targetEnv.WS_PORT = String(value);
    if (key === 'AUTONOMY_PORT') targetEnv.AUTONOMY_PORT = String(value);

    // Kompatibilitaetsmapping fuer bestehende Skripte
    if (key === 'DEV_PORT') targetEnv.VITE_PORT = String(value);
    if (key === 'STREAM_PORT') targetEnv.PORT = String(value);
    if (key === 'WS_PORT') targetEnv.SOCKET_PORT = String(value);
    if (key === 'AUTONOMY_PORT') targetEnv.INTERNAL_PORT = String(value);
  }
}

async function main() {
  const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
  const mode = (modeArg ? modeArg.slice('--mode='.length) : 'all').toLowerCase();
  const resolved = await resolvePorts(mode, process.env);
  applyResolvedPorts(process.env, resolved);

  for (const [key, value] of Object.entries(resolved)) {
    console.log(`${key}=${value}`);
  }

  console.log(`PORT_CHECK_OK mode=${mode}`);
}

if ((process.argv[1] || '').toLowerCase().endsWith('port-check.mjs')) {
  main().catch((error) => {
    console.error(`PORT_CHECK_FAIL: ${error.message}`);
    process.exit(1);
  });
}
