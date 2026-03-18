import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const cwd = process.cwd();
const strict = String(process.env.MEMORY_LOG_STRICT || 'false').toLowerCase() === 'true';
const fileMatchers = [/memory/i, /replay/i, /autonomy/i, /proof/i];
const textExtensions = new Set(['.log', '.json', '.jsonl', '.md', '.txt']);

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
      continue;
    }
    acc.push(full);
  }
  return acc;
}

function isCandidate(file) {
  const ext = path.extname(file).toLowerCase();
  if (!textExtensions.has(ext)) return false;
  return fileMatchers.some((rx) => rx.test(file));
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function validateHashChain(lines, file) {
  let prev = 'GENESIS';
  let validated = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i].trim();
    if (!raw) continue;

    const parsed = parseJsonLine(raw);
    if (!parsed || typeof parsed !== 'object') {
      if (strict) throw new Error(`${file}:${i + 1} kein valides JSON`);
      continue;
    }

    if (!parsed.payload || !parsed.hash || !parsed.prevHash) {
      if (strict) throw new Error(`${file}:${i + 1} ohne payload/hash/prevHash`);
      continue;
    }

    if (parsed.prevHash !== prev) {
      throw new Error(`${file}:${i + 1} prevHash mismatch`);
    }

    const digest = crypto
      .createHash('sha256')
      .update(JSON.stringify(parsed.payload) + String(parsed.prevHash))
      .digest('hex');

    if (digest !== parsed.hash) {
      throw new Error(`${file}:${i + 1} hash mismatch`);
    }

    prev = parsed.hash;
    validated += 1;
  }

  return validated;
}

function main() {
  const files = walk(cwd).filter(isCandidate);
  let validatedEntries = 0;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    validatedEntries += validateHashChain(lines, file);
  }

  console.log(`MEMORY_LOG_VALIDATION_OK files=${files.length} entries=${validatedEntries} strict=${strict}`);
}

try {
  main();
} catch (error) {
  console.error(`MEMORY_LOG_VALIDATION_FAIL: ${error.message}`);
  process.exit(1);
}
