"use client";
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { useWebRTC } from '@/contexts/WebRTCContext';
import { useSoundDetection } from '@/hooks/useSoundDetection';
import { useAudio } from '@/hooks/useAudio';

declare global {
  interface Window {
    __patientMicTest?: () => Promise<boolean>;
    __patientPeer?: unknown;
  }
}

interface PatientScannerProps {
  initialRoomId?: string;
}

export default function PatientScanner({ initialRoomId }: PatientScannerProps) {
  const [manualRoomId, setManualRoomId] = useState<string>(initialRoomId || '');
  const [micTestStatus, setMicTestStatus] = useState<string>('');
  
  const myVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingMicTestRef = useRef<boolean>(false);

  const router = useRouter();
  const { initAudio } = useAudio(false);
  
  // Get context state and methods
  const {
    isPaired,
    isPairing,
    connectionState,
    currentRoomId,
    perimeterPoints,
    isMonitoringActive,
    localStream,
    pairWithRoom,
    publishGuardianEvent,
  } = useWebRTC();

  // Sound detection
  const handlePatientSoundDetected = useCallback(async (message: string) => {
    await publishGuardianEvent('patient_sound', message);
  }, [publishGuardianEvent]);

  const handleSoundError = useCallback((msg: string) => {
    console.warn('Patient sound detection error', msg);
  }, []);

  useSoundDetection(!!isMonitoringActive, handlePatientSoundDetected, handleSoundError, initAudio, localStream);

  // Mic test helper
  const testMicNow = useCallback(async () => {
    console.log('[MIC_TEST] manual mic test starting');
    
    if (!isPaired) {
      const st = 'Pairing required — connect to guardian first';
      setMicTestStatus(st);
      console.warn('[MIC_TEST] cannot run test - not paired');
      return;
    }

    if (connectionState !== 'connected') {
      pendingMicTestRef.current = true;
      const st = 'Queued — will run when peer connection is established';
      setMicTestStatus(st);
      console.log('[MIC_TEST] queued until peer connected');
      return;
    }

    const started = 'Testing...';
    setMicTestStatus(started);

    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCount = s.getAudioTracks().length;
      console.log('[MIC_TEST] got mic stream, audio tracks:', audioCount);
      
      const ok = `OK — ${audioCount} audio track(s) found (${new Date().toLocaleTimeString()})`;
      setMicTestStatus(ok);

      // Publish mic test event
      await publishGuardianEvent('patient_mic_test_start', 'Dependent started mic test');

      // Stop tracks after short period
      setTimeout(() => {
        s.getTracks().forEach(t => t.stop());
        setMicTestStatus(prev => prev + ' — stopped');
      }, 5000);
    } catch (err) {
      console.error('[MIC_TEST] failed to get mic', err);
      const error = err as { message?: string };
      const failed = `Failed: ${error?.message || String(err)}`;
      setMicTestStatus(failed);
    }
  }, [isPaired, connectionState, publishGuardianEvent]);

  // Pairing function
  const pairDevice = useCallback(async (roomId: string) => {
    if (isPairing || isPaired) return;
    
    console.log(`[PatientScanner] Attempting to pair with room: ${roomId}`);
    
    // Stop the scanner
    scannerRef.current?.clear().catch(e => console.error("Scanner clear failed", e));

    try {
      // Get camera stream
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      console.log('[PatientScanner] Got camera stream - video:', stream.getVideoTracks().length, 'audio:', stream.getAudioTracks().length);
      
      // Show local preview
      if (myVideoRef.current) {
        myVideoRef.current.srcObject = stream;
      }
      
      localStreamRef.current = stream;
      
      // Pair using context
      await pairWithRoom(roomId, stream);
      
      // Store room ID for persistence
      try {
        localStorage.setItem('pairingRoomId', roomId);
        window.dispatchEvent(new CustomEvent('pairing-changed', { detail: { pairingRoomId: roomId } }));
      } catch (e) {
        console.warn('[PatientScanner] Failed to store pairing room ID', e);
      }
      
      console.log('[PatientScanner] Pairing completed successfully');
      
    } catch (err) {
      console.error('[PatientScanner] Pairing failed:', err);
      alert(`Failed to pair: ${err}`);
    }
  }, [isPairing, isPaired, pairWithRoom]);

  // Paste and pair helper
  const handlePastePair = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      console.log('[PASTE] Clipboard text:', text);
      if (text && text.trim()) {
        setManualRoomId(text.trim());
        await pairDevice(text.trim());
      }
    } catch (e) {
      console.warn('[PASTE] Failed to read clipboard', e);
      alert('Failed to read clipboard. Please paste manually.');
    }
  }, [pairDevice]);

  // Setup QR scanner on mount
  useEffect(() => {
    if (isPaired || isPairing || initialRoomId) return;

    const startScanner = async () => {
      try {
        // Check camera permission
        const hasCamera = await navigator.mediaDevices.getUserMedia({ video: true })
          .then(() => true)
          .catch(() => false);

        if (!hasCamera) {
          return;
        }

        // Create scanner
        const scanner = new Html5QrcodeScanner(
          'qr-reader',
          { fps: 10, qrbox: { width: 250, height: 250 } },
          false
        );
        scannerRef.current = scanner;

        const onScanSuccess = (decodedText: string) => {
          console.log('[QR] Decoded:', decodedText);
          pairDevice(decodedText);
        };

        scanner.render(onScanSuccess, (error) => {
          console.warn('[QR] Scanner error', error);
        });

      } catch (err) {
        console.error('[QR] Failed to start scanner', err);
      }
    };

    startScanner();

    // Cleanup
    return () => {
      scannerRef.current?.clear().catch(e => console.error("Scanner clear failed", e));
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
      }
    };
  }, [isPaired, isPairing, pairDevice, initialRoomId]);

  // Send dependent action (bathroom / sos)
  const sendDependentAction = async (action: 'bathroom' | 'sos') => {
    if (!currentRoomId) return;
    try {
      const resp = await fetch(`/api/signaling/${currentRoomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependent_action: action }),
      });
      const json = await resp.json().catch(() => null);
      console.log('[PatientScanner] sendDependentAction response', resp.status, json);
    } catch (e) {
      console.error('[PatientScanner] Failed to send dependent action', e);
    }
  };

  // Listen for mic test requests from other components
  useEffect(() => {
    const handler = () => {
      console.log('[MIC_TEST_EVENT] Received dependent-mic-test event');
      testMicNow();
    };
    window.addEventListener('dependent-mic-test', handler as EventListener);
    return () => window.removeEventListener('dependent-mic-test', handler as EventListener);
  }, [testMicNow]);

  // Redirect to dashboard after 25 seconds if paired
  useEffect(() => {
    if (!isPaired) return;
    
    const timer = setTimeout(() => {
      console.log('[PatientScanner] Auto-redirecting to dashboard after 25 seconds');
      router.push('/client/dashboard');
    }, 25000);
    
    return () => clearTimeout(timer);
  }, [isPaired, router]);

  // --- RENDER LOGIC ---

  if (isPaired) {
    return (
      <div style={styles.container}>
        <h2 style={styles.title}>Connected</h2>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
          <div><strong>Room:</strong> {currentRoomId || '—'}</div>
          <div><strong>Status:</strong> {connectionState}</div>
          <div><strong>Monitoring:</strong> {isMonitoringActive ? 'Active' : 'Inactive'}</div>
        </div>
        <div style={{ display: 'flex', gap: 12, width: '100%' }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 'bold' }}>Your Camera (sending)</p>
            <video 
              ref={myVideoRef} 
              autoPlay 
              playsInline 
              muted 
              style={{ width: '100%', background: '#000' }} 
            />

            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <button
                onClick={testMicNow}
                disabled={!isPaired}
                style={{ 
                  padding: '8px 12px', 
                  fontWeight: 'bold', 
                  backgroundColor: '#f97316', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: 6, 
                  cursor: isPaired ? 'pointer' : 'not-allowed', 
                  opacity: isPaired ? 1 : 0.6 
                }}
              >
                Test Microphone
              </button>
              <div style={{ fontSize: 12, color: '#444' }}>
                {micTestStatus || (connectionState === 'connected' ? 'No recent test' : 'Waiting for connection...')}
              </div>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 'bold' }}>Guardian View (receiving)</p>
            <video 
              id="remoteVideo" 
              ref={(el) => { remoteVideoRef.current = el }} 
              autoPlay 
              playsInline 
              style={{ width: '100%', background: '#000' }} 
            />
          </div>
        </div>
        <div style={{ marginTop: 12, width: '100%' }}>
          <p style={{ fontWeight: 'bold' }}>Perimeter</p>
          <div id="perimeter-overlay" style={{ position: 'relative', width: '100%', height: 240, background: '#111' }}>
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
              {perimeterPoints && perimeterPoints.length > 0 && (
                <polygon
                  points={perimeterPoints.map(p => `${p.x},${p.y}`).join(' ')}
                  style={{ fill: 'rgba(52,211,153,0.2)', stroke: 'rgba(52,211,153,0.8)', strokeWidth: 2 }}
                />
              )}
            </svg>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button 
            onClick={() => sendDependentAction('bathroom')} 
            style={{ flex: 1, padding: 10, fontWeight: 'bold' }}
          >
            Bathroom
          </button>
          <button 
            onClick={() => sendDependentAction('sos')} 
            style={{ flex: 1, padding: 10, fontWeight: 'bold' }}
          >
            SOS
          </button>
          <button
            onClick={testMicNow}
            disabled={!isPaired}
            style={{ 
              flex: 1, 
              padding: 10, 
              fontWeight: 'bold', 
              backgroundColor: '#f97316', 
              color: 'white', 
              border: 'none', 
              borderRadius: 6, 
              cursor: isPaired ? 'pointer' : 'not-allowed', 
              opacity: isPaired ? 1 : 0.6 
            }}
          >
            Test Mic
          </button>
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: '#666', textAlign: 'center' }}>
          Redirecting to dashboard in 25 seconds...
        </div>
      </div>
    );
  }

  if (isPairing) {
    return (
      <div style={styles.container}>
        <h2 style={styles.title}>Connecting...</h2>
        <p>Please wait.</p>
      </div>
    );
  }

  // Default screen:
  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Pair with Guardian</h2>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
        <div><strong>Room:</strong> {currentRoomId || '—'}</div>
      </div>
      
      <div style={{ marginTop: 8, marginBottom: 16 }}>
        <p style={{ textAlign: 'center', fontWeight: 'bold', marginBottom: 8 }}>Enter Join Code</p>
        <div>
          <input
            id="roomIdInput"
            type="text"
            value={manualRoomId}
            onChange={(e) => setManualRoomId(e.target.value)}
            placeholder="Paste the room ID here..."
            autoFocus
            style={{
              width: '100%',
              padding: '16px',
              fontSize: '18px',
              border: '2px solid #e5e7eb',
              borderRadius: '8px',
              boxSizing: 'border-box'
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            onClick={handlePastePair}
            style={{
              flex: 1,
              padding: '14px',
              fontWeight: 'bold',
              backgroundColor: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            Paste & Join
          </button>
          <button
            type="button"
            onClick={() => { if (manualRoomId.trim()) pairDevice(manualRoomId.trim()); }}
            style={{
              flex: 1,
              padding: '14px',
              fontWeight: 'bold',
              backgroundColor: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            Join
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    width: '100%',
    maxWidth: 720,
    margin: '0 auto',
    padding: 12,
    color: '#111',
  },
  title: {
    fontSize: 20,
    marginBottom: 8,
  },
  video: {
    width: '100%',
  },
};
