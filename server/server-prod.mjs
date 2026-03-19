import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import compression from 'compression';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';

function parseAllowedOrigins(raw) {
    const defaults = [
        'http://127.0.0.1:3001', 'http://localhost:3001',
        'http://127.0.0.1:7860', 'http://localhost:7860',
        'http://127.0.0.1:5173', 'http://localhost:5173'
    ];
    return String(raw || defaults.join(','))
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
}

const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const WS_SHARED_TOKEN = String(process.env.WS_SHARED_TOKEN || '');

function isAllowedOrigin(origin) {
    if (!origin) return true;
    // Codeanywhere Wildcard: alle Subdomains erlauben
    if (origin.includes('.app.codeanywhere.com')) return true;
    return ALLOWED_ORIGINS.includes(origin);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            "default-src": ["'self'"],
            "connect-src": ["'self'", ...ALLOWED_ORIGINS],
            "img-src": ["'self'", "data:", "blob:"],
            "media-src": ["'self'", "blob:"],
            "script-src": ["'self'", "'unsafe-inline'"],
            "style-src": ["'self'", "'unsafe-inline'"],
            "frame-ancestors": ["'self'"]
        }
    },
    frameguard: { action: 'sameorigin' },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));
app.use(compression());

const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            if (isAllowedOrigin(origin)) {
                callback(null, true);
                return;
            }
            callback(new Error('origin_denied'));
        },
        methods: ['GET', 'POST']
    }
});

app.use(express.static(path.join(__dirname, '../dist')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
});

let worldState = { inGameTime: '06:00', tension: 10 };

io.on('connection', (socket) => {
    // Origin- und Token-Prüfung entfernt, alle Verbindungen erlaubt (Cloud/Hugging Face)

    socket.emit('init-state', worldState);
    socket.on('update-time', (time) => {
        worldState.inGameTime = time;
        socket.broadcast.emit('time-sync', time);
    });

    socket.on('player-moved', (data) => {
        // Relay position to others
        socket.broadcast.emit('player-moved', {
            id: socket.id,
            position: data.position,
            rotation: data.rotation
        });
    });

    socket.on('register-peer', (peerId) => {
        socket.broadcast.emit('peer-id', { id: socket.id, peerId: peerId });
    });

    socket.on('disconnect', () => {
        socket.broadcast.emit('player-left', socket.id);
    });
});

const PORT = process.env.PORT || 7860;

server.listen(PORT, '0.0.0.0', () => {
    console.log('PROD-SERVER: listening on port ' + PORT);
});
