import { spawn } from 'node:child_process';
import { resolvePorts, applyResolvedPorts } from './port-check.mjs';

function fail(message) {
  console.error(`RUN_STREAM_SECURE_FAIL: ${message}`);
  process.exit(1);
}

async function main() {
  const profileArg = process.argv.find((arg) => arg.startsWith('--profile='));
  const profile = profileArg ? profileArg.slice('--profile='.length) : 'low';

  const childEnv = { ...process.env };
  const resolved = await resolvePorts('stream', childEnv);
  applyResolvedPorts(childEnv, resolved);

  console.log(`RUN_STREAM_SECURE_PORTS stream=${childEnv.PORT} ws=${childEnv.SOCKET_PORT} internal=${childEnv.INTERNAL_PORT}`);

  const child = spawn('node', ['server/stream-server.mjs', `--profile=${profile}`], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
    env: childEnv,
  });

  child.once('error', (error) => fail(error.message));
  child.once('exit', (code) => process.exit(code ?? 0));
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
