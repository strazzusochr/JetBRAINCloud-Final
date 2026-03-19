import { useEffect } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { CloudStreamViewer } from '../cloud/CloudStreamViewer';

export const GameCanvas = () => {
    const isZeroFootprint = useGameStore(state => state.isZeroFootprint);
    const startGame = useGameStore(state => state.startGame);
    const initSocket = useGameStore(state => state.initSocket);

    useEffect(() => {
        initSocket();
        startGame();
    }, [initSocket, startGame]);

    if (isZeroFootprint) {
        return <CloudStreamViewer />;
    }

    return <div style={{backgroundColor: '#000', height: '100vh'}} />;
};
