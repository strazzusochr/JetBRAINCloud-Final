import { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../stores/gameStore';
import { workerManager } from '../../managers/WorkerManager';
import { lodManager } from '../../managers/LODManager';
import { NPC_COLORS } from '../../systems/eventScheduler';

/**
 * InstancedHumanoid V4 — FARBIGE NPCs + CPU-OPTIMIERT
 * 
 * Fixes:
 * 1. NPC-Farben nach Typ: Polizei=Blau, Demo=Orange, Zivi=Grau
 * 2. CPU-freundliche Geometrien (keine Subdivision!)
 * 3. Proper InstanceColor initialization
 * 4. LOD-Cache alle 3 Frames
 * 5. MeshLambertMaterial (leichter als PhysicalMaterial)
 */

const COLOR_CACHE: Record<string, THREE.Color> = {};
Object.entries(NPC_COLORS).forEach(([type, hex]) => {
    COLOR_CACHE[type] = new THREE.Color(hex);
});
const DEFAULT_COLOR = new THREE.Color('#888888');

function createLODGeometry(lod: number): THREE.BufferGeometry {
    switch (lod) {
        case 0: return new THREE.CapsuleGeometry(0.15, 1.0, 8, 16);
        case 1: return new THREE.CapsuleGeometry(0.14, 0.9, 4, 12);
        case 2: return new THREE.CapsuleGeometry(0.13, 0.8, 3, 8);
        case 3: return new THREE.CylinderGeometry(0.13, 0.10, 1.6, 6, 1);
        default: return new THREE.BoxGeometry(0.25, 1.5, 0.2);
    }
}

const MAX = 250;

export const InstancedHumanoid = () => {

    
    const lod0Ref = useRef<THREE.InstancedMesh>(null);
    const lod1Ref = useRef<THREE.InstancedMesh>(null);
    const lod2Ref = useRef<THREE.InstancedMesh>(null);
    const lod3Ref = useRef<THREE.InstancedMesh>(null);
    const lod4Ref = useRef<THREE.InstancedMesh>(null);
    const auraRef = useRef<THREE.InstancedMesh>(null);
    
    const temp = useMemo(() => new THREE.Object3D(), []);
    const hidden = useMemo(() => {
        const o = new THREE.Object3D();
        o.position.set(0, -1000, 0);
        o.scale.set(0, 0, 0);
        o.updateMatrix();
        return o.matrix.clone();
    }, []);

    const geos = useMemo(() => [
        createLODGeometry(0),
        createLODGeometry(1),
        createLODGeometry(2),
        createLODGeometry(3),
        createLODGeometry(4),
    ], []);

    const baseMat = useMemo(() => new THREE.MeshLambertMaterial({ 
        color: 0xffffff,
    }), []);

    const auraGeo = useMemo(() => new THREE.SphereGeometry(0.6, 6, 6), []);
    const auraMat = useMemo(() => new THREE.MeshBasicMaterial({ 
        transparent: true, 
        opacity: 0.15,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    }), []);

    const frameCounter = useRef(0);
    const lodCache = useRef<number[]>(new Array(MAX).fill(4));

    // Initialize instanceColor buffers on mount
    useEffect(() => {
        const refs = [lod0Ref, lod1Ref, lod2Ref, lod3Ref, lod4Ref];
        refs.forEach((ref) => {
            if (ref.current) {
                // Force create instanceColor by setting first instance
                const white = new THREE.Color(0xffffff);
                for (let i = 0; i < MAX; i++) {
                    ref.current.setColorAt(i, white);
                }
                if (ref.current.instanceColor) {
                    ref.current.instanceColor.needsUpdate = true;
                }
            }
        });
        if (auraRef.current) {
            const white = new THREE.Color(0xffffff);
            for (let i = 0; i < MAX; i++) {
                auraRef.current.setColorAt(i, white);
            }
            if (auraRef.current.instanceColor) {
                auraRef.current.instanceColor.needsUpdate = true;
            }
        }
    }, []);

    const refs = [lod0Ref, lod1Ref, lod2Ref, lod3Ref, lod4Ref];

    useFrame(({ camera }) => {
        if (refs.some(r => !r.current) || !auraRef.current) return;
        
        const isRenderer = new URLSearchParams(window?.location?.search).get('renderer') === 'true';
        frameCounter.current++;
        // 🚀 Im Cloud-Renderer seltener LOD-Updates für mehr FPS
        const lodUpdateFrequency = isRenderer ? 15 : 3;
        const doLodUpdate = frameCounter.current % lodUpdateFrequency === 0;
        
        const npcs = useGameStore.getState().npcs;
        const buffer = workerManager.latestNPCBuffer;
        const count = Math.min(npcs.length, MAX);

        const lodCounts = [0, 0, 0, 0, 0];
        let auraCount = 0;
        let lod0Count = 0;
        let lod1Count = 0;

        for (let i = 0; i < count; i++) {
            const npc = npcs[i];
            let x = npc.position[0], y = 1.35, z = npc.position[2];
            
            if (buffer && buffer.length > i * 12 + 4) {
                x = buffer[i * 12 + 2];
                y = buffer[i * 12 + 3];
                z = buffer[i * 12 + 4];
            }

            let lod: number;
            const distSq = (x - camera.position.x) ** 2 + (y - camera.position.y) ** 2 + (z - camera.position.z) ** 2;
            
            if (isRenderer) {
                // 💀 Cloud-Brutal-LOD: Über 3m Distanz wird sofort auf LOD 3 (Cylinder) geschaltet
                if (distSq > 9) lod = 3; 
                else if (distSq > 25) lod = 4;
                else lod = 2; // Minimal LOD 2 (Low-Poly Capsule)
            } else if (doLodUpdate) {
                lod = lodManager.getLODLevel(Math.sqrt(distSq));
            } else {
                lod = 0; 
            }

            // High-Detail Budget Balancing (Skip in Cloud-Renderer)
            if (!isRenderer) {
                if (lod === 0) lod0Count++;
                if (lod === 1) lod1Count++;
                if (lod === 0 && lod0Count > 80) lod = 1;
                if (lod === 1 && lod1Count > 150) lod = 2;
            }
            
            temp.position.set(x, y, z);
            temp.scale.set(1, 1, 1);
            temp.updateMatrix();

            const targetRef = refs[lod].current!;
            const idx = lodCounts[lod];
            targetRef.setMatrixAt(idx, temp.matrix);
            
            // NPC-Farbe nach Typ
            const color = COLOR_CACHE[npc.type] || DEFAULT_COLOR;
            targetRef.setColorAt(idx, color);
            
            lodCounts[lod]++;

            // 🚫 Keine Auren im Cloud-Renderer (spart 250 Instanzen/Updates)
            if (!isRenderer && lod < 2 && auraCount < MAX) {
                temp.position.set(x, y - 0.5, z);
                temp.scale.set(1, 0.15, 1);
                temp.updateMatrix();
                auraRef.current!.setMatrixAt(auraCount, temp.matrix);
                auraRef.current!.setColorAt(auraCount, color);
                auraCount++;
            }
        }

        refs.forEach((ref, l) => {
            const mesh = ref.current!;
            for (let i = lodCounts[l]; i < MAX; i++) {
                mesh.setMatrixAt(i, hidden);
            }
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
            mesh.count = lodCounts[l];
        });

        for (let i = auraCount; i < MAX; i++) {
            auraRef.current!.setMatrixAt(i, hidden);
        }
        auraRef.current.count = auraCount;
        auraRef.current.instanceMatrix.needsUpdate = true;
        if (auraRef.current.instanceColor) auraRef.current.instanceColor.needsUpdate = true;
    });

    const isRenderer = new URLSearchParams(window?.location?.search).get('renderer') === 'true';

    return (
        <>
            <instancedMesh ref={lod0Ref} args={[geos[0], baseMat, MAX]} castShadow={!isRenderer} receiveShadow={!isRenderer} />
            <instancedMesh ref={lod1Ref} args={[geos[1], baseMat, MAX]} castShadow={!isRenderer} receiveShadow={!isRenderer} />
            <instancedMesh ref={lod2Ref} args={[geos[2], baseMat, MAX]} receiveShadow={!isRenderer} />
            <instancedMesh ref={lod3Ref} args={[geos[3], baseMat, MAX]} receiveShadow={!isRenderer} />
            <instancedMesh ref={lod4Ref} args={[geos[4], baseMat, MAX]} receiveShadow={!isRenderer} />
            <instancedMesh ref={auraRef} args={[auraGeo, auraMat, MAX]} />
        </>
    );
};
