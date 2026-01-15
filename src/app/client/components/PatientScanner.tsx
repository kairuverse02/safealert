"use client";
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Point } from '@/types';
import { Html5QrcodeScanner } from 'html5-qrcode';
import Peer from 'simple-peer';

declare global {
  interface Window {
    __patientMicTest?: () => Promise<boolean>;
    __patientPeer?: Peer.Instance | null;
  }
}

import { RealtimeChannel } from '@supabase/supabase-js';
import { useSoundDetection } from '@/hooks/useSoundDetection';
import { useAudio } from '@/hooks/useAudio';

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
  const channelRetryRef = useRef<number>(0);
  const MAX_CHANNEL_RETRIES = 3;
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const currentRoomRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const hasRedirectedRef = useRef<boolean>(false);
  const isMonitoringActiveDuringPairingRef = useRef<boolean>(false);
  const [perimeterPoints, setPerimeterPoints] = useState<Point[]>([]);
  // If user triggers a mic test while the peer isn't connected yet, queue it and run on connect
  const pendingMicTestRef = useRef<boolean>(false);

  const supabase = createClient();
  const router = useRouter();
  const [isMonitoringActive, setIsMonitoringActive] = useState(false);
  const [micTestStatus, setMicTestStatus] = useState<string>('');
  // Debug helpers: surface last received dependent_action and current pairing room
  const [lastDependentAction, setLastDependentAction] = useState<string | null>(null);
  const [currentRoomIdState, setCurrentRoomIdState] = useState<string | null>(initialRoomId || null);

  // Robust redirect helper: attempt redirect unless already on dashboard
  const doRedirectToDashboard = useCallback((delay = 0) => {
    try {
      console.log('[REDIRECT] doRedirectToDashboard called with delay:', delay);
      
      // If we're already on the dashboard, skip redirect
      const alreadyOnDashboard = typeof window !== 'undefined' && window.location && typeof window.location.pathname === 'string' && window.location.pathname.startsWith('/client/dashboard');
      if (alreadyOnDashboard) {
        console.log('[REDIRECT] Already on dashboard; skipping redirect');
        return;
      }

      console.log('[REDIRECT] Scheduling redirect in', delay, 'ms. Router available?', !!router);

      // Try router.push first, fallback to location.href
      const performRedirect = () => {
        try {
          console.log('[REDIRECT] Attempting router.push to /client/dashboard');
          if (router && typeof (router as unknown as { push?: (url: string) => unknown }).push === 'function') {
            (router as unknown as { push?: (url: string) => void }).push?.('/client/dashboard');
            console.log('[REDIRECT] router.push completed');
          } else {
            throw new Error('Router not available');
          }
        } catch (e) {
          console.warn('[REDIRECT] router.push failed, falling back to location.href', e);
          try {
            console.log('[REDIRECT] Setting window.location.href to /client/dashboard');
            window.location.href = '/client/dashboard';
          } catch (err) {
            console.warn('[REDIRECT] location.href redirect failed', err);
          }
        }
      };

      if (delay > 0) {
        setTimeout(performRedirect, delay);
      } else {
        performRedirect();
      }

      // mark that we've attempted at least one redirect
      hasRedirectedRef.current = true;
    } catch (err) {
      console.warn('[REDIRECT] unexpected error while redirecting', err);
      try {
        console.log('[REDIRECT] Emergency fallback to window.location.href');
        window.location.href = '/client/dashboard';
      } catch (err2) {
        console.warn('[REDIRECT] fallback failed again', err2);
      }
    }
  }, [router]);

  const { initAudio } = useAudio(false);

  const handlePatientSoundDetected = useCallback(async (message: string) => {
    try {
      const rid = currentRoomRef.current;
      if (!rid) return;
      const payload = { guardian_event: { type: 'patient_sound', message, time: new Date().toISOString() } };
      const resp = await fetch(`/api/signaling/${rid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await resp.json().catch(() => null);
      console.log('Patient: published guardian_event', resp.status, json);
    } catch (e) {
      console.warn('Patient: failed to publish guardian_event', e);
    }
  }, []);

  const handleSoundError = useCallback((msg: string) => {
    console.warn('Patient sound detection error', msg);
  }, []);

  useSoundDetection(!!isMonitoringActive, handlePatientSoundDetected, handleSoundError, initAudio, streamRef.current);

  // --- Mic test helper (stable) ---
  const testMicNow = useCallback(async () => {
    console.log('[MIC_TEST] manual mic test starting');
    const peerExists = !!peerRef.current;
    if (!peerExists) {
      const st = 'Pairing required — connect to guardian first';
      setMicTestStatus(st);
      try { window.dispatchEvent(new CustomEvent('mic-test-status', { detail: { status: st } })); } catch {}
      console.warn('[MIC_TEST] cannot run test - not paired (no peer)');
      return;
    }

    if (!isPeerConnected()) {
      // Queue the mic test to run when PC connects
      pendingMicTestRef.current = true;
      const st = 'Queued — will run when peer connection is established';
      setMicTestStatus(st);
      try { window.dispatchEvent(new CustomEvent('mic-test-status', { detail: { status: st } })); } catch {}
      console.log('[MIC_TEST] queued until peer connected');
      return;
    }

    const started = 'Testing...';
    setMicTestStatus(started);
    try { window.dispatchEvent(new CustomEvent('mic-test-status', { detail: { status: started } })); } catch {}

    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCount = s.getAudioTracks().length;
      console.log('[MIC_TEST] got mic stream, audio tracks:', audioCount, s.getAudioTracks());
      const ok = `OK — ${audioCount} audio track(s) found (${new Date().toLocaleTimeString()})`;
      setMicTestStatus(ok);
      try { window.dispatchEvent(new CustomEvent('mic-test-status', { detail: { status: ok } })); } catch {}

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        console.log('[MIC_TEST] devices', devices);
      } catch (_e) {
        console.warn('[MIC_TEST] enumerateDevices failed', _e);
      }

      // publish a mic test event so guardian can correlate the incoming audio
      try {
        const rid = currentRoomRef.current;
        if (rid) {
          const payload = { guardian_event: { type: 'patient_mic_test_start', message: 'Dependent started mic test', time: new Date().toISOString() } };
          const resp = await fetch(`/api/signaling/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          const json = await resp.json().catch(() => null);
          console.log('[MIC_TEST] published mic_test_start event', resp.status, json);
        }
      } catch (_e) {
        console.warn('[MIC_TEST] failed to publish mic_test_start', _e);
      }

      const pc = (peerRef.current as unknown as { _pc?: RTCPeerConnection })?._pc;
      if (pc) {
        s.getTracks().forEach(t => {
          try {
            const sender = pc.addTrack(t, s);
            console.log('[MIC_TEST] added mic track to pc, sender trackId:', sender?.track?.id);
          } catch (_e) {
            console.warn('[MIC_TEST] failed to add mic track to pc', _e);
          }
        });
        try { console.log('[MIC_TEST] pc.getSenders', pc.getSenders().map(sd => ({ trackId: sd.track?.id, kind: sd.track?.kind }))); } catch(_e) { console.warn('[MIC_TEST] failed to read pc.senders', _e); }
      } else {
        console.warn('[MIC_TEST] peer._pc not available');
      }

      // stop tracks after short period
      setTimeout(() => {
        s.getTracks().forEach(t => t.stop());
        const stopped = (ok + ' — stopped');
        setMicTestStatus(prev => prev + ' — stopped');
        try { window.dispatchEvent(new CustomEvent('mic-test-status', { detail: { status: stopped } })); } catch {}
      }, 5000);
    } catch (err) {
      console.error('[MIC_TEST] failed to get mic', err);
      const e = err as unknown;
      const message = (typeof e === 'object' && e !== null && 'message' in e) ? (e as { message?: unknown }).message : undefined;
      const failed = `Failed: ${typeof message === 'string' ? message : String(e)}`;
      setMicTestStatus(failed);
      try { window.dispatchEvent(new CustomEvent('mic-test-status', { detail: { status: failed } })); } catch {}
    }
  }, []);

  // Reusable start_monitor handler so we catch actions that were set before we subscribed
  const handleStartMonitoringAction = useCallback(async () => {
    try {
      // Mark that monitoring is starting during pairing phase - prevents timeout redirect
      isMonitoringActiveDuringPairingRef.current = true;
      console.log('[START_MONITOR_HANDLER] Marking monitoring as active during pairing');
      
      if (!streamRef.current) {
        console.log('[START_MONITOR_HANDLER] Calling getUserMedia for audio+video (should already be available from pairing)');
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        console.log('[START_MONITOR_HANDLER] getUserMedia success. Stream audio tracks:', s.getAudioTracks().length, 'video tracks:', s.getVideoTracks().length);
        streamRef.current = s;
        const audioCount = s.getAudioTracks().length;
        console.log('Dependent: stream audio tracks', audioCount, s.getAudioTracks());
        try {
          console.log('[START_MONITOR_HANDLER] Audio track details:', s.getAudioTracks().map(t => ({ id: t.id, label: t.label, enabled: t.enabled })));
          navigator.mediaDevices.enumerateDevices()
            .then(devs => console.log('[START_MONITOR_HANDLER] enumerateDevices:', devs))
            .catch(e => console.warn('[START_MONITOR_HANDLER] enumerateDevices failed', e));
        } catch (e) {
          console.warn('[START_MONITOR_HANDLER] Failed to log audio track details', e);
        }

        // If microphone is not available (user denied or no device), inform guardian and do not enable sound detection
        if (audioCount === 0) {
          console.warn('Dependent: monitoring stream has no audio tracks');
          setIsMonitoringActive(false);

          // Publish a guardian_event to notify guardian that microphone wasn't available/allowed
          try {
            const rid = currentRoomRef.current;
            if (rid) {
              const payload = { guardian_event: { type: 'patient_microphone_unavailable', message: 'Dependent did not provide microphone (permission denied or no device).', time: new Date().toISOString() } };
              const resp = await fetch(`/api/signaling/${rid}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              const json = await resp.json().catch(() => null);
              console.log('Patient: published microphone-unavailable guardian_event', resp.status, json);
            }
          } catch (e) {
            console.warn('Patient: failed to publish mic unavailable event', e);
          }

          if (myVideoRef.current) myVideoRef.current.srcObject = s;
          console.log('Dependent: started camera for monitoring (audio absent)');
        } else {
          setIsMonitoringActive(true);
          if (myVideoRef.current) myVideoRef.current.srcObject = s;
          console.log('Dependent: started camera for monitoring');
        }

        // Add the new stream tracks to the peer connection (replace any empty stream from pairing)
        if (peerRef.current) {
          const pc = (peerRef.current as unknown as { _pc?: RTCPeerConnection })?._pc;
          if (pc) {
            const videoTrack = s.getVideoTracks()[0];
            const audioTrack = s.getAudioTracks()[0];
            
            console.log('[START_MONITOR_HANDLER] Adding tracks to peer connection. Video:', !!videoTrack, 'Audio:', !!audioTrack);
            
            if (videoTrack) {
              try {
                pc.addTrack(videoTrack, s);
                console.log('[START_MONITOR_HANDLER] Added video track to peer connection');
              } catch (e) {
                console.warn('[START_MONITOR_HANDLER] Failed to add video track (may already exist):', e);
              }
            }
            
            if (audioTrack) {
              try {
                pc.addTrack(audioTrack, s);
                console.log('[START_MONITOR_HANDLER] Added audio track to peer connection');
              } catch (e) {
                console.warn('[START_MONITOR_HANDLER] Failed to add audio track (may already exist):', e);
              }
            }
          } else {
            console.warn('[START_MONITOR_HANDLER] Could not extract RTCPeerConnection from simple-peer');
          }
        } else {
          console.warn('[START_MONITOR_HANDLER] No peer available to add tracks');
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

      // DO NOT redirect here - monitoring needs to stay connected via the pairing page
      // The timeout will redirect after 25s if no monitoring command is received
      console.log('[START_MONITOR_HANDLER] Monitoring prepared; staying on pairing page to maintain connection');
    } catch (err) {
      const error = err as unknown as { message?: string };
      console.error('[START_MONITOR_HANDLER] Error starting media for monitoring:', err);

      // If permission denied to microphone or camera, publish an event so guardian knows
      try {
        const rid = currentRoomRef.current;
        if (rid) {
          const payload = { guardian_event: { type: 'patient_microphone_permission_denied', message: `Dependent denied microphone or camera permission: ${error?.message || String(err)}`, time: new Date().toISOString() } };
          console.log('[START_MONITOR_HANDLER] Publishing permission denied event:', payload);
          const resp = await fetch(`/api/signaling/${rid}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const json = await resp.json().catch(() => null);
          console.log('[START_MONITOR_HANDLER] Permission denied event response:', resp.status, json);
        }
      } catch (e) {
        console.warn('[START_MONITOR_HANDLER] Failed to publish mic permission denied event', e);
      }
    }
  }, [doRedirectToDashboard]);

  // Poll helpers defined at component scope so they can be accessed in cleanup
  const pollRef = useRef<{ id: number | null }>({ id: null });
  const startPollingForActions = useCallback((room: string) => {
    try {
      if (typeof window === 'undefined') return;
      if (pollRef.current?.id) return; // already polling
      console.log('[POLL] Starting fallback poll for dependent_action');
      pollRef.current.id = window.setInterval(async () => {
        try {
          const r = await fetch(`/api/signaling/${room}`);
          const j = await r.json().catch(() => null);
          const dep = j?.data?.dependent_action;
          const gcmd = j?.data?.guardian_command;
          if (dep || gcmd) {
            console.log('[POLL] Found action via poll', { dependent_action: dep, guardian_command: gcmd });
            try { if (dep) setLastDependentAction(dep); else if (gcmd) setLastDependentAction(gcmd); } catch (e) { console.warn('[POLL] failed to set lastDependentAction', e); }

            // Handle guardian_command (preferred) or dependent_action
            const cmd = gcmd || dep;
            if (cmd === 'start_monitor') {
              try {
                await handleStartMonitoringAction();
              } catch (err) {
                console.warn('[POLL] start_monitor handler failed', err);
              }

              // If this was a guardian_command, clear it so guardian doesn't keep it set
              if (gcmd) {
                try {
                  const rid = room;
                  if (rid) {
                    const clearResp = await fetch(`/api/signaling/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guardian_command: null }) });
                    const clearJson = await clearResp.json().catch(() => null);
                    console.log('[POLL] Cleared guardian_command after handling', clearResp.status, clearJson);
                  }
                } catch (err) { console.warn('[POLL] failed to clear guardian_command', err); }
              }
            }
            if (cmd === 'stop_monitor') {
              try {
                if (streamRef.current) {
                  streamRef.current.getTracks().forEach(t => t.stop());
                  streamRef.current = null;
                  setIsMonitoringActive(false);
                  console.log('Dependent: stopped camera monitoring (via poll)');
                }
                if (gcmd) {
                  const rid = room;
                  if (rid) {
                    const clearResp = await fetch(`/api/signaling/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guardian_command: null }) });
                    const clearJson = await clearResp.json().catch(() => null);
                    console.log('[POLL] Cleared guardian_command after stop_monitor', clearResp.status, clearJson);
                  }
                }
              } catch (err) { console.warn('[POLL] stop_monitor handling failed', err); }
            }
          }
        } catch (e) {
          console.warn('[POLL] poll failed', e);
        }
      }, 2000);
    } catch (e) {
      console.warn('[POLL] startPollingForActions error', e);
    }
  }, [handleStartMonitoringAction]);

  const stopPollingForActions = useCallback(() => {
    try {
      if (pollRef.current?.id) {
        clearInterval(pollRef.current.id);
        pollRef.current.id = null;
        console.log('[POLL] Stopped fallback poll');
      }
    } catch (e) {
      console.warn('[POLL] stopPollingForActions error', e);
    }
  }, []);

  // This is the main pairing function, called by scan or manual input
  const pairDevice = useCallback(async (roomId: string) => {
    if (isPairing || isPaired) return;
    
    console.log(`Attempting to pair with room: ${roomId}`);
    setIsPairing(true);
    
    // Stop the scanner
    scannerRef.current?.clear().catch(e => console.error("Scanner clear failed", e));

    // Check authentication state before starting
    const { data: { session } } = await supabase.auth.getSession();
    console.log('[REALTIME] Current auth session:', { user: session?.user?.id, authenticated: !!session });

    // 1. Get Patient's camera
    // Note: request both video AND audio from the start to avoid renegotiation later
    // (monitoring will enable audio output after guardian requests it)
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        // Show local preview
        if (myVideoRef.current) {
          myVideoRef.current.srcObject = stream;
        }

        // 2. Initialize Peer (as non-initiator)
        const peer = new Peer({
          initiator: false,
          trickle: true,
          stream: stream, // Send our camera stream (audio+video from the start)
          channelConfig: { ordered: false },
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' }
            ]
          }
        });
        peerRef.current = peer;

        // Expose a global helper so other UI (e.g., Dashboard/Bathroom) can trigger a mic test
        try {
          window.__patientMicTest = async () => {
            console.log('[GLOBAL] __patientMicTest called');
            try {
              const peerExists = !!peerRef.current;
              const connected = isPeerConnected();

              // If we don't even have a peer yet, queue until pairing is created
              if (!peerExists) {
                pendingMicTestRef.current = true;
                const status = 'Queued — will run when paired';
                setMicTestStatus(status);
                try { window.dispatchEvent(new CustomEvent('mic-test-status', { detail: { status } })); } catch {}
                console.log('[GLOBAL] __patientMicTest queued until paired (no peer)');
                return true;
              }

              // If peer exists but connection not ready, queue until connection
              if (!connected) {
                pendingMicTestRef.current = true;
                const status = 'Queued — will run when peer connection is established';
                setMicTestStatus(status);
                try { window.dispatchEvent(new CustomEvent('mic-test-status', { detail: { status } })); } catch {}
                console.log('[GLOBAL] __patientMicTest queued until peer connection');
                return true;
              }

              // Otherwise run immediate test
              await testMicNow();
              return true;
            } catch (e) {
              console.warn('[GLOBAL] __patientMicTest failure', e);
              return false;
            }
          };
          // Expose the peer for debug inspection
          window.__patientPeer = peerRef.current;
        } catch (e) {
          console.warn('[GLOBAL] Failed to attach global mic test helper', e);
        }

        // 3. Listen for the Guardian's "offer" via Supabase Realtime and other updates
        currentRoomRef.current = roomId;
        console.log('[REALTIME] Setting up realtime subscription for room:', roomId);
        console.log('[REALTIME] Supabase channel state before subscribe:', supabase.getChannels().length);

        if (channelRef.current) {
          console.log('[REALTIME] Unsubscribing previous channel before creating new one');
          try { channelRef.current.unsubscribe(); } catch (e) { console.warn('[REALTIME] Failed to unsubscribe previous channel', e); }
          channelRetryRef.current = 0; // reset retry counter
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
            (payload: { new: { offer_signal?: unknown; perimeter_json?: string; dependent_action?: string; guardian_command?: string } }) => {
              const offer = payload.new.offer_signal;
              const depAction = payload.new.dependent_action;
              const guardianCmd = (payload.new as { guardian_command?: string }).guardian_command;

              // Always log full payload for debugging cross-device update issues
              console.log('[REALTIME] Dependent received payload update. depAction:', depAction, 'guardianCmd:', guardianCmd, 'payload:', payload.new);

              // Update debug state so the UI shows the last action (helps confirm same room)
              try {
                if (depAction) setLastDependentAction(depAction);
                else if (guardianCmd) setLastDependentAction(guardianCmd);
              } catch (e) { console.warn('[REALTIME] failed to set lastDependentAction', e); }

              // Handle offer signaling
              if (offer && peerRef.current) {
                console.log('Received offer!');
                peerRef.current.signal(offer as Peer.SignalData | string);
              }

              // Handle guardian requested monitoring actions (support guardian_command or dependent_action)
              const cmd = depAction || guardianCmd;
              if (cmd === 'start_monitor') {
                console.log('[START_MONITOR] Guardian requested monitoring. streamRef.current exists?', !!streamRef.current);
                // Delegate to shared handler
                (async () => {
                  try {
                    await handleStartMonitoringAction();
                  } catch (err) {
                    console.error('[START_MONITOR] handler failed', err);
                  }
                })();
              } else if (cmd === 'stop_monitor') {
                if (streamRef.current) {
                  streamRef.current.getTracks().forEach(t => t.stop());
                  streamRef.current = null;
                  setIsMonitoringActive(false);
                  console.log('Dependent: stopped camera monitoring');

                  // clear the dependent_action flag
                  (async () => {
                    try {
                      const rid = currentRoomRef.current;
                      if (rid) {
                        // clear whichever command field triggered this (prefer guardian_command)
                        const clearBody = guardianCmd ? { guardian_command: null } : { dependent_action: null };
                        const clearResp = await fetch(`/api/signaling/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clearBody) });
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
          .subscribe((status: string) => {
            console.log('[REALTIME] Subscription status:', status);
            console.log('[REALTIME] Supabase channels active:', supabase.getChannels().length);
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.error('[REALTIME] CHANNEL_ERROR or TIMED_OUT - subscription failed. Check RLS policies on pairing_rooms table');
              console.error('[REALTIME] Channel state:', channelRef.current?.state);
              const retries = channelRetryRef.current || 0;
              if (retries < MAX_CHANNEL_RETRIES) {
                channelRetryRef.current = retries + 1;
                console.log(`[REALTIME] Retrying subscription (${channelRetryRef.current}/${MAX_CHANNEL_RETRIES}) in 2000ms`);
                setTimeout(() => {
                  try {
                    if (channelRef.current) {
                      channelRef.current.unsubscribe();
                      // attempt to re-subscribe
                      channelRef.current.subscribe();
                    } else {
                      // recreate if missing
                      channelRef.current = supabase.channel(`room-${roomId}`).subscribe();
                    }
                  } catch (e) {
                    console.warn('[REALTIME] Retry subscribe attempt failed', e);
                  }
                }, 2000);
              } else {
                console.error('[REALTIME] Subscription retry limit reached - poll will keep trying as fallback');
              }
            } else if (status === 'SUBSCRIBED') {
              console.log('[REALTIME] Successfully subscribed to realtime updates');
              console.log('[REALTIME] Channel is now listening for UPDATE events on pairing_rooms');
              channelRetryRef.current = 0; // reset on success

              // Start fallback poll in case realtime events are missed
              try {
                startPollingForActions(roomId);
              } catch (e) { console.warn('[POLL] failed to start after subscribe', e); }

            } else if (status === 'CLOSED') {
              console.warn('[REALTIME] Subscription closed - poll continues as fallback');
              // DON'T stop poll here - let it keep running as the primary fallback if realtime fails
            }
          });

        // After subscribing, fetch the current room state in case the guardian already published the offer
        (async () => {
          try {
            const resp = await fetch(`/api/signaling/${roomId}`);
            const json = await resp.json();
            if (!resp.ok) {
              console.warn('Failed to fetch room state', json);
            } else {
              if (json?.data?.offer_signal && peerRef.current) {
                console.log('Fetched existing offer from room state, signaling peer');
                peerRef.current.signal(json.data.offer_signal);
              }

              // If guardian already requested monitoring before we subscribed, handle it now (support guardian_command)
              const initialDep = json?.data?.dependent_action;
              const initialGcmd = json?.data?.guardian_command;
              if (initialDep === 'start_monitor' || initialGcmd === 'start_monitor') {
                console.log('[INIT_FETCH] Found start_monitor in initial fetch (dep or guardian_command), handling it');
                try {
                  try { setLastDependentAction(initialDep || initialGcmd || 'start_monitor'); } catch {}
                  await handleStartMonitoringAction();

                  // If it was guardian_command, clear it now
                  if (initialGcmd) {
                    try {
                      const rid = roomId;
                      if (rid) {
                        const clearResp = await fetch(`/api/signaling/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guardian_command: null }) });
                        const clearJson = await clearResp.json().catch(() => null);
                        console.log('[INIT_FETCH] Cleared guardian_command after handling', clearResp.status, clearJson);
                      }
                    } catch (err) { console.warn('[INIT_FETCH] failed to clear guardian_command', err); }
                  }
                } catch (err) {
                  console.warn('[INIT_FETCH] start_monitor handler failed', err);
                }
              }

              // Ensure fallback poll starts here as well (catch edge case where subscribe event was missed)
              try {
                startPollingForActions(roomId);
              } catch (e) { console.warn('[POLL] failed to start after initial fetch', e); }
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
            const a = answer as Record<string, string | object>;
            const type = (typeof a === 'object' && a !== null && 'type' in a && typeof a.type === 'string') ? a.type : 'signal';
            console.log('Patient: signal event, type', type);

            // If this is an answer with SDP, log m-line count
            const answerToSend = answer;
            if (type === 'answer' && typeof a.sdp === 'string') {
              const answerMCount = (a.sdp.match(/^m=/gm) || []).length;
              console.log('Patient: answer SDP m-line count:', answerMCount);
              // Don't filter SDP - let guardian handle it
              // The issue was that filtering was corrupting the SDP structure
            }

            // If this is a candidate-only signal, merge it into the existing answer_signal stored in DB
            if (type === 'candidate') {
              try {
                const rid = roomId;
                if (!rid) return;
                // fetch current row
                const cur = await fetch(`/api/signaling/${rid}`);
                const curJson = await cur.json().catch(() => null);
                const existing = curJson?.data?.answer_signal;
                const candidateObj = (a as Record<string, unknown>).candidate;

                // Build a merged object that preserves any existing SDP or other metadata
                if (existing) {
                  const prevCandidates = Array.isArray(existing.candidates)
                    ? existing.candidates.slice()
                    : existing.candidate
                      ? [existing.candidate]
                      : [];
                  const merged: Record<string, unknown> = {
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

            // For final answer or other signals, publish the (possibly filtered) answer
            const resp = await fetch(`/api/signaling/${roomId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ answer_signal: answerToSend }),
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
              console.log('[PC_ATTACH] RTCPeerConnection available, attaching handlers');
              console.log('[PC_ATTACH] Initial PC state:', { connectionState: pc.connectionState, iceConnectionState: pc.iceConnectionState, iceGatheringState: pc.iceGatheringState });
              
              pc.oniceconnectionstatechange = () => {
                const iceState = pc.iceConnectionState;
                console.log('[PC_ICE] Patient PC ICE state changed:', iceState);
              };
              
              pc.onconnectionstatechange = () => {
                const connState = pc.connectionState || pc.iceConnectionState;
                console.log('[PC_CONN] Patient PC connection state changed:', connState, '(connectionState:', pc.connectionState, ', iceConnectionState:', pc.iceConnectionState, ')');
                
                // If the underlying RTCPeerConnection reports connected, treat it as paired
                if (connState === 'connected') {
                  console.log('[PC_CONN] RTCPeerConnection CONNECTED — updating UI and redirecting');
                  setIsPairing(false);
                  setIsPaired(true);

                  // If a mic test was queued while waiting for connection, run it now
                  if (pendingMicTestRef.current) {
                    pendingMicTestRef.current = false;
                    console.log('[MIC_TEST] running queued mic test now after PC connected');
                    setMicTestStatus('Running queued mic test...');
                    try { window.dispatchEvent(new CustomEvent('mic-test-status', { detail: { status: 'Running queued mic test...' } })); } catch {}
                    // run without further queuing
                    testMicNow();
                  }

                  // Persist pairing id for other components/tabs
                  try {
                    const rid = currentRoomRef.current || roomId;
                    if (typeof window !== 'undefined' && rid) {
                      window.localStorage.setItem('pairingRoomId', rid);
                      window.dispatchEvent(new CustomEvent('pairing-changed', { detail: { pairingRoomId: rid } }));
                    }
                  } catch (e) {
                    console.warn('Failed to persist pairingRoomId to localStorage (connState)', e);
                  }

                  try {
                    if (!hasRedirectedRef.current) {
                      console.log('[PC_CONN] hasRedirectedRef is false, calling doRedirectToDashboard');
                      doRedirectToDashboard();
                    } else {
                      console.log('[PC_CONN] hasRedirectedRef is already true, skipping redirect');
                    }
                  } catch (err) {
                    console.warn('Router push failed', err);
                  }
                } else if (connState === 'failed') {
                  console.warn('[PC_CONN] RTCPeerConnection entered failed state');
                  // Don't set paired=false yet; allow timeout fallback to redirect
                }
              };

              // Fallback: after 25 seconds, if not yet paired AND not monitoring, redirect anyway
              // (increased from 8s to allow polling time to detect start_monitor command before timeout)
              const timeoutId = setTimeout(() => {
                if (!hasRedirectedRef.current && !isMonitoringActiveDuringPairingRef.current) {
                  console.log('[PC_TIMEOUT] 25s timeout reached without connection; attempting redirect anyway');
                  try {
                    doRedirectToDashboard();
                  } catch (err) {
                    console.warn('[PC_TIMEOUT] Timeout redirect failed', err);
                  }
                } else if (isMonitoringActiveDuringPairingRef.current) {
                  console.log('[PC_TIMEOUT] 25s timeout reached, but monitoring is active - keeping connection alive');
                }
              }, 25000);
            } else {
              console.log('[PC_ATTACH] RTCPeerConnection not yet available, retrying in 200ms');
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
          } catch {
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
          console.log('[PEER_CONNECT] Patient: peer.connect event fired');
          console.log('[PEER_CONNECT] CONNECTED!');
          setIsPairing(false);
          setIsPaired(true);

          // Persist pairing id so other tabs/components can find it (e.g., Water button)
          try {
            const rid = currentRoomRef.current || roomId;
            if (typeof window !== 'undefined' && rid) {
              window.localStorage.setItem('pairingRoomId', rid);
              window.dispatchEvent(new CustomEvent('pairing-changed', { detail: { pairingRoomId: rid } }));
            }
          } catch (e) {
            console.warn('Failed to persist pairingRoomId to localStorage', e);
          }

          try {
            console.log('[PEER_CONNECT] About to redirect to dashboard');
            doRedirectToDashboard();
          } catch (err) {
            console.warn('Router push failed', err);
          }

          // If a local stream was already requested by guardian, attach it to this peer
          if (streamRef.current && peerRef.current) {
            try {
              const s = streamRef.current;
              const maybePeer = peerRef.current as unknown as { addStream?: (s: MediaStream) => void; _pc?: RTCPeerConnection };
              if (typeof maybePeer.addStream === 'function') {
                maybePeer.addStream(s);
              } else {
                const pc = maybePeer._pc;
                if (pc) s.getTracks().forEach(t => pc.addTrack(t, s));
                try { if (pc) console.log('[CONNECT] pc.getSenders after adding pending stream', pc.getSenders().map(sd => ({ trackId: sd.track?.id, kind: sd.track?.kind }))); } catch(err) { console.warn('[CONNECT] failed to log pc.getSenders', err); }
              }
            } catch (err) {
              console.error('Failed to add pending stream on connect', err);
            }
          }
        });

        peer.on('close', () => {
          console.log('Peer connection closed');
          setIsPaired(false);
          try { setIsMonitoringActive(false); } catch {}
          try {
            if (typeof window !== 'undefined') {
              window.localStorage.removeItem('pairingRoomId');
              window.dispatchEvent(new CustomEvent('pairing-changed', { detail: { pairingRoomId: null } }));
            }
          } catch (e) {
            console.warn('Failed to clear pairingRoomId on peer close', e);
          }
          try { delete window.__patientMicTest; delete window.__patientPeer; } catch (err) { console.warn(err); }
        });

      })
      .catch(err => {
        console.error('Failed to get media:', err);
        setIsPairing(false);
      });
    }, [supabase, isPairing, isPaired, doRedirectToDashboard, testMicNow, handleStartMonitoringAction]);

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
        setIsMonitoringActive(false);
      }
      channelRef.current?.unsubscribe();
      peerRef.current?.destroy();
      // Stop poll on cleanup
      try { stopPollingForActions(); } catch (e) { console.warn('[POLL] failed to stop on cleanup', e); }

      try {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('pairingRoomId');
          window.dispatchEvent(new CustomEvent('pairing-changed', { detail: { pairingRoomId: null } }));
        }
      } catch (e) {
        console.warn('Failed to clear pairingRoomId on unmount', e);
      }
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

  const isPeerConnected = () => !!(peerRef.current && ((peerRef.current as unknown as { connected?: boolean }).connected));

  // listen for mic test requests from other components (e.g., Bathroom button)
  useEffect(() => {
    const handler = () => {
      console.log('[MIC_TEST_EVENT] Received dependent-mic-test event');
      testMicNow();
    };
    window.addEventListener('dependent-mic-test', handler as EventListener);
    return () => window.removeEventListener('dependent-mic-test', handler as EventListener);
  }, [testMicNow]);

  // --- RENDER LOGIC ---

  if (isPaired) {
    return (
      <div style={styles.container}>
        <h2 style={styles.title}>Connected</h2>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
          <div><strong>Room:</strong> {currentRoomIdState || currentRoomRef.current || '—'}</div>
          <div><strong>Last action:</strong> {lastDependentAction || '—'}</div>
        </div>
        <div style={{ display: 'flex', gap: 12, width: '100%' }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 'bold' }}>Your Camera (sending)</p>
            <video ref={myVideoRef} autoPlay playsInline muted style={{ width: '100%', background: '#000' }} />

            {/* Visible mic test controls near the camera preview */}
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <button
                onClick={() => { console.log('[UI_BUTTON] Test Microphone clicked (camera area)'); testMicNow(); }}
                disabled={!isPaired}
                title={!isPaired ? 'Pair with a guardian first' : 'Test microphone (will queue until connection)'}
                style={{ padding: '8px 12px', fontWeight: 'bold', backgroundColor: '#f97316', color: 'white', border: 'none', borderRadius: 6, cursor: isPaired ? 'pointer' : 'not-allowed', opacity: isPaired ? 1 : 0.6 }}
              >
                Test Microphone
              </button>

              {/* Debug: Force test regardless of connection (visible in dev only) */}
              {process.env.NODE_ENV === 'development' && (
                <button
                  onClick={() => { console.log('[DEBUG] Force Test Microphone clicked'); testMicNow(); }}
                  title="Force test (debug)"
                  style={{ padding: '8px 12px', fontWeight: 'bold', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                >
                  Force Test (debug)
                </button>
              )}

              <div style={{ fontSize: 12, color: '#444' }}>{micTestStatus || (isPeerConnected() ? 'No recent test' : 'Waiting for connection...')}</div>
            </div>
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
          <button
            onClick={testMicNow}
            disabled={!isPaired}
            title={!isPaired ? 'Pair with a guardian first' : 'Test microphone (will queue until connection)'}
            style={{ flex: 1, padding: 10, fontWeight: 'bold', backgroundColor: '#f97316', color: 'white', border: 'none', borderRadius: 6, cursor: isPaired ? 'pointer' : 'not-allowed', opacity: isPaired ? 1 : 0.6 }}
          >
            Test Mic
          </button>
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
        <div><strong>Room:</strong> {currentRoomIdState || currentRoomRef.current || '—'}</div>
        <div><strong>Last action:</strong> {lastDependentAction || '—'}</div>
      </div>
      
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
          {process.env.NODE_ENV === 'development' && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const rid = currentRoomRef.current || (manualRoomId && manualRoomId.trim()) || null;
                  if (!rid) {
                    console.warn('[DEV] No room id available to force start monitoring');
                    return;
                  }
                  currentRoomRef.current = rid;
                  try { setCurrentRoomIdState(rid); } catch {}
                  console.log('[DEV] Forcing start_monitor handler (dev) for room', rid);
                  await handleStartMonitoringAction();
                } catch (e) {
                  console.error('[DEV] Force start failed', e);
                }
              }}
              style={{ marginLeft: 8, padding: '14px', backgroundColor: '#f59e0b', color: 'white', border: 'none', borderRadius: '8px' }}
            >
              Force Start Monitor (dev)
            </button>
          )}
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