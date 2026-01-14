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

  // Robust redirect helper: attempt redirect unless already on dashboard, with guarded retries
  const doRedirectToDashboard = useCallback((delay = 0) => {
    try {
      // If we're already on the dashboard, skip redirect
      const alreadyOnDashboard = typeof window !== 'undefined' && window.location && typeof window.location.pathname === 'string' && window.location.pathname.startsWith('/client/dashboard');
      if (alreadyOnDashboard) {
        console.log('[REDIRECT] Already on dashboard; skipping redirect');
        return;
      }

      // Track simple attempt counter on window to avoid infinite retries across calls
      const attemptsKey = '__doRedirectAttempts';
      const w = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : undefined;
      const attempts = (w && typeof w[attemptsKey] === 'number') ? (w[attemptsKey] as number) : 0;
      if (attempts >= 3) {
        console.warn('[REDIRECT] Max redirect attempts reached; aborting');
        return;
      }
      if (typeof window !== 'undefined') (window as unknown as Record<string, number>)[attemptsKey] = attempts + 1;

      // Try router.push first, fallback to location.href. We still set hasRedirectedRef after scheduling.
      if (router && typeof (router as unknown as { push?: (url: string) => unknown }).push === 'function') {
        setTimeout(() => {
          try {
            (router as unknown as { push?: (url: string) => void }).push?.('/client/dashboard');
          } catch (e) {
            console.warn('[REDIRECT] router.push failed, falling back to location.href', e);
            try { window.location.href = '/client/dashboard'; } catch (err) { console.warn('[REDIRECT] fallback failed', err); }
          }
        }, delay);
      } else {
        setTimeout(() => {
          try { window.location.href = '/client/dashboard'; } catch (err) { console.warn('[REDIRECT] location.href redirect failed', err); }
        }, delay);
      }

      // mark that we've attempted at least one redirect
      hasRedirectedRef.current = true;
    } catch (err) {
      console.warn('[REDIRECT] unexpected error while redirecting', err);
      try { window.location.href = '/client/dashboard'; } catch (err2) { console.warn('[REDIRECT] fallback failed again', err2); }
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
      if (!streamRef.current) {
        console.log('[START_MONITOR_HANDLER] Calling getUserMedia for audio+video');
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

        if (peerRef.current) {
          try {
            console.log('[START_MONITOR_HANDLER] Adding stream to peer connection');
            const peer = peerRef.current as unknown as { addStream?: (s: MediaStream) => void; _pc?: RTCPeerConnection };
            if (typeof peer.addStream === 'function') {
              peer.addStream(s);
              console.log('[START_MONITOR_HANDLER] Added stream via addStream()');
            } else {
              const pc = peer._pc;
              if (pc) {
                s.getTracks().forEach(t => {
                  pc.addTrack(t, s);
                  console.log('[START_MONITOR_HANDLER] Added track to peer:', t.kind);
                });
                try { console.log('[START_MONITOR_HANDLER] RTCPeerConnection senders after add:', pc.getSenders().map(sd => ({ trackId: sd.track?.id, kind: sd.track?.kind }))); } catch (e) { console.warn('[START_MONITOR_HANDLER] Failed to log PC senders', e); }
              }
            }
          } catch (err) {
            console.error('[START_MONITOR_HANDLER] Failed to add stream to peer', err);
          }
        } else {
          console.warn('[START_MONITOR_HANDLER] peerRef.current is not set, cannot add stream');
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

      try {
        // Redirect dependent to the dashboard so the monitoring UI is shown
        doRedirectToDashboard(500);
      } catch (e) {
        console.warn('Failed to redirect to dashboard on start_monitor', e);
      }
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
        
        // Add a short-poll fallback in case realtime events are missed (e.g., cross-device or mobile edge cases)
        const pollRef = { id: null as number | null };
        const startPollingForActions = (room: string) => {
          try {
            if (typeof window === 'undefined') return;
            if (pollRef.id) return; // already polling
            console.log('[POLL] Starting fallback poll for dependent_action');
            pollRef.id = window.setInterval(async () => {
              try {
                const r = await fetch(`/api/signaling/${room}`);
                const j = await r.json().catch(() => null);
                const dep = j?.data?.dependent_action;
                if (dep) {
                  console.log('[POLL] Found dependent_action via poll', dep);
                  try { setLastDependentAction(dep); } catch (e) { console.warn('[POLL] failed to set lastDependentAction', e); }
                  if (dep === 'start_monitor') {
                    try {
                      await handleStartMonitoringAction();
                    } catch (err) {
                      console.warn('[POLL] start_monitor handler failed', err);
                    }
                  }
                }
              } catch (e) {
                console.warn('[POLL] poll failed', e);
              }
            }, 2000);
          } catch (e) {
            console.warn('[POLL] startPollingForActions error', e);
          }
        };
        const stopPollingForActions = () => {
          try {
            if (pollRef.id) {
              clearInterval(pollRef.id);
              pollRef.id = null;
              console.log('[POLL] Stopped fallback poll');
            }
          } catch (e) {
            console.warn('[POLL] stopPollingForActions error', e);
          }
        };

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

              // Always log full payload for debugging cross-device update issues
              console.log('[REALTIME] Dependent received payload update. depAction:', depAction, 'payload:', payload.new);

              // Update debug state so the UI shows the last action (helps confirm same room)
              try {
                if (depAction) {
                  setLastDependentAction(depAction);
                }
              } catch (e) { console.warn('[REALTIME] failed to set lastDependentAction', e); }

              // Handle offer signaling
              if (offer && peerRef.current) {
                console.log('Received offer!');
                peerRef.current.signal(offer as Peer.SignalData | string);
              }

              // Handle guardian requested monitoring actions
              if (depAction === 'start_monitor') {
                console.log('[START_MONITOR] Guardian requested monitoring. streamRef.current exists?', !!streamRef.current);
                // Delegate to shared handler
                (async () => {
                  try {
                    await handleStartMonitoringAction();
                  } catch (err) {
                    console.error('[START_MONITOR] handler failed', err);
                  }
                })();
              } else if (depAction === 'stop_monitor') {
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
          .subscribe((status: string) => {
            console.log('[REALTIME] Subscription status:', status);
            console.log('[REALTIME] Supabase channels active:', supabase.getChannels().length);
            if (status === 'CHANNEL_ERROR') {
              console.error('[REALTIME] CHANNEL_ERROR - subscription failed. Check RLS policies on pairing_rooms table');
              console.error('[REALTIME] Channel state:', channelRef.current?.state);
              const retries = channelRetryRef.current || 0;
              if (retries < MAX_CHANNEL_RETRIES) {
                channelRetryRef.current = retries + 1;
                console.log(`[REALTIME] Retrying subscription (${channelRetryRef.current}/${MAX_CHANNEL_RETRIES}) in 1000ms`);
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
                }, 1000);
              } else {
                console.error('[REALTIME] Subscription retry limit reached');
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
              console.warn('[REALTIME] Subscription closed');
              try { stopPollingForActions(); } catch (e) { console.warn('[POLL] failed stop on close', e); }
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

              // If guardian already requested monitoring before we subscribed, handle it now
              if (json?.data?.dependent_action === 'start_monitor') {
                console.log('[INIT_FETCH] Found dependent_action=start_monitor in initial fetch, handling it');
                try {
                  try { setLastDependentAction('start_monitor'); } catch {}
                  await handleStartMonitoringAction();
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

            // For final answer or other signals, publish as before
            // Add m-line count diagnostics for debugging mismatched m-lines with guardian
            try {
              const sdp = (a && typeof a.sdp === 'string') ? a.sdp : null;
              if (sdp) {
                const answerMCount = (sdp.match(/^m=/gm) || []).length;
                console.log('Patient: answer m-line count', answerMCount);
                // also attempt to log offer m-line count if we have it
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
            } catch {
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
                const connState = pc.connectionState || pc.iceConnectionState;
                console.log('Patient PC connection state:', connState);
                // If the underlying RTCPeerConnection reports connected, treat it as paired
                if (connState === 'connected') {
                  console.log('RTCPeerConnection connected — updating UI and redirecting');
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
                      doRedirectToDashboard();
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
          console.log('Patient: peer.connect event');
          console.log('CONNECTED!');
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