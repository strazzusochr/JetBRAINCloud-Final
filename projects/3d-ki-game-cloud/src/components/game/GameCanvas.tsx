import { useEffect, Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { PerspectiveCamera, Environment, Sky } from '@react-three/drei';
import { useGameStore } from '../../stores/gameStore';
import { CloudStreamViewer } from '../cloud/CloudStreamViewer';

/**
 * 🛠️ JETBRAIN HYBRID CANVAS (Phase 17.03 - Build Safe Version)
 */

const SceneContent = () => {
    return (
        <>
            <PerspectiveCamera makeDefault position={[0, 15, 30]} fov={50} />
            <Sky sunPosition={[100, 20, 100]} />
            <Environment preset="city" />
            <Physics gravity={[0, -9.81, 0]}>
                {/* Minimalistischer Boden für den Beweis */}
                <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                     <planeGeometry args={[1000, 1000]} />
                     <meshStandardMaterial color="#050505" roughness={0.8} />
                </mesh>
                
                {/* Platzhalter für NPCs / KI-Zentrum */}
                <mesh position={[0, 2.5, 0]} castShadow>
                    <boxGeometry args={[5, 5, 5]} />
                    <meshStandardMaterial color="#00ffcc" emissive="#00ffcc" emissiveIntensity={0.5} />
                </mesh>

                <ambientLight intensity={0.5} />
                <pointLight position={[10, 10, 10]} intensity={1} castShadow />
            </Physics>
        </>
    );
};

export const GameCanvas = () => {
    const isZeroFootprint = useGameStore(state => state.isZeroFootprint);
    const startGame = useGameStore(state => state.startGame);
    const initSocket = useGameStore(state => state.initSocket);

    useEffect(() => {
        initSocket();
        startGame();
    }, [initSocket, startGame]);

    const urlParams = useMemo(() => new URLSearchParams(typeof window !== 'undefined' ? window.location.search : ''), []);
    const isRenderer = urlParams.get('renderer') === 'true';
    const streamUrl = urlParams.get('streamUrl') || undefined;

    // 🚀 SERVER-SIDE RENDERER: Full Engine Activation (Build Safe)
    if (isRenderer) {
        return (
            <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
                <Suspense fallback={null}>
                    <Canvas shadows>
                        <SceneContent />
                    </Canvas>
                </Suspense>
            </div>
        );
    }

    // ☁️ CLIENT-SIDE VIEWER: 0% Local GPU Load
    if (isZeroFootprint) {
        return <CloudStreamViewer streamUrl={streamUrl} />;
    }

    return <div style={{ background: '#000', height: '100vh' }} />;
};
