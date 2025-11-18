import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { Html5QrcodeScanner } from 'html5-qrcode';
import Peer from 'simple-peer';
import { RealtimeChannel } from '@supabase/supabase-js';

export default function PatientScanner() {
  const [manualRoomId, setManualRoomId] = useState<string>('');
  const [isPairing, setIsPairing] = useState<boolean>(false);
  const [isPaired, setIsPaired] = useState<boolean>(false);
  
  const myVideoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<Peer.Instance>();
  const channelRef = useRef<RealtimeChannel>();
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

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
        });
        peerRef.current = peer;

        // 3. Listen for the Guardian's "offer" via Supabase Realtime
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
              // When we get the offer, signal the peer
              if (offer && peerRef.current) {
                console.log('Received offer!');
                peerRef.current.signal(offer);
              }
            }
          )
          .subscribe();

        // 4. When our peer generates the "answer", send it to Supabase
        peer.on('signal', async (answer) => {
          console.log('Sending answer...');
          await supabase
            .from('pairing_rooms')
            .update({ answer_signal: answer })
            .eq('id', roomId);
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

  // Effect to set up the QR scanner
  useEffect(() => {
    if (isPaired || isPairing) return;

    const scanner = new Html5QrcodeScanner(
      'qr-reader',
      { fps: 10, qrbox: { width: 250, height: 250 } },
      false
    );
    scannerRef.current = scanner;

    const onScanSuccess = (decodedText: string) => {
      pairDevice(decodedText);
    };

    scanner.render(onScanSuccess, () => {/* ignore errors */});

    // Cleanup
    return () => {
      scannerRef.current?.clear().catch(e => console.error("Scanner clear failed", e));
      channelRef.current?.unsubscribe();
      peerRef.current?.destroy();
    };
  }, [isPaired, isPairing, pairDevice]); // Re-run if we disconnect

  // --- RENDER LOGIC ---

  if (isPaired) {
    return (
      <div style={styles.container}>
        <h2 style={styles.title}>Paired! ✅</h2>
        <p>Broadcasting camera...</p>
        <video ref={myVideoRef} autoPlay playsInline muted style={styles.video} />
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
      <h2 style={styles.title}>Scan to Pair</h2>
      <div id="qr-reader" style={{ width: '100%', marginBottom: '20px' }}></div>
      <p style={{ textAlign: 'center', fontWeight: 'bold' }}>OR</p>
      <form onSubmit={handleManualPair} style={{ marginTop: '20px' }}>
        <div>
          <label htmlFor="roomIdInput" style={{ display: 'block', marginBottom: '5px' }}>
            Enter ID Manually:
          </label>
          <input
            id="roomIdInput"
            type="text"
            value={manualRoomId}
            onChange={(e) => setManualRoomId(e.target.value)}
            placeholder="e.g., a1b2-c3d4-e5f6"
            style={{ width: '95%', padding: '8px' }}
          />
        </div>
        <button 
          type="submit" 
          style={{ width: '100%', padding: '10px', fontWeight: 'bold', marginTop: '10px' }}
        >
          Pair with ID
        </button>
      </form>
      
    </div>
  );
}