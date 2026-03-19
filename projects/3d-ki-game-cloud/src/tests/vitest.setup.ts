import '@testing-library/jest-dom';
import { vi } from 'vitest';

// 🌐 WebRTC Mock system to prevent PeerJS "Incompatible Browser" errors
const mockRTCPeerConnection = vi.fn().mockImplementation(() => ({
  createOffer: vi.fn().mockResolvedValue({}),
  setLocalDescription: vi.fn().mockResolvedValue({}),
  addIceCandidate: vi.fn().mockResolvedValue({}),
  createAnswer: vi.fn().mockResolvedValue({}),
  setRemoteDescription: vi.fn().mockResolvedValue({}),
  close: vi.fn(),
  onicecandidate: null,
  ontrack: null,
  oniceconnectionstatechange: null,
}));

// @ts-ignore - Mocking the static method
mockRTCPeerConnection.generateCertificate = vi.fn().mockResolvedValue({});

global.RTCPeerConnection = mockRTCPeerConnection as any;

if (!global.navigator.mediaDevices) {
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn().mockResolvedValue({}),
      enumerateDevices: vi.fn().mockResolvedValue([]),
    },
    writable: true,
  });
}
