import os from 'node:os';

const NO_REMOTE_COMPUTE = String(process.env.NO_REMOTE_COMPUTE || 'true').toLowerCase() === 'true';
const allowedHosts = new Set(
  String(process.env.ALLOWED_COMPUTE_HOSTS || '127.0.0.1,localhost')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);

const targetHost = String(process.env.RENDER_TARGET_HOST || 'localhost').trim();
const maxHeapMb = Number(process.env.MAX_HEAP_MB || 3072);
const maxCpuLoadRatio = Number(process.env.MAX_CPU_LOAD_RATIO || 0.95);

function assertNoRemoteCompute() {
  if (!NO_REMOTE_COMPUTE) return;
  if (!allowedHosts.has(targetHost)) {
    throw new Error(`No-Remote-Compute verletzt: ${targetHost} ist nicht erlaubt`);
  }
}

function assertResourceBudget() {
  const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;
  const cpuRatio = os.loadavg()[0] / Math.max(1, os.cpus().length);

  if (heapMb > maxHeapMb) {
    throw new Error(`Heap-Budget ueberschritten: ${heapMb.toFixed(1)}MB > ${maxHeapMb}MB`);
  }

  if (cpuRatio > maxCpuLoadRatio) {
    throw new Error(`CPU-Load-Budget ueberschritten: ${(cpuRatio * 100).toFixed(1)}% > ${(maxCpuLoadRatio * 100).toFixed(1)}%`);
  }

  console.log(`RESOURCE_GUARD_OK heapMb=${heapMb.toFixed(1)} cpuRatio=${cpuRatio.toFixed(3)}`);
}

function main() {
  assertNoRemoteCompute();
  assertResourceBudget();
  console.log(`NO_REMOTE_COMPUTE_OK host=${targetHost}`);
}

try {
  main();
} catch (error) {
  console.error(`RESOURCE_GUARD_FAIL: ${error.message}`);
  process.exit(1);
}
