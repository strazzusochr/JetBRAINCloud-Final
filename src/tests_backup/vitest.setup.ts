import { vi } from 'vitest';

// 🌐 WebRTC-Mocks für Vitest/JSDOM Stabilität
// Verhindert PeerJS-Fehler in einer No-Browser-Testumgebung
if (typeof window !== 'undefined') {
  (window as any).RTCPeerConnection = vi.fn().mockImplementation(() => ({
    createOffer: vi.fn().mockResolvedValue({}),
    setLocalDescription: vi.fn().mockResolvedValue({}),
    setRemoteDescription: vi.fn().mockResolvedValue({}),
    addIceCandidate: vi.fn().mockResolvedValue({}),
    createAnswer: vi.fn().mockResolvedValue({}),
    close: vi.fn(),
    onicecandidate: null,
    ontrack: null,
    oniceconnectionstatechange: null,
    generateCertificate: vi.fn().mockResolvedValue({}), // Lint-Korrektur: Methode hinzugefügt
  }));

  (window as any).navigator.mediaDevices = {
    getUserMedia: vi.fn().mockResolvedValue({}),
    enumerateDevices: vi.fn().mockResolvedValue([]),
  };
}

import '@testing-library/jest-dom';
