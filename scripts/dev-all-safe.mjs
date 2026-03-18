import { spawn } from 'node:child_process';
import { resolvePorts, applyResolvedPorts } from './security/port-check.mjs';

function forward(name, stream, colorCode) {
  stream.on('data', (chunk) => {
    const lines = String(chunk).split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      process.stdout.write(`\u001b[${colorCode}m[${name}]\u001b[0m ${line}\n`);
    }
  });
}

async function main() {
  const resolved = await resolvePorts('all', process.env);
  applyResolvedPorts(process.env, resolved);

  const devPort = process.env.VITE_PORT || process.env.DEV_PORT || '5173';
  const socketPort = process.env.SOCKET_PORT || process.env.WS_PORT || '3000';

  console.log(`DEV_ALL_SAFE_PORTS dev=${devPort} socket=${socketPort}`);

  const vite = spawn('npm', ['run', 'dev'], {
    shell: true,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const socket = spawn('node', ['server/server.js'], {
    shell: true,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  forward('vite', vite.stdout, '36');
  forward('vite', vite.stderr, '36');
  forward('socket', socket.stdout, '33');
  forward('socket', socket.stderr, '33');

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    vite.kill();
    socket.kill();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const onExit = (name, code) => {
    if (shuttingDown) return;
    if (code && code !== 0) {
      console.error(`DEV_ALL_SAFE_FAIL ${name} exited with code=${code}`);
    } else {
      console.log(`DEV_ALL_SAFE_STOP ${name} exited`);
    }
    shutdown();
    process.exit(code ?? 0);
  };

  vite.on('exit', (code) => onExit('vite', code));
  socket.on('exit', (code) => onExit('socket', code));
}

main().catch((error) => {
  console.error(`DEV_ALL_SAFE_FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
