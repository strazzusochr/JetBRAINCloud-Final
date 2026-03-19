import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function startCommand(name, cmd, args) {
    console.log(`[${name}] Starting: ${cmd} ${args.join(' ')}`);
    const proc = spawn(cmd, args, { cwd: root, shell: true, stdio: 'inherit' });
    proc.on('exit', (code) => console.log(`[${name}] Exited with code ${code}`));
    return proc;
}

async function boot() {
    console.log('🚀 JETBRAIN CLOUD BOOT SEQUENCE');

    // 1. Check for build
    if (!fs.existsSync(path.join(root, 'dist'))) {
        console.log('📦 Dist folder missing. Running build...');
        const build = spawn('npm', ['run', 'build'], { cwd: root, shell: true, stdio: 'inherit' });
        await new Promise(resolve => build.on('exit', resolve));
    }

    // 2. Start Stream Server (Port 7860)
    startCommand('STREAM', 'node', ['server/stream-server.mjs']);

    // 3. Start Production Server (Port 3000/7860)
    startCommand('PROD', 'node', ['server/server-prod.mjs']);

    console.log('✨ All systems starting. Check ports 3000 and 7860.');
}

boot().catch(console.error);
