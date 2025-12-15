import React, { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Point } from '@/types';
import { Html5QrcodeScanner } from 'html5-qrcode';
import Peer from 'simple-peer';
import { RealtimeChannel } from '@supabase/supabase-js';

interface PatientScannerProps {
  initialRoomId?: string;
}

export default function PatientScanner({ initialRoomId }: PatientScannerProps) {
  const [manualRoomId, setManualRoomId] = useState<string>(initialRoomId || '');
  const [isPairing, setIsPairing] = useState<boolean>(false);
  const [isPaired, setIsPaired] = useState<boolean>(false);
  
  const myVideoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<Peer.Instance>();
  const channelRef = useRef<RealtimeChannel>();
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const currentRoomRef = useRef<string | null>(null);
  const [perimeterPoints, setPerimeterPoints] = useState<Point[]>([]);

  const supabase = createClient();
  const [scannerRunning, setScannerRunning] = useState<boolean>(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);

  // This is the main pairing function, called by scan or manual input
  const pairDevice = (roomId: string) => {
    if (isPairing || isPaired) return;
    
    console.log(`Attempting to pair with room: ${roomId}`);
    setIsPairing(true);
    
    // Stop the scanner
    scannerRef.current?.clear().catch(e => console.error("Scanner clear failed", e));

    // 1. Get Patient's camera
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        // Show local preview
        if (myVideoRef.current) {
          myVideoRef.current.srcObject = stream;
        }

        // 2. Initialize Peer (as non-initiator)
        const peer = new Peer({
          initiator: false,
          trickle: false,
          stream: stream, // Send our camera stream
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' }
            ]
          }
        });
        peerRef.current = peer;

        // 3. Listen for the Guardian's "offer" via Supabase Realtime and other updates
        currentRoomRef.current = roomId;
        channelRef.current = supabase
          .channel(`room-${roomId}`)
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'pairing_rooms',
              filter: `id=eq.${roomId}`,
            },
            (payload) => {
              const offer = payload.new.offer_signal;
              if (offer && peerRef.current) {
                console.log('Received offer!');
                peerRef.current.signal(offer);
              }

              // Perimeter updates (normalized coords expected: x,y in 0..1)
              if (payload.new.perimeter_json) {
                try {
                  const pts = JSON.parse(payload.new.perimeter_json);
                  if (Array.isArray(pts)) {
                    // Map normalized points to overlay pixel coordinates
                    const overlay = document.getElementById('perimeter-overlay');
                    const w = overlay?.clientWidth || 320;
                    const h = overlay?.clientHeight || 240;
                    const mapped = pts.map((p: any) => ({ x: (p.x || 0) * w, y: (p.y || 0) * h }));
                    setPerimeterPoints(mapped);
                  } else {
                    setPerimeterPoints([]);
                  }
                } catch (e) {
                  console.error('Invalid perimeter payload', e);
                }
              }
            }
          )
          .subscribe();

        // After subscribing, fetch the current room state in case the guardian already published the offer
        (async () => {
          try {
            const resp = await fetch(`/api/signaling/${roomId}`);
            const json = await resp.json();
            if (!resp.ok) {
              console.warn('Failed to fetch room state', json);
            } else if (json?.data?.offer_signal && peerRef.current) {
              console.log('Fetched existing offer from room state, signaling peer');
              peerRef.current.signal(json.data.offer_signal);
            }
          } catch (e) {
            console.warn('Error fetching room state', e);
          }
        })();

        // 4. When our peer generates the "answer", send it to Supabase
        peer.on('signal', async (answer: any) => {
          console.log('Sending answer...');
          try {
            console.log('Patient: signal event, sending answer/candidate to API', answer && (answer.type || (answer.candidate ? 'candidate' : 'signal')));
            const resp = await fetch(`/api/signaling/${roomId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ answer_signal: answer }),
            });
            const json = await resp.json();
            if (!resp.ok) {
              console.error('Failed to send answer via API', json);
            } else {
              console.log('Answer sent via API', json.data);
            }
          } catch (err) {
            console.error('Failed to send answer (exception)', err);
          }
        });

        peer.on('error', (err) => console.error('Patient peer error', err));

        // Attach RTCPeerConnection diagnostics if possible
        // @ts-ignore
        const patientPc: RTCPeerConnection | undefined = (peer as any)?._pc;
        if (patientPc) {
          patientPc.oniceconnectionstatechange = () => console.log('Patient PC ICE state:', patientPc.iceConnectionState);
          patientPc.onconnectionstatechange = () => console.log('Patient PC connection state:', (patientPc as any).connectionState || patientPc.iceConnectionState);
        }

        // When we receive remote stream (guardian), show it
        peer.on('stream', (stream) => {
          const rv = remoteVideoRef.current || document.getElementById('remoteVideo');
          try {
            if (rv instanceof HTMLVideoElement) rv.srcObject = stream;
            else if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
          } catch (e) {
            // fallback
            const el = document.getElementById('remoteVideo') as HTMLVideoElement | null;
            if (el) el.srcObject = stream;
          }
        });

        // 5. Connection is established
        peer.on('connect', () => {
          console.log('CONNECTED!');
          setIsPairing(false);
          setIsPaired(true);
        });

        peer.on('close', () => {
          console.log('Peer connection closed');
          setIsPaired(false);
        });

      })
      .catch(err => {
        console.error('Failed to get media:', err);
        setIsPairing(false);
      });
  };

  // Handler for the manual form submission
  const handleManualPair = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualRoomId.trim()) {
      pairDevice(manualRoomId.trim());
    }
  };

  const handlePastePair = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        setManualRoomId(text.trim());
        pairDevice(text.trim());
      }
    } catch (err) {
      console.error("Paste failed", err);
    }
  };

  // Auto-pair if initialRoomId is provided via props
  useEffect(() => {
    if (initialRoomId && !isPairing && !isPaired) {
      pairDevice(initialRoomId);
    }
  }, [initialRoomId]);

  // Effect to set up the QR scanner
  useEffect(() => {
    if (isPaired || isPairing || initialRoomId) return;
    // Try to start the scanner, but first check if camera is available and permission granted
    const startScanner = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCamera = Array.isArray(devices) && devices.some(d => d.kind === 'videoinput');
        
        if (!hasCamera) {
          setScannerError('No camera device found. Please paste the room code.');
          setScannerRunning(false);
          return;
        }

        // create the scanner
        const scanner = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: { width: 250, height: 250 } }, false);
        scannerRef.current = scanner;

        const onScanSuccess = (decodedText: string) => {
          console.log('QR decoded:', decodedText);
          pairDevice(decodedText);
        };

        scanner.render(onScanSuccess, (error) => {
          console.warn('QR scanner error', error);
          setScannerError(String(error || 'Scanner error'));
        });

        setScannerRunning(true);
        setScannerError(null);
      } catch (err) {
        console.error('Failed to start scanner', err);
        setScannerError(String(err || 'Failed to start scanner'));
        setScannerRunning(false);
      }
    };

    startScanner();

    // Cleanup
    return () => {
      scannerRef.current?.clear().catch(e => console.error("Scanner clear failed", e));
      setScannerRunning(false);
      channelRef.current?.unsubscribe();
      peerRef.current?.destroy();
    };
  }, [isPaired, isPairing, pairDevice, initialRoomId]); // Re-run if we disconnect

  // Send dependent action (bathroom / sos) to pairing row so guardian receives it
  const sendDependentAction = async (action: 'bathroom' | 'sos') => {
    const roomId = currentRoomRef.current;
    if (!roomId) return;
    try {
      const resp = await fetch(`/api/signaling/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependent_action: action }),
      });
      const json = await resp.json();
      if (!resp.ok) console.error('Failed to send dependent action via API', json);
    } catch (e) {
      console.error('Failed to send dependent action', e);
    }
  };

  // --- RENDER LOGIC ---

  if (isPaired) {
    return (
      <div style={styles.container}>
        <h2 style={styles.title}>Connected</h2>
        <div style={{ display: 'flex', gap: 12, width: '100%' }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 'bold' }}>Your Camera (sending)</p>
            <video ref={myVideoRef} autoPlay playsInline muted style={{ width: '100%', background: '#000' }} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 'bold' }}>Guardian View (receiving)</p>
            <video id="remoteVideo" ref={(el) => (remoteVideoRef.current = el)} autoPlay playsInline style={{ width: '100%', background: '#000' }} />
          </div>
        </div>
        <div style={{ marginTop: 12, width: '100%' }}>
          <p style={{ fontWeight: 'bold' }}>Perimeter</p>
          {/** perimeterOverlay will render an SVG overlaid on top of the video area */}
          <div id="perimeter-overlay" style={{ position: 'relative', width: '100%', height: 240, background: '#111' }}>
            {/* We'll draw perimeter polygon via an SVG placed over the video area */}
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
          <button onClick={() => sendDependentAction('bathroom')} style={{ flex: 1, padding: 10, fontWeight: 'bold' }}>Bathroom</button>
          <button onClick={() => sendDependentAction('sos')} style={{ flex: 1, padding: 10, fontWeight: 'bold' }}>SOS</button>
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
      
      {/* Paste-only Join UI (scanner removed) */}
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