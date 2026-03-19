import React, { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

/**
 * CloudStreamViewer V4 — Codeanywhere Edition
 *
 * KERNFIX:
 * - Kein cloudStreamUrl mehr aus dem Store lesen (war HF-URL → 400 Bad Request)
 * - Immer window.location.origin nutzen (Codeanywhere-Proxy leitet korrekt weiter)
 * - Alle HuggingFace-Referenzen entfernt
 *
 * Architektur:
 *   Server: CDP Screencast → io.emit('frame', jpegBuffer)
 *   Client: socket.on('frame') → Canvas → sichtbar
 */
export const CloudStreamViewer: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const socketRef = useRef<Socket | null>(null);
    const frameCountRef = useRef(0);
    const lastFpsTimeRef = useRef(Date.now());
    const prevBlobUrlRef = useRef<string | null>(null);

    const [status, setStatus] = useState('Verbindung zur Cloud...');
    const [streamFps, setStreamFps] = useState(0);
    const [rendererFps, setRendererFps] = useState(0);
    const [isLive, setIsLive] = useState(false);

    // FPS-Zähler
    const countFrame = useCallback(() => {
        frameCountRef.current++;
        const now = Date.now();
        if (now - lastFpsTimeRef.current >= 1000) {
            setStreamFps(frameCountRef.current);
            lastFpsTimeRef.current = now;
            frameCountRef.current = 0;
        }
    }, []);

    useEffect(() => {
        // FIX: Immer window.location.origin — kein Store, kein HF, keine hardcoded URL
        const socketUrl = window.location.origin;
        console.log('🔌 CloudStreamViewer V4: Verbinde zu', socketUrl);

        const socket = io(socketUrl, {
            transports: ['websocket', 'polling'],
            upgrade: true,
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: Infinity,
            timeout: 20000,
        });
        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('✅ Socket.IO verbunden:', socket.id);
            setStatus('Verbunden — Warte auf Video-Stream...');
            socket.emit('register-role', { role: 'viewer' });
        });

        // JPEG Frame Empfang via CDP Screencast
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        socket.on('frame', (jpegData: any) => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            if (prevBlobUrlRef.current) {
                URL.revokeObjectURL(prevBlobUrlRef.current);
                prevBlobUrlRef.current = null;
            }

            const raw = jpegData instanceof ArrayBuffer
                ? jpegData
                : (jpegData?.buffer ?? jpegData);

            const blob = new Blob([new Uint8Array(raw)], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            prevBlobUrlRef.current = url;

            const img = new Image();
            img.onload = () => {
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                if (canvas.width !== img.width) canvas.width = img.width;
                if (canvas.height !== img.height) canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                prevBlobUrlRef.current = null;
                countFrame();
                setIsLive(true);
                setStatus('LIVE STREAM AKTIV (Zero-Footprint)');
            };
            img.onerror = () => URL.revokeObjectURL(url);
            img.src = url;
        });

        // stream-frame Fallback (älteres Server-Format)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        socket.on('stream-frame', (data: any) => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const blobData = data?.blob ?? data;
            const blob = new Blob([blobData], { type: 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                if (canvas.width !== img.width) canvas.width = img.width;
                if (canvas.height !== img.height) canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                countFrame();
                setIsLive(true);
                setStatus('LIVE STREAM AKTIV (Zero-Footprint)');
            };
            img.onerror = () => URL.revokeObjectURL(url);
            img.src = url;
        });

        socket.on('transport-metrics', (data: { rendererFps?: number }) => {
            if (data?.rendererFps) setRendererFps(data.rendererFps);
        });

        socket.on('disconnect', () => {
            setStatus('Cloud-Verbindung unterbrochen. Reconnecting...');
            setStreamFps(0);
            setIsLive(false);
        });

        socket.on('connect_error', (err: Error) => {
            console.warn('⚠️ Socket.IO Fehler:', err.message);
            setStatus(`Verbindungsfehler: ${err.message}`);
        });

        return () => {
            socket.disconnect();
            if (prevBlobUrlRef.current) {
                URL.revokeObjectURL(prevBlobUrlRef.current);
            }
        };
    }, [countFrame]);

    // Tastatur + Maus weiterleiten
    useEffect(() => {
        const socket = socketRef.current;
        if (!socket) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (socket.connected) socket.emit('keydown', { key: e.code });
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (socket.connected) socket.emit('keyup', { key: e.code });
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, []);

    return (
        <div style={{
            position: 'absolute', top: 0, left: 0,
            width: '100vw', height: '100vh',
            background: '#0a0a0a', overflow: 'hidden'
        }}>
            {/* Video-Stream als JPEG-Canvas */}
            <canvas
                ref={canvasRef}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    display: isLive ? 'block' : 'none',
                    imageRendering: 'pixelated',
                }}
                onMouseMove={(e) => {
                    socketRef.current?.emit('mousemove', { x: e.clientX, y: e.clientY });
                }}
                onMouseDown={(e) => {
                    socketRef.current?.emit('mousedown', {
                        button: e.button === 0 ? 'left' : 'right'
                    });
                }}
                onMouseUp={(e) => {
                    socketRef.current?.emit('mouseup', {
                        button: e.button === 0 ? 'left' : 'right'
                    });
                }}
                onClick={(e) => {
                    socketRef.current?.emit('click', { x: e.clientX, y: e.clientY });
                }}
            />

            {/* Ladeanzeige */}
            {!isLive && (
                <div style={{
                    position: 'absolute', top: '50%', left: '50%',
                    transform: 'translate(-50%, -50%)',
                    textAlign: 'center', color: '#0ff', fontFamily: 'monospace'
                }}>
                    <div style={{ fontSize: '24px', marginBottom: '1rem' }}>
                        ⏳ {status}
                    </div>
                    {rendererFps > 0 && (
                        <div style={{ fontSize: '14px', color: '#0f0', marginBottom: '1rem' }}>
                            Renderer: {rendererFps} FPS — Frames werden übertragen...
                        </div>
                    )}
                    <div style={{
                        width: '40px', height: '40px',
                        border: '3px solid #0ff',
                        borderTop: '3px solid transparent',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                        margin: '0 auto'
                    }} />
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
            )}

            {/* Mini-HUD */}
            {isLive && (
                <div style={{
                    position: 'absolute', top: 8, left: 8,
                    background: 'rgba(0,0,0,0.7)', color: '#0f0',
                    fontFamily: 'monospace', fontSize: '11px',
                    padding: '4px 8px', borderRadius: '3px',
                    pointerEvents: 'none'
                }}>
                    ☁️ CLOUD STREAM | {streamFps} FPS
                </div>
            )}
        </div>
    );
};
