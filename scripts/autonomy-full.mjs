import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { resolvePorts, applyResolvedPorts } from './security/port-check.mjs';

const rootCwd = process.cwd();

function getBaseUrl() {
  return process.env.AUTONOMY_BASE_URL || `http://127.0.0.1:${process.env.PORT || 7860}`;
}

function getHealthUrl() {
  return `${getBaseUrl()}/health`;
}

function fail(message) {
  console.error(`AUTONOMY_FULL_FAIL: ${message}`);
  process.exit(1);
}

async function runCommand(commandLine) {
  await new Promise((resolve, reject) => {
    const child = spawn(commandLine, {
      cwd: rootCwd,
      stdio: 'inherit',
      shell: true,
      env: process.env,
    });

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${commandLine} exited with code ${code}`));
    });
  });
}

async function fetchHealth(timeoutMs = 2000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(getHealthUrl(), { signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    const json = await response.json();
    return json;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureStreamServer() {
  const existingHealth = await fetchHealth();
  if (existingHealth?.status === 'ok') {
    console.log('AUTONOMY_FULL_STREAM_READY existing server detected');
    return { startedByRunner: false, child: null };
  }

  console.log('AUTONOMY_FULL_STREAM_START starting stream server');
  const child = spawn('node', ['server/stream-server.mjs', '--profile=low'], {
    cwd: rootCwd,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });

  child.once('error', (error) => {
    fail(`stream server failed to start: ${error.message}`);
  });

  const maxAttempts = 45;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await wait(1000);
    const health = await fetchHealth();
    if (health?.status === 'ok') {
      console.log(`AUTONOMY_FULL_STREAM_READY runner started server after ${attempt}s`);
      return { startedByRunner: true, child };
    }
  }

  try {
    child.kill('SIGTERM');
  } catch {
    // no-op
  }
  fail('stream server did not become healthy in time');
}

async function stopStreamServerIfOwned(state) {
  if (!state?.startedByRunner || !state.child || state.child.killed) {
    return;
  }

  console.log('AUTONOMY_FULL_STREAM_STOP stopping runner-owned stream server');
  try {
    state.child.kill('SIGTERM');
  } catch {
    return;
  }

  for (let i = 0; i < 10; i += 1) {
    await wait(200);
    if (state.child.exitCode !== null) {
      return;
    }
  }

  try {
    state.child.kill('SIGKILL');
  } catch {
    // no-op
  }
}

async function runProofWithRetries() {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`AUTONOMY_FULL_STEP proof attempt=${attempt}/${maxAttempts}`);
    try {
      await runCommand('node scripts/autonomy-proof.mjs');
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`AUTONOMY_FULL_PROOF_RETRY reason=${message}`);

      if (attempt === maxAttempts) {
        throw error;
      }

      // Give the runtime a short cooldown and verify health before next proof attempt.
      await wait(1500);
      const health = await fetchHealth(4000);
      if (health?.status !== 'ok') {
        throw new Error('proof retry aborted because stream health is not ok');
      }
    }
  }
}

async function main() {
  console.log('AUTONOMY_FULL_START');

  const resolved = await resolvePorts('autonomy', process.env);
  applyResolvedPorts(process.env, resolved);
  process.env.AUTONOMY_BASE_URL = `http://127.0.0.1:${process.env.PORT || 7860}`;
  console.log(`AUTONOMY_FULL_PORTS stream=${process.env.PORT} internal=${process.env.INTERNAL_PORT}`);

  try {
    console.log('AUTONOMY_FULL_STEP lint');
    await runCommand('npm run lint');
    console.log('AUTONOMY_FULL_STEP test');
    await runCommand('npm exec vitest run');
    console.log('AUTONOMY_FULL_STEP build');
    await runCommand('npm run build -- --logLevel silent');

    const streamState = await ensureStreamServer();
    try {
      await runProofWithRetries();
    } finally {
      await stopStreamServerIfOwned(streamState);
    }
  } finally {
    // no-op: all owned resources are closed in inner finally block
  }

  console.log('AUTONOMY_FULL_OK');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
