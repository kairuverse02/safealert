"use client";
import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import Peer from 'simple-peer';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Point } from '@/types';

interface WebRTCContextValue {
  // Peer connection state
  peer: Peer.Instance | null;
  isPaired: boolean;
  isPairing: boolean;
  connectionState: string;
  
  // Room state
  currentRoomId: string | null;
  perimeterPoints: Point[];
  
  // Monitoring state
  isMonitoringActive: boolean;
  
  // Stream refs
  localStream: MediaStream | null;
  
  // Methods
  pairWithRoom: (roomId: string, localStream: MediaStream) => Promise<void>;
  startMonitoring: () => Promise<void>;
  stopMonitoring: () => void;
  publishGuardianEvent: (type: string, message: string) => Promise<void>;
  destroyConnection: () => void;
}

const WebRTCContext = createContext<WebRTCContextValue | null>(null);

export function useWebRTC() {
  const context = useContext(WebRTCContext);
  if (!context) {
    throw new Error('useWebRTC must be used within WebRTCProvider');
  }
  return context;
}

interface WebRTCProviderProps {
  children: React.ReactNode;
}

export function WebRTCProvider({ children }: WebRTCProviderProps) {
  const [isPairing, setIsPairing] = useState(false);
  const [isPaired, setIsPaired] = useState(false);
  const [connectionState, setConnectionState] = useState('new');
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [isMonitoringActive, setIsMonitoringActive] = useState(false);
  const [perimeterPoints, setPerimeterPoints] = useState<Point[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const peerRef = useRef<Peer.Instance | null>(null);
  const nativePcRef = useRef<RTCPeerConnection | null>(null); // Keep reference to native PC
  const channelRef = useRef<RealtimeChannel | null>(null);
  const supabase = createClient();
  const pollRef = useRef<number | null>(null);
  const commandPollRef = useRef<number | null>(null);
  const answerPollRef = useRef<number | null>(null);

  // Cleanup function
  const destroyConnection = useCallback(() => {
    console.log('[WebRTCContext] Destroying connection...');
    
    // Stop polling
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    
    // Stop command polling
    if (commandPollRef.current) {
      clearInterval(commandPollRef.current);
      commandPollRef.current = null;
    }
    
    // Stop answer polling
    if (answerPollRef.current) {
      clearInterval(answerPollRef.current);
      answerPollRef.current = null;
    }
    
    // Unsubscribe from realtime
    if (channelRef.current) {
      try {
        channelRef.current.unsubscribe();
      } catch (e) {
        console.warn('[WebRTCContext] Failed to unsubscribe channel', e);
      }
      channelRef.current = null;
    }
    
    // Destroy peer
    if (peerRef.current) {
      try {
        peerRef.current.destroy();
      } catch (e) {
        console.warn('[WebRTCContext] Failed to destroy peer', e);
      }
      peerRef.current = null;
    }
    
    // Clear native PC reference
    nativePcRef.current = null;
    
    // Stop local stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    
    setIsPaired(false);
    setIsPairing(false);
    setConnectionState('closed');
    setCurrentRoomId(null);
    setIsMonitoringActive(false);
    
    console.log('[WebRTCContext] Connection destroyed');
  }, [localStream]);

  // Publish guardian event helper
  const publishGuardianEvent = useCallback(async (type: string, message: string) => {
    if (!currentRoomId) {
      console.warn('[WebRTCContext] Cannot publish event - no room ID');
      return;
    }
    
    try {
      const payload = { 
        guardian_event: { 
          type, 
          message, 
          time: new Date().toISOString() 
        } 
      };
      const resp = await fetch(`/api/signaling/${currentRoomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await resp.json().catch(() => null);
      console.log(`[WebRTCContext] Published ${type} event:`, resp.status, json);
    } catch (e) {
      console.warn(`[WebRTCContext] Failed to publish ${type} event:`, e);
    }
  }, [currentRoomId]);

  // Start monitoring
  const startMonitoring = useCallback(async () => {
    console.log('[WebRTCContext] Starting monitoring...');
    
    if (!peerRef.current) {
      console.error('[WebRTCContext] Cannot start monitoring - no peer connection');
      return;
    }
    
    try {
      // Get media stream with video + audio
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      console.log('[WebRTCContext] Got media stream - audio tracks:', stream.getAudioTracks().length, 'video tracks:', stream.getVideoTracks().length);
      
      setLocalStream(stream);
      
      const audioCount = stream.getAudioTracks().length;
      if (audioCount === 0) {
        console.warn('[WebRTCContext] No audio tracks available');
        await publishGuardianEvent('patient_microphone_unavailable', 'Microphone not available');
        setIsMonitoringActive(false);
      } else {
        setIsMonitoringActive(true);
      }
      
      // Add tracks to peer connection
      const pc = nativePcRef.current || (peerRef.current as unknown as { _pc?: RTCPeerConnection })?._pc;
      console.log('[WebRTCContext] Peer ref exists:', !!peerRef.current, 'Native PC exists:', !!pc);
      
      if (pc) {
        console.log('[WebRTCContext] PC signaling state:', pc.signalingState, 'connection state:', pc.connectionState);
        
        // Check if PC is closed
        if (pc.signalingState === 'closed') {
          console.error('[WebRTCContext] Cannot add tracks - PC is closed before we could start');
          return;
        }
        
        console.log('[WebRTCContext] Adding tracks to peer connection...');
        
        // Wait for stable connection state
        if (pc.signalingState !== 'stable') {
          console.log('[WebRTCContext] Waiting for stable signaling state..., current:', pc.signalingState);
          let isClosed = false;
          await new Promise<void>((resolve) => {
            let attempts = 0;
            const check = setInterval(() => {
              attempts++;
              console.log('[WebRTCContext] Signaling state check attempt', attempts, ':', pc.signalingState);
              if (pc.signalingState === 'stable') {
                clearInterval(check);
                resolve();
              } else if (pc.signalingState === 'closed' || attempts >= 100) {
                isClosed = (pc.signalingState === 'closed');
                clearInterval(check);
                resolve();
              }
            }, 100);
          });
          
          // Check if PC closed during wait
          if (isClosed) {
            console.error('[WebRTCContext] PC closed while waiting for stable state');
            return;
          }
        }
        
        // Add tracks
        stream.getTracks().forEach(track => {
          try {
            pc.addTrack(track, stream);
            console.log(`[WebRTCContext] Added ${track.kind} track`);
          } catch (e) {
            console.warn(`[WebRTCContext] Failed to add ${track.kind} track:`, e);
          }
        });
        
        // Create and send renegotiation offer
        console.log('[WebRTCContext] Creating renegotiation offer...');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        // Send offer to guardian via API
        if (currentRoomId) {
          try {
            const resp = await fetch(`/api/signaling/${currentRoomId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ offer_signal: offer }),
            });
            console.log('[WebRTCContext] Sent renegotiation offer:', resp.status);
            
            if (!resp.ok) {
              const errorText = await resp.text();
              console.error('[WebRTCContext] Failed to send renegotiation offer:', resp.status, errorText);
            }
            
            // Poll for guardian's answer
            if (resp.ok) {
              console.log('[WebRTCContext] Polling for guardian answer to renegotiation');
            let lastAppliedAnswerSdp: string | null = null;
            if (answerPollRef.current) clearInterval(answerPollRef.current);
            
            answerPollRef.current = window.setInterval(async () => {
              try {
                const answerResp = await fetch(`/api/signaling/${currentRoomId}`);
                const answerData = await answerResp.json().catch(() => null);
                const answer = answerData?.data?.answer_signal;
                
                console.log('[WebRTCContext] Answer poll result:', { hasAnswer: !!answer, answerType: answer?.type, hasSdp: !!answer?.sdp });
                
                if (answer && answer.type === 'answer' && answer.sdp && answer.sdp !== lastAppliedAnswerSdp) {
                  console.log('[WebRTCContext] Received guardian answer, applying');
                  lastAppliedAnswerSdp = answer.sdp;
                  await pc.setRemoteDescription(new RTCSessionDescription(answer));
                  console.log('[WebRTCContext] Renegotiation complete');
                  // Stop polling after receiving answer
                  if (answerPollRef.current) {
                    clearInterval(answerPollRef.current);
                    answerPollRef.current = null;
                  }
                } else if (answer && answer.sdp === lastAppliedAnswerSdp) {
                  console.log('[WebRTCContext] Answer SDP already applied, skipping');
                }
              } catch (e) {
                console.warn('[WebRTCContext] Answer poll error:', e);
              }
            }, 1000);
            } else {
              console.error('[WebRTCContext] Cannot start answer poll - offer request was not ok');
            }
          } catch (e) {
            console.error('[WebRTCContext] Error sending renegotiation offer:', e);
          }
        } else {
          console.error('[WebRTCContext] Cannot send renegotiation offer - no room ID');
        }
      }
      
      // Clear the command that triggered monitoring
      if (currentRoomId) {
        await fetch(`/api/signaling/${currentRoomId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guardian_command: null }),
        });
      }
      
      console.log('[WebRTCContext] Monitoring started successfully');
    } catch (err) {
      console.error('[WebRTCContext] Failed to start monitoring:', err);
      const error = err as { message?: string };
      await publishGuardianEvent(
        'patient_microphone_permission_denied',
        `Permission denied: ${error?.message || String(err)}`
      );
    }
  }, [currentRoomId, publishGuardianEvent]);

  // Stop monitoring
  const stopMonitoring = useCallback(() => {
    console.log('[WebRTCContext] Stopping monitoring...');
    
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    
    setIsMonitoringActive(false);
    
    // Clear command
    if (currentRoomId) {
      fetch(`/api/signaling/${currentRoomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guardian_command: null }),
      }).catch(e => console.warn('[WebRTCContext] Failed to clear command:', e));
    }
    
    console.log('[WebRTCContext] Monitoring stopped');
  }, [localStream, currentRoomId]);

  // Pair with room
  const pairWithRoom = useCallback(async (roomId: string, stream: MediaStream) => {
    if (isPairing || isPaired) {
      console.warn('[WebRTCContext] Already pairing or paired');
      return;
    }
    
    console.log('[WebRTCContext] Pairing with room:', roomId);
    setIsPairing(true);
    setCurrentRoomId(roomId);
    setLocalStream(stream);
    
    try {
      // Create peer connection WITHOUT stream initially to avoid m-line mismatch
      // Stream will be added when guardian sends start_monitor command
      const peer = new Peer({
        initiator: false,
        trickle: true,
        stream: undefined, // Don't send stream initially
        channelConfig: { negotiated: true, id: 0 }, // Pre-negotiated channel prevents WebRTC from negotiating it
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
            // Multiple TURN servers for better NAT traversal
            {
              urls: 'turn:openrelay.metered.ca:80',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            },
            {
              urls: 'turn:openrelay.metered.ca:443',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            },
            {
              urls: 'turn:openrelay.metered.ca:443?transport=tcp',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            },
            // Additional free TURN servers
            {
              urls: 'turn:relay.metered.ca:80',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            },
            {
              urls: 'turn:relay.metered.ca:443',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            },
            {
              urls: 'turn:relay.metered.ca:443?transport=tcp',
              username: 'openrelayproject',
              credential: 'openrelayproject'
            }
          ],
          iceCandidatePoolSize: 10,
          iceTransportPolicy: 'all',
          bundlePolicy: 'max-bundle',
          rtcpMuxPolicy: 'require'
        }
      });
      
      peerRef.current = peer;
      
      // Handle peer events
      peer.on('signal', async (data: Peer.SignalData) => {
        console.log('[WebRTCContext] Peer signal event, type:', (data as { type?: string }).type);
        
        if ((data as { type?: string }).type === 'answer') {
          try {
            const resp = await fetch(`/api/signaling/${roomId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ answer_signal: data }),
            });
            console.log('[WebRTCContext] Published answer:', resp.status);
          } catch (e) {
            console.error('[WebRTCContext] Failed to publish answer:', e);
          }
        } else if ((data as { candidate?: unknown }).candidate) {
          // Send ICE candidates via PATCH, merging into answer_signal
          try {
            const resp = await fetch(`/api/signaling/${roomId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                answer_signal: { 
                  type: 'candidate', 
                  candidate: (data as { candidate: unknown }).candidate 
                } 
              }),
            });
            console.log('[WebRTCContext] Published candidate:', resp.status);
          } catch (e) {
            console.warn('[WebRTCContext] Failed to publish candidate:', e);
          }
        }
      });
      
      peer.on('connect', () => {
        console.log('[WebRTCContext] Peer connected!');
        setConnectionState('connected');
        setIsPaired(true);
        setIsPairing(false);
      });
      
      peerRef.current = peer;
      
      // Store reference to native RTCPeerConnection before it gets destroyed by data channel close
      const nativePc = (peer as unknown as { _pc?: RTCPeerConnection })._pc;
      if (nativePc) {
        nativePcRef.current = nativePc;
        console.log('[WebRTCContext] Stored native PC reference');
        
        // CRITICAL: Prevent simple-peer from closing the native PC when data channel fails
        // Override the peer's destroy method to NOT close the native PC
        const originalDestroy = peer.destroy.bind(peer);
        peer.destroy = () => {
          console.log('[WebRTCContext] Peer destroy called - preventing native PC close');
          // Call original destroy but native PC is already detached via our ref
          // This prevents simple-peer from calling _pc.close()
          (peer as unknown as { _pc?: RTCPeerConnection })._pc = undefined;
          originalDestroy();
        };
      }
      
      peer.on('close', () => {
        console.log('[WebRTCContext] Peer close event - ignoring (data channel closure, not actual disconnection)');
        // DO NOT update state - this is just the data channel closing, not the actual peer connection
        // The real connection status is tracked by ICE state handlers below
      });
      
      peer.on('error', (err: Error) => {
        console.error('[WebRTCContext] Peer error (likely data channel):', err);
        // DO NOT fail the connection - this is just data channel error
        // The real connection errors are tracked by ICE state handlers below
      });
      
      // Access native RTCPeerConnection for ICE state logging AND candidate publishing
      if (nativePc) {
        nativePc.oniceconnectionstatechange = () => {
          const iceState = nativePc.iceConnectionState;
          console.log('[WebRTCContext] Dependent ICE state:', iceState);
          
          // Update isPaired when ICE is connected (don't wait for data channel)
          if (iceState === 'connected' || iceState === 'completed') {
            console.log('[WebRTCContext] ICE connected - marking as paired');
            setConnectionState('connected');
            setIsPaired(true);
            setIsPairing(false);
          } else if (iceState === 'failed' || iceState === 'disconnected') {
            console.log('[WebRTCContext] ICE failed/disconnected');
            setConnectionState(iceState);
          }
        };
        nativePc.onconnectionstatechange = () => {
          console.log('[WebRTCContext] Dependent connection state:', nativePc.connectionState);
        };
        nativePc.onicegatheringstatechange = () => {
          console.log('[WebRTCContext] Dependent ICE gathering state:', nativePc.iceGatheringState);
        };
        // CRITICAL: Actually publish ICE candidates to the database for Guardian to receive
        nativePc.onicecandidate = async (evt) => {
          if (evt.candidate) {
            console.log('[WebRTCContext] Dependent ICE candidate generated: type=', evt.candidate.type, 'protocol=', evt.candidate.protocol);
            // Publish the candidate to the database
            try {
              const candidateInit: RTCIceCandidateInit = {
                candidate: evt.candidate.candidate,
                sdpMid: evt.candidate.sdpMid,
                sdpMLineIndex: evt.candidate.sdpMLineIndex,
              };
              const resp = await fetch(`/api/signaling/${roomId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  answer_signal: {
                    type: 'candidate',
                    candidate: candidateInit
                  }
                }),
              });
              console.log('[WebRTCContext] Published dependent candidate:', resp.status, 'type=', evt.candidate.type);
            } catch (e) {
              console.warn('[WebRTCContext] Failed to publish dependent candidate:', e);
            }
          }
        };
      }
      
      // Setup realtime subscription
      console.log('[WebRTCContext] Setting up realtime subscription...');
      
      if (channelRef.current) {
        try {
          channelRef.current.unsubscribe();
        } catch (e) {
          console.warn('[WebRTCContext] Failed to unsubscribe previous channel:', e);
        }
      }
      
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
          (payload: { 
            new: { 
              offer_signal?: unknown; 
              answer_signal?: unknown; 
              perimeter_json?: string; 
              guardian_command?: string;
            } 
          }) => {
            console.log('[WebRTCContext] Realtime update received');
            
            const { offer_signal, answer_signal, perimeter_json, guardian_command } = payload.new;
            
            // Handle offer (renegotiation from guardian)
            if (offer_signal && peerRef.current) {
              console.log('[WebRTCContext] Received offer from guardian');
              peerRef.current.signal(offer_signal as Peer.SignalData | string);
            }
            
            // Handle answer
            if (answer_signal && peerRef.current && typeof answer_signal === 'object' && (answer_signal as { type?: string }).type === 'answer') {
              console.log('[WebRTCContext] Received answer from guardian');
              peerRef.current.signal(answer_signal as Peer.SignalData | string);
            }
            
            // Handle ICE candidates
            const candidates = (payload.new as { candidates?: unknown[] }).candidates;
            if (candidates && Array.isArray(candidates) && peerRef.current) {
              console.log('[WebRTCContext] Received', candidates.length, 'candidates');
              candidates.forEach(cand => {
                if (cand && typeof cand === 'object') {
                  try {
                    peerRef.current?.signal(cand as Peer.SignalData | string);
                  } catch (e) {
                    console.warn('[WebRTCContext] Failed to signal candidate:', e);
                  }
                }
              });
            }
            
            // Handle guardian commands
            if (guardian_command === 'start_monitor') {
              console.log('[WebRTCContext] Received start_monitor command');
              startMonitoring().catch(e => console.error('[WebRTCContext] Start monitoring failed:', e));
            } else if (guardian_command === 'stop_monitor') {
              console.log('[WebRTCContext] Received stop_monitor command');
              stopMonitoring();
            }
            
            // Handle perimeter updates
            if (perimeter_json) {
              try {
                const pts = JSON.parse(perimeter_json);
                if (Array.isArray(pts)) {
                  const overlay = typeof window !== 'undefined' ? document.getElementById('perimeter-overlay') : null;
                  const w = overlay?.clientWidth || 320;
                  const h = overlay?.clientHeight || 240;
                  const mapped = pts.map((p: { x?: number; y?: number }) => ({
                    x: (p.x ?? 0) * w,
                    y: (p.y ?? 0) * h
                  }));
                  setPerimeterPoints(mapped);
                }
              } catch (e) {
                console.warn('[WebRTCContext] Failed to parse perimeter:', e);
              }
            }
          }
        )
        .subscribe((status: string) => {
          console.log('[WebRTCContext] Realtime subscription status:', status);
          
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('[WebRTCContext] Realtime subscription failed, starting fallback poll');
            
            // Start polling fallback
            if (!pollRef.current) {
              pollRef.current = window.setInterval(async () => {
                try {
                  const resp = await fetch(`/api/signaling/${roomId}`);
                  const data = await resp.json();
                  const cmd = data?.data?.guardian_command;
                  
                  if (cmd === 'start_monitor') {
                    console.log('[WebRTCContext] Poll: start_monitor');
                    await startMonitoring();
                  } else if (cmd === 'stop_monitor') {
                    console.log('[WebRTCContext] Poll: stop_monitor');
                    stopMonitoring();
                  }
                } catch (e) {
                  console.warn('[WebRTCContext] Poll error:', e);
                }
              }, 2000);
            }
          }
        });
      
      // Fetch initial room data to get offer
      console.log('[WebRTCContext] Fetching initial room data...');
      const resp = await fetch(`/api/signaling/${roomId}`);
      const data = await resp.json();
      
      // Store initial candidates to apply after remote description is set
      const initialCandidates: RTCIceCandidateInit[] = [];
      
      if (data?.data?.offer_signal) {
        console.log('[WebRTCContext] Found initial offer, signaling peer');
        
        // Extract candidates before signaling (they'll be applied after remote desc is set)
        if (Array.isArray(data.data.offer_signal.candidates)) {
          initialCandidates.push(...data.data.offer_signal.candidates);
          console.log('[WebRTCContext] Found', initialCandidates.length, 'initial candidates from guardian');
        }
        
        // Signal the offer (this sets the remote description)
        peer.signal(data.data.offer_signal);
        
        // Wait a moment for remote description to be set, then apply candidates
        // Using setTimeout because simple-peer's signal is async internally
        setTimeout(() => {
          const pc = (peer as unknown as { _pc?: RTCPeerConnection })._pc;
          if (pc && pc.remoteDescription) {
            console.log('[WebRTCContext] Remote description set, applying', initialCandidates.length, 'initial candidates');
            initialCandidates.forEach((c: RTCIceCandidateInit, idx: number) => {
              try {
                const candidate = new RTCIceCandidate(c);
                pc.addIceCandidate(candidate)
                  .then(() => console.log('[WebRTCContext] Applied initial candidate', idx + 1))
                  .catch((e: Error) => console.warn('[WebRTCContext] Failed to add initial candidate', idx + 1, e.message));
              } catch (e) {
                console.warn('[WebRTCContext] Failed to create initial candidate:', e);
              }
            });
          } else {
            console.warn('[WebRTCContext] Remote description not yet set, will rely on polling');
          }
        }, 500);
      }
      
      // Start polling for guardian's ICE candidates since realtime may be unreliable
      let appliedCandidateCount = 0; // Start from 0, we'll reapply if needed
      console.log('[WebRTCContext] Starting candidate poll');
      const candidatePollInterval = window.setInterval(async () => {
        try {
          const pc = (peerRef.current as unknown as { _pc?: RTCPeerConnection })?._pc;
          const iceState = pc?.iceConnectionState;
          
          // Stop polling once ICE is connected
          if (iceState === 'connected' || iceState === 'completed') {
            console.log('[WebRTCContext] ICE connected, stopping candidate poll');
            clearInterval(candidatePollInterval);
            return;
          }
          
          // Don't apply candidates until remote description is set
          if (!pc?.remoteDescription) {
            console.log('[WebRTCContext] Candidate poll: waiting for remote description');
            return;
          }
          
          const pollResp = await fetch(`/api/signaling/${roomId}`);
          const pollData = await pollResp.json();
          const candidates = pollData?.data?.offer_signal?.candidates;
          
          console.log('[WebRTCContext] Candidate poll: ICE state:', iceState, 'candidates in DB:', candidates?.length || 0, 'applied:', appliedCandidateCount);
          
          if (Array.isArray(candidates) && candidates.length > appliedCandidateCount) {
            const newCandidates = candidates.slice(appliedCandidateCount);
            console.log(`[WebRTCContext] Poll: applying ${newCandidates.length} new guardian candidates via addIceCandidate`);
            
            for (const c of newCandidates) {
              try {
                const candidate = new RTCIceCandidate(c as RTCIceCandidateInit);
                await pc.addIceCandidate(candidate);
                console.log('[WebRTCContext] Poll: added candidate:', (c as RTCIceCandidateInit).candidate?.substring(0, 50));
              } catch (e) {
                console.warn('[WebRTCContext] Failed to add polled candidate:', e);
              }
            }
            appliedCandidateCount = candidates.length;
          }
        } catch (e) {
          console.warn('[WebRTCContext] Candidate poll error:', e);
        }
      }, 1000);
      
      // Store interval ref for cleanup
      pollRef.current = candidatePollInterval;
      
      // Start polling for guardian commands (in addition to realtime subscription)
      // This ensures commands are received even if realtime subscription has issues
      console.log('[WebRTCContext] Starting guardian command poll');
      let lastProcessedCommand: string | null = null;
      const commandPollInterval = window.setInterval(async () => {
        try {
          const pollResp = await fetch(`/api/signaling/${roomId}`);
          const pollData = await pollResp.json();
          const cmd = pollData?.data?.guardian_command;
          
          // Only process if command changed from last time
          if (cmd && cmd !== lastProcessedCommand) {
            lastProcessedCommand = cmd;
            
            if (cmd === 'start_monitor') {
              console.log('[WebRTCContext] Command poll: received start_monitor');
              await startMonitoring();
              // Clear command after executing
              await fetch(`/api/signaling/${roomId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guardian_command: null }),
              });
              lastProcessedCommand = null; // Reset after clearing
            } else if (cmd === 'stop_monitor') {
              console.log('[WebRTCContext] Command poll: received stop_monitor');
              stopMonitoring();
              // Clear command after executing
              await fetch(`/api/signaling/${roomId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guardian_command: null }),
              });
              lastProcessedCommand = null; // Reset after clearing
            }
          } else if (!cmd && lastProcessedCommand) {
            // Command was cleared, reset tracker
            lastProcessedCommand = null;
          }
        } catch (e) {
          console.warn('[WebRTCContext] Command poll error:', e);
        }
      }, 1000); // Poll every second for commands
      
      // Store command poll ref for cleanup
      commandPollRef.current = commandPollInterval;
      
    } catch (err) {
      console.error('[WebRTCContext] Pairing failed:', err);
      setIsPairing(false);
      setIsPaired(false);
      throw err;
    }
  }, [isPairing, isPaired, startMonitoring, stopMonitoring, supabase]);

  // Cleanup on unmount ONLY (no dependencies to avoid re-running)
  useEffect(() => {
    return () => {
      console.log('[WebRTCContext] Provider unmounting, cleaning up...');
      
      // Inline cleanup to avoid dependency issues
      if (pollRef.current) clearInterval(pollRef.current);
      if (channelRef.current) {
        try {
          channelRef.current.unsubscribe();
        } catch (e) {
          console.warn('[WebRTCContext] Failed to unsubscribe', e);
        }
      }
      if (peerRef.current) {
        try {
          peerRef.current.destroy();
        } catch (e) {
          console.warn('[WebRTCContext] Failed to destroy peer', e);
        }
      }
    };
  }, []); // Empty array - only run on actual unmount

  const value: WebRTCContextValue = {
    peer: peerRef.current,
    isPaired,
    isPairing,
    connectionState,
    currentRoomId,
    perimeterPoints,
    isMonitoringActive,
    localStream,
    pairWithRoom,
    startMonitoring,
    stopMonitoring,
    publishGuardianEvent,
    destroyConnection,
  };

  return (
    <WebRTCContext.Provider value={value}>
      {children}
    </WebRTCContext.Provider>
  );
}
