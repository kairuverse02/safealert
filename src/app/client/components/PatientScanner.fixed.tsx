"use client";
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
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
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<Peer.Instance | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const currentRoomRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const hasRedirectedRef = useRef<boolean>(false);
  const [perimeterPoints, setPerimeterPoints] = useState<Point[]>([]);

  const supabase = createClient();
  const router = useRouter();

  // This is the main pairing function, called by scan or manual input
const pairDevice = useCallback((roomId: string) => {
    if (isPairing || isPaired) return;
    
    console.log(`Attempting to pair with room: ${roomId}`);
    setIsPairing(true);
    
    // Stop the scanner
    scannerRef.current?.clear().catch(e => console.error("Scanner clear failed", e));

    // 1. Get Patient's camera
    // Note: request audio:false for the initial pairing answer to keep SDP m-line ordering stable
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then(stream => {
        // Show local preview
        if (myVideoRef.current) {
          myVideoRef.current.srcObject = stream;
        }

        // 2. Initialize Peer (as non-initiator)
        const peer = new Peer({
          initiator: false,
          trickle: true,
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
            (payload: { new: { offer_signal?: unknown; perimeter_json?: string; dependent_action?: string } }) => {
              const offer = payload.new.offer_signal;
              const depAction = payload.new.dependent_action;

              // Handle offer signaling
              if (offer && peerRef.current) {
                console.log('Received offer!');
                peerRef.current.signal(offer as Peer.SignalData | string);
              }

              // Handle guardian requested monitoring actions
              if (depAction === 'start_monitor') {
                // start camera and add to peer
                (async () => {
                  try {
                    if (!streamRef.current) {
                      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                      streamRef.current = s;
                      if (myVideoRef.current) myVideoRef.current.srcObject = s;
                      console.log('Dependent: started camera for monitoring');
                      if (peerRef.current) {
                        try {
                          if (typeof (peerRef.current as any).addStream === 'function') {
                            (peerRef.current as any).addStream(s);
                          } else {
                            const pc = (peerRef.current as unknown as { _pc?: RTCPeerConnection })?._pc;
                            if (pc) s.getTracks().forEach(t => pc.addTrack(t, s));
                          }
                        } catch (err) {
                          console.error('Failed to add stream to peer', err);
                        }
                      }

                      // Clear the dependent_action from the row so it doesn't retrigger
                      try {
                        const rid = currentRoomRef.current;
                        if (rid) {
                          const clearResp = await fetch(`/api/signaling/${rid}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ dependent_action: null }),
                          });
                          const clearJson = await clearResp.json().catch(() => null);
                          console.log('Cleared dependent_action response', clearResp.status, clearJson);
                        }
                      } catch (err) {
                        console.warn('Failed to clear dependent_action', err);
                      }
                    }
                  } catch (err) {
                    console.error('Failed to start camera for monitoring', err);
                  }
                })();
              } else if (depAction === 'stop_monitor') {
                if (streamRef.current) {
                  streamRef.current.getTracks().forEach(t => t.stop());
                  streamRef.current = null;
                  console.log('Dependent: stopped camera monitoring');

                  // clear the dependent_action flag
                  (async () => {
                    try {
                      const rid = currentRoomRef.current;
                      if (rid) {
                        const clearResp = await fetch(`/api/signaling/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dependent_action: null }) });
                        const clearJson = await clearResp.json().catch(() => null);
                        console.log('Cleared dependent_action response', clearResp.status, clearJson);
                      }
                    } catch (err) {
                      console.warn('Failed to clear dependent_action', err);
                    }
                  })();
                }
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
                    const mapped = pts.map((p: unknown) => {
                    const obj = p as { x?: number; y?: number } | undefined;
                    const px = obj?.x ?? 0;
                    const py = obj?.y ?? 0;
                    return { x: px * w, y: py * h };
                  });
                    setPerimeterPoints(mapped);
                  } else {
                    setPerimeterPoints([]);
                  }
                } catch {
                  console.error('Invalid perimeter payload');
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
        peer.on('signal', async (answer: unknown) => {
          console.log('Patient: signal payload', answer);
          console.log('Sending answer/candidate...');
          try {
            const a = answer as Record<string, any> | undefined;
            const type = a && typeof a === 'object' && typeof a.type === 'string' ? a.type : 'signal';
            console.log('Patient: signal event, type', type);

            // If this is a candidate-only signal, merge it into the existing answer_signal stored in DB
            if (type === 'candidate') {
              try {
                const rid = roomId;
                if (!rid) return;
                // fetch current row
                const cur = await fetch(`/api/signaling/${rid}`);
                const curJson = await cur.json().catch(() => null);
                const existing = curJson?.data?.answer_signal;
                const candidateObj = (a as any).candidate;

                // Build a merged object that preserves any existing SDP or other metadata
                if (existing) {
                  const prevCandidates = Array.isArray(existing.candidates)
                    ? existing.candidates.slice()
                    : existing.candidate
                      ? [existing.candidate]
                      : [];
                  const merged: any = {
                    // preserve all existing fields (including sdp) and ensure candidates array contains previous + new
                    ...existing,
                    candidates: [...prevCandidates, candidateObj],
                  };
                  // normalize shape: remove single 'candidate' field if present and set proper type
                  if ('candidate' in merged) delete merged.candidate;
                  merged.type = merged.sdp ? 'answer' : 'candidates';

                  const resp = await fetch(`/api/signaling/${rid}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ answer_signal: merged }),
                  });
                  const json = await resp.json().catch(() => null);
                  console.log('Patient: merged candidate into existing answer/candidates, publish response', resp.status, json);
                } else {
                  // No existing answer, persist as a candidates array for consistent shape
                  const merged = { type: 'candidates', candidates: [candidateObj] };
                  const resp = await fetch(`/api/signaling/${rid}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ answer_signal: merged }),
                  });
                  const json = await resp.json().catch(() => null);
                  console.log('Patient: published candidate (no existing answer), response', resp.status, json);
                }
              } catch (err) {
                console.error('Failed to merge/publish candidate', err);
              }
              return;
            }

            // For final answer or other signals, publish as before
            // Add m-line count diagnostics for debugging mismatched m-lines with guardian
            try {
              const sdp = (a && typeof a.sdp === 'string') ? a.sdp : null;
              if (sdp) {
                const answerMCount = (sdp.match(/^m=/gm) || []).length;
                console.log('Patient: answer m-line count', answerMCount);
                // also attempt to log offer m-line count if we have it
                const offerSdp = (currentRoomRef.current) ? null : null; // placeholder, fetch below if needed
                // We can fetch the room to get the offer for comparison
                try {
                  const rid = roomId;
                  if (rid) {
                    const cur = await fetch(`/api/signaling/${rid}`);
                    const curJson = await cur.json().catch(() => null);
                    const offer = curJson?.data?.offer_signal;
                    const offerS = offer && typeof offer.sdp === 'string' ? offer.sdp : null;
                    if (offerS) console.log('Patient: offer m-line count', (offerS.match(/^m=/gm) || []).length);
                  }
                } catch (e) {
                  console.warn('Patient: failed to fetch offer for m-line diagnostic', e);
                }
              }
            } catch (e) {
              /* ignore */
            }

            const resp = await fetch(`/api/signaling/${roomId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ answer_signal: answer }),
            });
            const json = await resp.json().catch(() => null);
            console.log('Patient: publish answer response', resp.status, json);
            if (!resp.ok) {
              console.error('Failed to send answer via API', json);
            } else {
              console.log('Answer sent via API', json?.data);
            }
          } catch (err) {
            console.error('Failed to send answer (exception)', err);
          }
        });

        peer.on('error', (err) => console.error('Patient peer error', err));

        // Attach RTCPeerConnection diagnostics when underlying PC becomes available (polling)
        const attachPcHandlers = (p: Peer.Instance) => {
          const tryAttach = () => {
            const pc = (p as unknown as { _pc?: RTCPeerConnection })?._pc;
            if (pc) {
              pc.oniceconnectionstatechange = () => console.log('Patient PC ICE state:', pc.iceConnectionState);
              pc.onconnectionstatechange = () => {
                const connState = (pc as any).connectionState || pc.iceConnectionState;
                console.log('Patient PC connection state:', connState);
                // If the underlying RTCPeerConnection reports connected, treat it as paired
                if (connState === 'connected') {
                  console.log('RTCPeerConnection connected — updating UI and redirecting');
                  setIsPairing(false);
                  setIsPaired(true);
                  try {
                    if (!hasRedirectedRef.current) {
                      hasRedirectedRef.current = true;
                      router.push('/client/dashboard');
                    }
                  } catch (err) {
                    console.warn('Router push failed', err);
                  }
                } else if (connState === 'failed') {
                  console.warn('RTCPeerConnection entered failed state');
                  setIsPairing(false);
                  setIsPaired(false);
                }
              };
            } else {
              setTimeout(tryAttach, 200);
            }
          };
          tryAttach();
        };
        attachPcHandlers(peer);

        // When we receive remote stream (guardian), show it
        peer.on('stream', (stream) => {
          console.log('Patient: got remote stream');
          const rv = remoteVideoRef.current || document.getElementById('remoteVideo');
          try {
            if (rv instanceof HTMLVideoElement) {
              rv.srcObject = stream;
              rv.muted = true;
              rv.play().catch(e => console.warn('Patient remote video play failed', e));
            } else if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = stream;
              remoteVideoRef.current.muted = true;
              remoteVideoRef.current.play().catch(e => console.warn('Patient remote video play failed', e));
            }
          } catch (e) {
            // fallback
            const el = document.getElementById('remoteVideo') as HTMLVideoElement | null;
            if (el) {
              el.srcObject = stream;
              el.muted = true;
              el.play().catch(e => console.warn('Patient remote video play failed (fallback)', e));
            }
          }
        });

        // 5. Connection is established
        peer.on('connect', () => {
          console.log('Patient: peer.connect event');
          console.log('CONNECTED!');
          setIsPairing(false);
          setIsPaired(true);
          try {
            router.push('/client/dashboard');
          } catch (err) {
            console.warn('Router push failed', err);
          }

          // If a local stream was already requested by guardian, attach it to this peer
          if (streamRef.current && peerRef.current) {
            try {
              const s = streamRef.current;
              if (typeof (peerRef.current as any).addStream === 'function') {
                (peerRef.current as any).addStream(s);
              } else {
                const pc = (peerRef.current as unknown as { _pc?: RTCPeerConnection })?._pc;
                if (pc) s.getTracks().forEach(t => pc.addTrack(t, s));
              }
            } catch (err) {
              console.error('Failed to add pending stream on connect', err);
            }
          }
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
    }, [supabase, isPairing, isPaired, router]);

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
  }, [initialRoomId, isPairing, isPaired, pairDevice]);

  // Effect to set up the QR scanner
  useEffect(() => {
    if (isPaired || isPairing || initialRoomId) return;
    // Try to start the scanner, but first check if camera is available and permission granted
    const startScanner = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCamera = Array.isArray(devices) && devices.some(d => d.kind === 'videoinput');
        
        if (!hasCamera) {
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
        });

        // scanner started
      } catch (err) {
        console.error('Failed to start scanner', err);
      }
    };

    startScanner();

    // Cleanup
    return () => {
      scannerRef.current?.clear().catch(e => console.error("Scanner clear failed", e));
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
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
      const json = await resp.json().catch(() => null);
      console.log('sendDependentAction response', resp.status, json);
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
            <video id="remoteVideo" ref={(el) => { remoteVideoRef.current = el }} autoPlay playsInline style={{ width: '100%', background: '#000' }} />
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