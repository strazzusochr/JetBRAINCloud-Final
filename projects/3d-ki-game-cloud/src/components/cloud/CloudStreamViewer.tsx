import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { io } from 'socket.io-client';

interface CloudStreamViewerProps {
    streamUrl?: string;
}

export const CloudStreamViewer: React.FC<CloudStreamViewerProps> = ({ streamUrl }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { gameState, isZeroFootprint } = useGameStore();
    const [status, setStatus] = useState<'connecting' | 'streaming' | 'fallback' | 'error'>('connecting');
    const [fps, setFps] = useState(0);
    const [latency, setLatency] = useState(0);
    const socketRef = useRef<any>(null);
    const peerRef = useRef<RTCPeerConnection | null>(null);

    const targetUrl = streamUrl || gameState.cloudStreamUrl || 'https://wrzzzrzr-jetbrain.hf.space';

    useEffect(() => {
        if (!isZeroFootprint) return;

        console.log('🔌 [CloudStreamViewer] Initializing Cloud Stream:', targetUrl);
        setStatus('connecting');

        // Connect to Stream Server
        const socket = io(targetUrl, {
            transports: ['websocket'],
            auth: { token: 'JETBRAIN_CLIENT_v17' }
        });
        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('✅ [CloudStreamViewer] Socket connected.');
            socket.emit('register-role', 'viewer');
        });

        // --- WebRTC Implementation ---
        socket.on('webrtc-offer', async (offer: RTCSessionDescriptionInit) => {
            console.log('🌐 [CloudStreamViewer] Received WebRTC offer.');
            const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            });
            peerRef.current = pc;

            pc.ontrack = (event) => {
                if (videoRef.current) {
                    console.log('🎥 [CloudStreamViewer] Stream track attached.');
                    videoRef.current.srcObject = event.streams[0];
                    setStatus('streaming');
                }
            };

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('webrtc-candidate', event.candidate);
                }
            };

            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('webrtc-answer', answer);
        });

        // --- Binary Stream Fallback (MJPEG) ---
        socket.on('stream-frame', (data: { blob: ArrayBuffer, fps: number, latency: number }) => {
            console.log(`🖼️ [VIEWER] Frame received! Size: ${data.blob.byteLength} bytes`);
            if (status !== 'streaming' && status !== 'fallback') {
                setStatus('fallback');
            }
            setFps(data.fps);
            setLatency(data.latency);

            if (canvasRef.current) {
                const ctx = canvasRef.current.getContext('2d');
                const blob = new Blob([data.blob], { type: 'image/jpeg' });
                const url = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => {
                    if (canvasRef.current) {
                        // Dynamically adjust canvas to match incoming stream resolution
                        if (canvasRef.current.width !== img.width) canvasRef.current.width = img.width;
                        if (canvasRef.current.height !== img.height) canvasRef.current.height = img.height;
                        ctx?.drawImage(img, 0, 0);
                    }
                    URL.revokeObjectURL(url);
                };
                img.src = url;
            }
        });

        // --- Keyboard/Mouse Forwarding ---
        const handleKeyDown = (e: KeyboardEvent) => {
            socket.emit('input-action', { type: 'keydown', key: e.key });
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            socket.emit('input-action', { type: 'keyup', key: e.key });
        };
        const handleMouseMove = (e: MouseEvent) => {
            const rect = videoRef.current?.getBoundingClientRect();
            if (rect) {
                const x = (e.clientX - rect.left) / rect.width;
                const y = (e.clientY - rect.top) / rect.height;
                socket.emit('input-action', { type: 'mousemove', x, y });
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('mousemove', handleMouseMove);

        return () => {
            socket.disconnect();
            peerRef.current?.close();
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('mousemove', handleMouseMove);
        };
    }, [isZeroFootprint, targetUrl]);

    if (!isZeroFootprint) return null;

    return (
        <div style={{
            position: 'fixed', inset: 0, backgroundColor: '#000', 
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            overflow: 'hidden', cursor: 'none'
        }}>
            {/* Main Video Stream */}
            <video 
                ref={videoRef}
                autoPlay 
                playsInline 
                muted={false}
                style={{
                    width: '100%', height: '100%', objectFit: 'cover',
                    display: status === 'streaming' ? 'block' : 'none'
                }}
            />

            {/* MJPEG Fallback Canvas */}
            <canvas 
                ref={canvasRef}
                width={1920}
                height={1080}
                style={{
                    width: '100%', height: '100%', objectFit: 'cover',
                    display: status === 'fallback' ? 'block' : 'none'
                }}
            />

            {/* HUD OVERLAY (0% Local Render) */}
            <div style={{
                position: 'absolute', top: 20, left: 20, 
                color: '#00ffcc', fontFamily: 'Outfit, sans-serif',
                textShadow: '0 0 10px rgba(0,255,204,0.5)',
                pointerEvents: 'none', background: 'rgba(0,0,0,0.4)',
                padding: '10px', borderRadius: '5px', borderLeft: '3px solid #00ffcc'
            }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>🏙️ JETBRAIN CLOUD-STREAM</div>
                <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>PHASE 17 - TRUE ZERO FOOTPRINT</div>
                <hr style={{ borderColor: 'rgba(0,255,204,0.2)' }} />
                <div>STATUS: <span style={{ color: status === 'streaming' ? '#00ff00' : '#ffcc00' }}>{status.toUpperCase()}</span></div>
                <div>FPS: {fps} | LATENCY: {latency}ms</div>
                <div>TIME: {gameState.inGameTime} | TENSION: {gameState.tensionLevel}%</div>
            </div>

            {/* Loading / Error States */}
            {status === 'connecting' && (
                <div style={{ color: '#fff' }}>Connecting to Cloud Renderer...</div>
            )}
            {status === 'error' && (
                <div style={{ color: '#ff4444' }}>Stream Error. Check HF Space Status.</div>
            )}
        </div>
    );
};
