"use client";

import React, { useRef, useState, useEffect, useMemo } from "react";
import { useAudio } from '@/hooks/useAudio';
import QRCode from "react-qr-code";
import Peer from "simple-peer";
import MonitoringSystem from "@/app/admin/components/MonitoringSystem";
import { v4 as uuidv4 } from "uuid";
import { createClient } from "@/lib/supabase/client";
import { RealtimeChannel } from '@supabase/supabase-js';

type Props = {
  onRoomCreated?: (id: string) => void;
  onPairingComplete?: () => void;
};

export default function GuardianPairing({ onRoomCreated, onPairingComplete }: Props) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isPaired, setIsPaired] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isMonitoring, setIsMonitoring] = useState<boolean>(false);
  const peerRef = useRef<Peer.Instance | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const answerPollRef = useRef<number | null>(null); // interval id for polling answer as a fallback
  const hasStartedPollingRef = useRef(false);
  // Track whether an answer SDP has already been applied to avoid duplicate signaling
  const hasAppliedAnswerRef = useRef(false);
  const lastAppliedAnswerSdpRef = useRef<string | null>(null);
  // Guard to avoid applying the same answer concurrently (poll vs realtime)
  const applyingAnswerRef = useRef(false);
  const [remoteStreamState, setRemoteStreamState] = useState<MediaStream | null>(null);
  const [showMonitoring, setShowMonitoring] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [localCameraActive, setLocalCameraActive] = useState(false);
  const [localCameraError, setLocalCameraError] = useState<string | null>(null);
  const hasAddedRecvTransceiverRef = useRef(false); // avoid duplicate recv transceiver additions

  // Mic test diagnostics: timestamp (ms) when dependent requested a mic test
  const [micTestRequestAt, setMicTestRequestAt] = useState<number | null>(null);
  // UI indicators: whether a mic test was recently requested and whether audio was received as part of a mic test
  const [micTestRequested, setMicTestRequested] = useState<boolean>(false);
  const [micTestAudioReceived, setMicTestAudioReceived] = useState<boolean>(false);

  const startLocalCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = s;
      setLocalCameraActive(true);
      setLocalCameraError(null);
      if (localVideoRef.current) localVideoRef.current.srcObject = s;

      // If peer already exists, attach tracks
      if (peerRef.current) {
        try {
          if (typeof (peerRef.current as any).addStream === 'function') {
            (peerRef.current as any).addStream(s);
            console.log('Guardian: added local stream via addStream');
          } else {
            const pc = (peerRef.current as unknown as { _pc?: RTCPeerConnection })?._pc;
            if (pc) {
              s.getTracks().forEach((t) => pc.addTrack(t, s));
              console.log('Guardian: added local tracks to underlying RTCPeerConnection');
              try { console.log('Guardian PC transceivers after addTrack:', pc.getTransceivers ? pc.getTransceivers() : []); } catch (e) {}
            }
          }
        } catch (e) {
          console.warn('Guardian: failed to attach local stream to peer', e);
        }
      }
    } catch (err: any) {
      console.warn('Guardian: failed to enable local camera', err);
      setLocalCameraError(String(err?.message || err));
      setLocalCameraActive(false);
    }
  };

  // Send a start/stop monitoring request to the dependent by patching the pairing row
  const sendMonitoringRequest = async (start: boolean) => {
    console.log('[GUARDIAN] sendMonitoringRequest called with start:', start, 'roomId:', roomId);
    if (!roomId) {
      console.warn('[GUARDIAN] sendMonitoringRequest: roomId is not set, returning');
      return;
    }

    // Show the monitoring UI immediately so guardian can set perimeter / recalibrate even if dependent stream hasn't arrived
    if (start) {
      try { setShowMonitoring(true); } catch (e) { console.warn('[GUARDIAN] failed to set showMonitoring early', e); }
    }

    try {
      const action = start ? 'start_monitor' : 'stop_monitor';
      console.log('[GUARDIAN] Sending monitoring request:', action, 'to room:', roomId);
      const resp = await fetch(`/api/signaling/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependent_action: action }),
      });
      const json = await resp.json().catch(() => null);
      console.log('[GUARDIAN] Monitoring request response:', { status: resp.status, action, ok: resp.ok, json });
      if (!resp.ok) {
        console.error('[GUARDIAN] Failed to send monitoring request', json);
        return;
      }
      console.log('[GUARDIAN] Monitoring request succeeded:', action, json?.data || json);
      setIsMonitoring(start);
    } catch (err) {
      console.error('[GUARDIAN] Failed to send monitoring request (exception)', err);
    }
  };

  useEffect(() => {
    try {
      console.log('[DBG] GuardianPairing mounted');
    } catch {
      // noop
    }
  }, []);

  const supabase = useMemo(() => createClient(), []);
  const { initAudio, playSound } = useAudio(isMuted);

  // If a dependent triggers an action while guardian UI is not showing monitoring,
  // auto-open monitoring and audibly notify the guardian (best-effort).
  useEffect(() => {
    if (!roomId) return;
    const channel = supabase
      .channel(`room-action-${roomId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pairing_rooms', filter: `id=eq.${roomId}` },
        (payload: { new: { dependent_action?: string } }) => {
          try {
            const dep = payload.new.dependent_action;
            console.log('GuardianPairing: received dependent_action', dep);
            if (dep) {
              try { setShowMonitoring(true); } catch {}

              (async () => {
                try {
                  await initAudio();
                  if (dep === 'sos') playSound('sos');
                  else if (dep === 'bathroom') playSound('bathroom');
                  else playSound('sound');
                } catch (e) {
                  console.warn('GuardianPairing: failed to play notification sound', e);
                }
              })();
            }
          } catch (e) {
            console.warn('GuardianPairing: failed processing dependent_action realtime', e);
          }
        }
      )
      .subscribe();

    return () => { try { channel.unsubscribe(); } catch {} };
  }, [roomId, supabase, initAudio, playSound]);

  const createRoom = async () => {
    if (isWaiting) return;
    const id = uuidv4();
    setRoomId(id);
    if (onRoomCreated) onRoomCreated(id);
    setIsWaiting(true);

    // Do NOT get guardian camera automatically at room creation to avoid prompting permissions.
    // The guardian can enable their local camera manually after the room is created.
    let localStream: MediaStream | undefined = undefined;
    streamRef.current = null;
    // clear any previous camera error
    setErrorMsg(null);

    // Create the room record first (with empty signals) so dependent can find it
    try {
      const resp = await fetch('/api/signaling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        console.error('Failed to create room via API', json);
        setErrorMsg(json?.error || 'Failed to create pairing room');
        setIsWaiting(false);
        return;
      }
      console.log('Room created via API:', id, json.data);
      setErrorMsg(null);
    } catch (err) {
      console.error('Failed to create room (exception)', err);
      setErrorMsg(String(err));
      setIsWaiting(false);
      return;
    }



    const peer = new Peer({
      initiator: true,
      trickle: true,
      stream: localStream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      }
    });
    peerRef.current = peer;

    peer.on("signal", async (offer: unknown) => {
      try {
        console.log('Guardian: signal payload', offer);
        // Determine a short descriptor for logging
        let desc = 'signal';
        if (offer && typeof offer === 'object') {
          const o = offer as Record<string, unknown>;
          if (typeof o['type'] === 'string') desc = o['type'] as string;
          else if (o['candidate']) desc = 'candidate';
        }
        console.log('Guardian: signal event (desc)', desc);

        // Only persist initial SDP offer to DB to avoid it being overwritten by later candidate-only signals
        const isOffer = !!(offer && typeof offer === 'object' && (offer as Record<string, unknown>)['type'] === 'offer');
        if (!isOffer) {
          console.log('Guardian: skipping DB PATCH for non-offer signal to avoid overwriting offer', desc);
        } else {
          console.log('Guardian: sending offer (persisting to DB)');
          const resp = await fetch(`/api/signaling/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ offer_signal: offer }),
          });
          const json = await resp.json().catch(() => null);
          console.log('Guardian: publish offer response', resp.status, json);
          if (!resp.ok) {
            console.error('Failed to publish offer via API', json);
            return;
          }
          console.log('Offer published to pairing_rooms via API', id, json?.data);

          // Start a fallback poll to detect answers in case realtime subscriptions miss the update
          if (!hasStartedPollingRef.current) {
            hasStartedPollingRef.current = true;
            answerPollRef.current = window.setInterval(async () => {
              try {
                const resp = await fetch(`/api/signaling/${id}`);
                const js = await resp.json().catch(() => null);
                console.log('Guardian: poll for answer response', resp.status, js);
                if (resp.ok && js?.data?.answer_signal && peerRef.current) {
                  const ans = js.data.answer_signal;
                  // Prefer applying only when an SDP string is present to avoid applying empty 'answer' objects
                  const hasSdp = !!(ans && typeof ans.sdp === 'string' && ans.sdp.length > 0);
                  if (hasSdp) {
                    const sdp = ans.sdp as string;
                    // Only attempt to apply if not already applying or applied
                    if ((!hasAppliedAnswerRef.current && !applyingAnswerRef.current) || (sdp && lastAppliedAnswerSdpRef.current !== sdp && !applyingAnswerRef.current)) {
                      applyingAnswerRef.current = true;
                      try {
                        console.log('Guardian: found answer via poll (sdp present), signaling peer', ans);

                        // If the answer includes a transceiver request for video, attempt to add a recvonly transceiver
                        try {
                          const pc = (peerRef.current as unknown as { _pc?: RTCPeerConnection })?._pc;
                          const req = (ans && (ans.transceiverRequest || (Array.isArray(ans.transceiverRequests) ? ans.transceiverRequests[0] : null)));
                          if (pc && req && (req.kind === 'video' || req.kind === 'audio')) {
                            console.log('Guardian: answer requests transceiver for', req.kind, ', adding recvonly transceiver on PC');
                            if (typeof pc.addTransceiver === 'function') {
                              try {
                                pc.addTransceiver(req.kind, { direction: 'recvonly' });
                                console.log(`Guardian: added recvonly ${req.kind} transceiver`);
                              } catch (e) {
                                console.warn('Guardian: addTransceiver failed for', req.kind, e);
                              }
                            }
                          }
                        } catch (e) {
                          console.warn('Guardian: failed to add recv transceiver', e);
                        }

                        peerRef.current.signal(ans);
                        hasAppliedAnswerRef.current = true;
                        lastAppliedAnswerSdpRef.current = sdp;
                      } catch (err) {
                        console.warn('Guardian: failed to apply polled answer', err);
                      } finally {
                        applyingAnswerRef.current = false;
                      }
                    } else {
                      console.log('Guardian: polled answer SDP already applied or is being applied, will process candidates only', ans.candidates || ans.candidate);
                    }

                    // Also apply any candidates included in the update (do not reapply full answer if SDP is same)
                    const candidates = ans.candidates || ans.candidate ? (ans.candidates || [ans.candidate]) : [];
                    if (Array.isArray(candidates) && candidates.length > 0) {
                      candidates.forEach((c: any) => {
                        try {
                          peerRef.current?.signal({ type: 'candidate', candidate: c });
                        } catch (e) {
                          console.warn('Failed to signal candidate from poll', e);
                        }
                      });
                    }

                    // We can stop polling after we've applied the answer + candidates
                    if (answerPollRef.current && hasAppliedAnswerRef.current) {
                      clearInterval(answerPollRef.current);
                      answerPollRef.current = null;
                    }
                  } else {
                    console.log('Guardian: poll found only candidates or transceiver requests (no sdp yet), continuing to poll and will apply once answer SDP appears', ans);
                    // continue polling
                  }
                }
              } catch (err) {
                console.warn('Guardian: poll for answer failed', err);
              }
            }, 1000);
          }
        }      } catch (err) {
        console.error('Failed to publish offer (exception)', err);
      }
    });

    peer.on('error', (err) => {
      console.error('Guardian peer error', err);
      // If this looks like the m-line order mismatch, fetch and log offer/answer m-line counts to help debugging
      try {
        const msg = err && err.toString ? err.toString() : String(err);
        if (msg.includes('order of m-lines')) {
          (async () => {
            try {
              const resp = await fetch(`/api/signaling/${id}`);
              const js = await resp.json().catch(() => null);
              console.warn('Guardian: m-line mismatch detected. Current room state:', js?.data || js);
              const offer = js?.data?.offer_signal;
              const answer = js?.data?.answer_signal;
              const ocount = offer && typeof offer.sdp === 'string' ? (offer.sdp.match(/^m=/gm) || []).length : null;
              const acount = answer && typeof answer.sdp === 'string' ? (answer.sdp.match(/^m=/gm) || []).length : null;
              console.warn('Guardian: offer m-lines:', ocount, 'answer m-lines:', acount);
            } catch (e) {
              console.warn('Guardian: failed fetching room state for m-line diagnostic', e);
            }
          })();
        }
      } catch (e) {
        // noop
      }
    });

    // Attach connection state logging if underlying RTCPeerConnection is available
    peer.on('connect', () => {
      console.log('Guardian: peer.connect event');
    });

    // Attach RTCPeerConnection handlers when the underlying PC becomes available (polling once)
    const attachPcHandlers = (p: Peer.Instance) => {
      const tryAttach = () => {
        const pc = (p as unknown as { _pc?: RTCPeerConnection })?._pc;
        if (pc) {
          pc.oniceconnectionstatechange = () => console.log('Guardian PC ICE state:', pc.iceConnectionState);
          pc.onconnectionstatechange = () => {
            const connState = (pc as any).connectionState || pc.iceConnectionState;
            console.log('Guardian PC connection state:', connState);
          };

          try {
            pc.onicecandidate = (evt: any) => console.log('Guardian PC onicecandidate', evt && evt.candidate);
          } catch (e) {}

          try {
            console.log('Guardian PC transceivers at attach:', pc.getTransceivers ? pc.getTransceivers() : []);
          } catch (e) {}

          // If the guardian has no local camera active, proactively add a recvonly transceiver
          try {
            if (!localCameraActive && typeof pc.addTransceiver === 'function' && !hasAddedRecvTransceiverRef.current) {
              try {
                // Add both video and audio recvonly transceivers so the dependent can send audio later when monitoring starts
                pc.addTransceiver('video', { direction: 'recvonly' });
                pc.addTransceiver('audio', { direction: 'recvonly' });
                console.log('Guardian: proactively added recvonly video and audio transceivers at attach');
                hasAddedRecvTransceiverRef.current = true;
                try { console.log('Guardian PC transceivers after proactive add:', pc.getTransceivers ? pc.getTransceivers() : []); } catch (e) {}
              } catch (e) {
                console.warn('Guardian: failed to proactively add recv transceivers', e);
              }
            }
          } catch (e) {}

          // Fallback: listen for individual track events and build a MediaStream if simple-peer 'stream' doesn't fire
          try {
            pc.ontrack = (ev: any) => {
              try {
                console.log('Guardian PC ontrack event (raw):', ev);
                console.log('[MIC_TEST] ontrack: track info:', { kind: ev.track?.kind, id: ev.track?.id, label: ev.track?.label });
                if (Array.isArray(ev.streams) && ev.streams.length) {
                  console.log('[MIC_TEST] ontrack: streams present count:', ev.streams.length);
                  ev.streams.forEach((st: MediaStream, idx: number) => {
                    console.log(`[MIC_TEST] ontrack: stream[${idx}] audioTracks:`, st.getAudioTracks().map(t => ({ id: t.id, label: t.label, enabled: t.enabled })));
                  });
                } else {
                  console.log('[MIC_TEST] ontrack: no streams array, falling back to ev.track');
                }

                const tracks = Array.isArray(ev.streams) && ev.streams.length ? ev.streams[0].getTracks() : (ev.track ? [ev.track] : []);
                const ms = new MediaStream();
                tracks.forEach((t: MediaStreamTrack) => ms.addTrack(t));
                console.log('[MIC_TEST] constructed fallback MediaStream audioTracks:', ms.getAudioTracks().map(t => ({ id: t.id, label: t.label, enabled: t.enabled })));

                if (micTestRequestAt) console.log('[MIC_TEST] ontrack arrived AFTER mic test request at', new Date(micTestRequestAt).toISOString());

                // If the constructed MediaStream has audio tracks, mark audio-received
                try {
                  const audioCount = ms.getAudioTracks().length;
                  if (audioCount > 0) {
                    setMicTestAudioReceived(true);
                    setTimeout(() => setMicTestAudioReceived(false), 8000);
                    console.log('[MIC_TEST] Guardian: ontrack produced a MediaStream with audio tracks; set micTestAudioReceived=true');
                  }
                } catch (e) { console.warn('[MIC_TEST] failed to check constructed MediaStream for audio tracks', e); }

                setRemoteStreamState(ms);
                setTimeout(() => setShowMonitoring(true), 150);
              } catch (e) {
                console.warn('Guardian PC ontrack handler failed', e);
              }
            };
          } catch (e) {}
        } else {
          setTimeout(tryAttach, 200);
        }
      };
      tryAttach();
    };
    attachPcHandlers(peer);

    // Listen for answer signal updates
    channelRef.current = supabase
      .channel(`room-${id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "pairing_rooms",
          filter: `id=eq.${id}`,
        },
        (payload: { new: { answer_signal?: any; guardian_event?: any } }) => {
          // Detect guardian_event messages published by the dependent (e.g., mic test start, mic unavailable, permission denied)
          try {
            const ge = payload.new.guardian_event;
            if (ge) {
              console.log('[REALTIME] guardian_event received:', ge);
              if (ge && ge.type === 'patient_mic_test_start') {
                setMicTestRequestAt(Date.now());
                setMicTestRequested(true);
                // reset audio received indicator when a new test starts
                setMicTestAudioReceived(false);
                console.log('[MIC_TEST] Guardian: detected patient_mic_test_start at', new Date().toISOString(), ge);
                // Auto-clear the requested indicator after 8 seconds
                try { setTimeout(() => setMicTestRequested(false), 8000); } catch {}
              }
              if (ge && ge.type === 'patient_microphone_unavailable') {
                console.warn('[MIC_TEST] Guardian: dependent reported microphone unavailable', ge);
              }
            }
          } catch (e) {
            console.warn('Failed to process guardian_event in realtime payload', e);
          }

          const answer = payload.new.answer_signal;
          if (!answer || !peerRef.current) return;

          try {
            // If answer contains an 'sdp' (type === 'answer') signal it first
            if (answer.type === 'answer' || answer.sdp) {
              const sdp = answer.sdp as string | undefined;
              if ((!hasAppliedAnswerRef.current && !applyingAnswerRef.current) || (sdp && lastAppliedAnswerSdpRef.current !== sdp && !applyingAnswerRef.current)) {
                applyingAnswerRef.current = true;
                console.log('Received full answer via realtime, signaling peer');
                try {
                  // If the answer requests a transceiver for video, add a recvonly transceiver before signaling (if possible)
                  try {
                    const pc = (peerRef.current as unknown as { _pc?: RTCPeerConnection })?._pc;
                    const req = (answer && (answer.transceiverRequest || (Array.isArray(answer.transceiverRequests) ? answer.transceiverRequests[0] : null)));
                    if (pc && req && (req.kind === 'video' || req.kind === 'audio')) {
                      console.log('Guardian: realtime answer requests transceiver for', req.kind, ', adding recvonly transceiver');
                      if (typeof pc.addTransceiver === 'function') {
                        try {
                          pc.addTransceiver(req.kind, { direction: 'recvonly' });
                          console.log(`Guardian: added recvonly ${req.kind} transceiver (realtime)`);
                        } catch (e) {
                          console.warn('Guardian: addTransceiver failed (realtime) for', req.kind, e);
                        }
                      }
                    }
                  } catch (e) {
                    console.warn('Guardian: failed to add recv transceiver (realtime)', e);
                  }

                } catch (e) {
                  console.warn('Failed to signal full answer via realtime', e);
                } finally {
                  applyingAnswerRef.current = false;
                }
              } else {
                console.log('Realtime: answer SDP already applied or being applied, will only apply candidates if present');
              }

              // if candidates array present, signal them after a tiny delay
              const candidates = answer.candidates || answer.candidate ? (answer.candidates || [answer.candidate]) : [];
              if (Array.isArray(candidates) && candidates.length > 0) {
                setTimeout(() => {
                  candidates.forEach((c: any) => {
                    try {
                      peerRef.current?.signal({ type: 'candidate', candidate: c });
                    } catch (e) {
                      console.warn('Failed to signal candidate', e);
                    }
                  });
                }, 50);
              }
            } else if (answer.type === 'candidates' && Array.isArray(answer.candidates)) {
              console.log('Received candidates array via realtime');

              // If a transceiverRequest accompanies candidates, attempt to add a recvonly transceiver early
              try {
                const req = (answer && (answer.transceiverRequest || (Array.isArray(answer.transceiverRequests) ? answer.transceiverRequests[0] : null)));
                const pc = (peerRef.current as unknown as { _pc?: RTCPeerConnection })?._pc;
                if (pc && req && (req.kind === 'video' || req.kind === 'audio') && !hasAddedRecvTransceiverRef.current) {
                  try {
                    if (typeof pc.addTransceiver === 'function') {
                      pc.addTransceiver(req.kind, { direction: 'recvonly' });
                      console.log(`Guardian: added recvonly ${req.kind} transceiver (realtime candidates)`);
                      hasAddedRecvTransceiverRef.current = true;
                    }
                  } catch (e) {
                    console.warn('Guardian: failed to add recv transceiver (realtime candidates)', e);
                  }
                }
              } catch (e) {}

              answer.candidates.forEach((c: any) => peerRef.current?.signal({ type: 'candidate', candidate: c }));
            } else {
              // fallback: single candidate or other signals
              console.log('Received signal via realtime, passing through', answer.type || 'signal');
              try {
                peerRef.current.signal(answer as Peer.SignalData | string);
              } catch (e) {
                console.warn('Failed to signal runtime fallback signal', e);
              }
            }
          } catch (err) {
            console.error('Failed to apply incoming answer_signal', err);
          }
        }
      )
      .subscribe();

    peer.on("connect", () => {
      console.log("Guardian connected to patient");
      setIsWaiting(false);
      setIsPaired(true);
      if (onPairingComplete) onPairingComplete();
    });



    peer.on("stream", (stream: MediaStream) => {
      try {
        console.log('Guardian: got remote stream', 'audioTracks:', stream.getAudioTracks().length, stream.getAudioTracks());
        console.log('[MIC_TEST] remote stream audio track details:', stream.getAudioTracks().map(t => ({ id: t.id, label: t.label, enabled: t.enabled })));
        if (micTestRequestAt) console.log('[MIC_TEST] remote stream arrived AFTER mic test request at', new Date(micTestRequestAt).toISOString());
        // If we received audio tracks, mark the mic-test audio-received indicator
        try {
          const audioCount = stream.getAudioTracks().length;
          if (audioCount > 0) {
            setMicTestAudioReceived(true);
            // auto-clear after 8s
            setTimeout(() => setMicTestAudioReceived(false), 8000);
            console.log('[MIC_TEST] Guardian: remote stream contains audio tracks; set micTestAudioReceived=true');
          }
        } catch (e) { console.warn('[MIC_TEST] failed to check audio tracks on remote stream', e); }
      } catch (e) { console.warn('Guardian: failed to log remote stream details', e); }

      // Do not attach directly to the pairing's remoteVideo element to avoid
      // conflicting load/play requests. Attach the stream via state and let
      // MonitoringSystem attach it to its own video element instead.
      setRemoteStreamState(stream);
      // small delay so the remote video can attach before showing the monitoring UI
      setTimeout(() => setShowMonitoring(true), 150);
    });

    peer.on("close", () => {
      console.log("Peer closed");
      cleanup();
    });
  };

  const cleanup = async () => {
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    if (channelRef.current) {
      try {
        await channelRef.current.unsubscribe();
      } catch {}
      channelRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (roomId) {
      try {
        await fetch(`/api/signaling/${roomId}`, { method: 'DELETE' });
      } catch (err) {
        console.warn('Failed to delete pairing_rooms row (exception)', err);
      }
    }
    setRoomId(null);
    setIsWaiting(false);
    setIsPaired(false);
  };

  useEffect(() => {
    return () => {
      // Clear any polling interval on unmount
      if (answerPollRef.current) {
        clearInterval(answerPollRef.current);
        answerPollRef.current = null;
      }
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-4 border rounded-md bg-white shadow-md flex flex-col">
      <div className="flex justify-between items-center mb-2">
      <h3 className="font-semibold text-xl">Guardian Pairing</h3>
      {!roomId && (
        <button
        className="bg-blue-600 text-white px-4 py-2 rounded cursor-pointer hover:bg-blue-700"
        onClick={createRoom}
        >
        Create Pairing Room
        </button>
      )}
      </div>

      {roomId && !isPaired && !showMonitoring ? (
        <div className="mt-4 space-y-4">
          {/* Room ID Display Section */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
            <p className="text-sm font-medium text-gray-700 mb-2">Room ID</p>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <div className="font-mono text-lg font-semibold text-blue-700 break-all flex-1">{roomId}</div>
              <div className="flex gap-2 mt-2 sm:mt-0">
                <button
                  className="w-full sm:w-auto bg-blue-500 text-white px-4 py-2 rounded-lg cursor-pointer hover:bg-blue-600 transition-colors font-medium text-sm"
                  onClick={() => navigator.clipboard.writeText(roomId)}
                >
                  Copy ID
                </button>
              </div>
            </div>
            {errorMsg && <p className="text-sm text-red-600 mt-2">Error: {errorMsg}</p>}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="flex flex-col items-center justify-center p-4 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-sm font-semibold text-gray-700 mb-3">Scan with dependent</p>
              <div className="bg-white p-3 rounded-lg shadow-sm">
                <QRCode value={roomId} size={150} />
              </div>
            </div>

            <div className="flex flex-col justify-center items-center lg:items-start p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-3 h-3 bg-yellow-400 rounded-full animate-pulse"></div>
                <p className="font-semibold text-gray-800">Waiting for connection</p>
              </div>
              <p className="text-sm text-gray-600 text-center lg:text-left">
                Share the Room ID or QR code with the dependent. They can scan the code or enter the ID to connect.
              </p>
            </div>
          </div>
          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              className="flex-1 bg-red-500 text-white px-4 py-2 rounded-lg cursor-pointer hover:bg-red-600 transition-colors font-medium"
              onClick={cleanup}
            >
              ✕ Cancel
            </button>
            {/* Manual local camera control: do not prompt at room creation */}
            <button
              className={`flex-1 ${localCameraActive ? 'bg-gray-500 hover:bg-gray-600' : 'bg-blue-600 hover:bg-blue-700'} text-white px-4 py-2 rounded-lg cursor-pointer transition-colors font-medium`}
              onClick={() => startLocalCamera()}
            >
              {localCameraActive ? 'Camera Enabled' : 'Enable Local Camera'}
            </button>
            <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 8 }}>
              <button
                className={`flex-1 ${isMonitoring ? 'bg-gray-500 hover:bg-gray-600' : 'bg-green-600 hover:bg-green-700'} text-white px-4 py-2 rounded-lg cursor-pointer transition-colors font-medium`}
                onClick={() => { sendMonitoringRequest(!isMonitoring); if (!showMonitoring) setShowMonitoring(true); }}
              >
                {isMonitoring ? 'Stop Monitoring' : 'Start Monitoring'}
              </button>
              <div className="text-xs text-gray-500">{isPaired || showMonitoring ? 'Paired' : 'Not connected yet — request will start when dependent is available'}</div>
            </div>
          </div>
        </div>
      ) : null}

      {showMonitoring && roomId ? (
        <div className="mt-4">
          <MonitoringSystem pairingRoomId={roomId} remoteStream={remoteStreamState} isMonitoring={isMonitoring} onToggleMonitoring={(start:boolean) => sendMonitoringRequest(start)} />
        </div>
      ) : null}

      {(isPaired || showMonitoring) && <p className="text-green-600 mt-2">Paired successfully.</p>}
    </div>
  );
}
