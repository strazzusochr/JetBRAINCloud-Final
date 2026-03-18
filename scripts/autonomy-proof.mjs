import { resolvePorts, applyResolvedPorts } from './security/port-check.mjs';

function getBaseUrl() {
  return process.env.AUTONOMY_BASE_URL || `http://127.0.0.1:${process.env.PORT || 7860}`;
}

const profiles = [
  { key: 'low', width: 960, height: 540, fps: 24 },
  { key: 'medium', width: 1280, height: 720, fps: 30 },
  { key: 'high', width: 1600, height: 900, fps: 45 },
  { key: 'aaa', width: 1920, height: 1080, fps: 60 },
  { key: 'low', width: 960, height: 540, fps: 24 },
];

function fail(message) {
  console.error(`AUTONOMY_PROOF_FAIL: ${message}`);
  process.exit(1);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExpectedHealth(profile, options = {}) {
  const retries = options.retries ?? 45;
  const delayMs = options.delayMs ?? 1000;

  let lastHealth = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const health = await requestJson(`${getBaseUrl()}/health`, undefined, { retries: 6, delayMs: 400 });
    assertHealthShape(health);
    lastHealth = health;

    const profileMatch = health.profile === profile.key;
    const dimensionsMatch = health.width === profile.width && health.height === profile.height;
    const transportReady = health.transportSource === 'canvas-webrtc' || health.transportSource === 'tab-webrtc';

    if (profileMatch && dimensionsMatch && transportReady) {
      return health;
    }

    await sleep(delayMs);
  }

  fail(
    `health did not converge to expected profile=${profile.key} width=${profile.width} height=${profile.height} last=${JSON.stringify(lastHealth)}`
  );
}

async function requestJson(url, init, options = {}) {
  const method = init?.method || 'GET';
  const retries = options.retries ?? 16;
  const delayMs = options.delayMs ?? 700;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) {
        return response.json();
      }

      const text = await response.text();
      const isRetryableStatus = response.status === 409 || response.status >= 500;
      if (isRetryableStatus && attempt < retries) {
        await sleep(delayMs);
        continue;
      }

      fail(`${method} ${url} -> ${response.status} ${response.statusText} :: ${text}`);
    } catch (error) {
      if (attempt < retries) {
        await sleep(delayMs);
        continue;
      }
      throw error;
    }
  }

  fail(`${method} ${url} exhausted retry budget`);
}

function assertHealthShape(health) {
  const required = ['status', 'profile', 'width', 'height', 'transportSource', 'publicPort', 'internalPort'];
  for (const key of required) {
    if (!(key in health)) {
      fail(`health response missing key '${key}'`);
    }
  }
  if (health.status !== 'ok') {
    fail(`health status is not ok: ${health.status}`);
  }
}

async function main() {
  const resolved = await resolvePorts('autonomy', process.env);
  applyResolvedPorts(process.env, resolved);
  process.env.AUTONOMY_BASE_URL = `http://127.0.0.1:${process.env.PORT || 7860}`;

  const baseUrl = getBaseUrl();
  console.log(`AUTONOMY_PROOF_START base=${baseUrl}`);
  console.log(`AUTONOMY_PROOF_PORTS stream=${process.env.PORT} internal=${process.env.INTERNAL_PORT}`);

  const initialHealth = await requestJson(`${baseUrl}/health`, undefined, { retries: 45, delayMs: 1000 });
  assertHealthShape(initialHealth);

  console.log(
    `AUTONOMY_PROOF_HEALTH_INITIAL profile=${initialHealth.profile} transport=${initialHealth.transportSource} publicPort=${initialHealth.publicPort} internalPort=${initialHealth.internalPort} clients=${initialHealth.clients}`
  );

  // Normalize start to low first so the proof starts from a deterministic state.
  const normalizedLow = profiles[0];
  await requestJson(
    `${baseUrl}/api/profile/${normalizedLow.key}`,
    { method: 'POST' },
    { retries: 45, delayMs: 1000 }
  );
  await waitForExpectedHealth(normalizedLow, { retries: 60, delayMs: 1000 });

  for (const profile of profiles) {
    const switched = await requestJson(
      `${baseUrl}/api/profile/${profile.key}`,
      { method: 'POST' },
      { retries: 45, delayMs: 1000 }
    );

    if (!switched.ok || switched.profile !== profile.key) {
      fail(`profile switch failed for ${profile.key}: ${JSON.stringify(switched)}`);
    }

    if (switched.width !== profile.width || switched.height !== profile.height || switched.fps !== profile.fps) {
      fail(`profile ${profile.key} dimensions/fps mismatch in switch response: ${JSON.stringify(switched)}`);
    }

    const health = await waitForExpectedHealth(profile, { retries: 60, delayMs: 1000 });

    console.log(
      `AUTONOMY_PROOF_PROFILE_OK profile=${profile.key} rendererFps=${health.rendererFps} viewerFps=${health.viewerFps} clients=${health.clients} transport=${health.transportSource}`
    );
  }

  console.log('AUTONOMY_PROOF_OK');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
