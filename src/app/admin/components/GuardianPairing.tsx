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
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null); // Accumulate all remote tracks here
  const answerPollRef = useRef<number | null>(null); // interval id for polling answer as a fallback
  const hasStartedPollingRef = useRef(false);
  // Track whether an answer SDP has already been applied to avoid duplicate signaling
  const hasAppliedAnswerRef = useRef(false);
  const lastAppliedAnswerSdpRef = useRef<string | null>(null);
  // Guard to avoid applying the same answer concurrently (poll vs realtime)
  const applyingAnswerRef = useRef(false);
  // Track the number of candidates already applied to avoid re-applying same candidates
  const appliedCandidateCountRef = useRef(0);
  // Collect guardian's own ICE candidates for persisting to DB
  const collectedCandidatesRef = useRef<RTCIceCandidate[]>([]);
  // Track whether initial offer has been published so we know when to merge candidates
  const offerPublishedRef = useRef(false);
  const [remoteStreamState, setRemoteStreamState] = useState<MediaStream | null>(null);
  const [showMonitoring, setShowMonitoring] = useState(false);
  const [isMuted] = useState(false);
  const [localCameraActive, setLocalCameraActive] = useState(false);
  const [, setLocalCameraError] = useState<string | null>(null);
  const hasAddedRecvTransceiverRef = useRef(false); // avoid duplicate recv transceiver additions

  // Mic test diagnostics: timestamp (ms) when dependent requested a mic test
  const [micTestRequestAt, setMicTestRequestAt] = useState<number | null>(null);
  // UI indicators: whether a mic test was recently requested and whether audio was received as part of a mic test
  const [, setMicTestRequested] = useState<boolean>(false);
  const [, setMicTestAudioReceived] = useState<boolean>(false);

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
          const maybePeer = peerRef.current as unknown as { addStream?: (s: MediaStream) => void; _pc?: RTCPeerConnection };
          if (typeof maybePeer.addStream === 'function') {
            maybePeer.addStream(s);
            console.log('Guardian: added local stream via addStream');
          } else {
            const pc = maybePeer._pc;
            if (pc) {
              s.getTracks().forEach((t) => pc.addTrack(t, s));
              console.log('Guardian: added local tracks to underlying RTCPeerConnection');
              try { console.log('Guardian PC transceivers after addTrack:', pc.getTransceivers ? pc.getTransceivers() : []); } catch (err) { console.warn(err); }
            }
          }
        } catch (err) {
          console.warn('Guardian: failed to attach local stream to peer', err);
        }
      }
    } catch (err: unknown) {
      console.warn('Guardian: failed to enable local camera', err);
      setLocalCameraError(String((err as Error)?.message || String(err)));
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
      const body = { guardian_command: action };
      console.log('[GUARDIAN] Sending monitoring request (PATCH body):', body, 'to room:', roomId);
      const resp = await fetch(`/api/signaling/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await resp.json().catch(() => null);
      console.log('[GUARDIAN] Monitoring request response:', { status: resp.status, action, ok: resp.ok, json });
      if (!resp.ok) {
        console.error('[GUARDIAN] Failed to send monitoring request', json);
        return;
      }
      console.log('[GUARDIAN] Monitoring request persisted to DB:', action, json?.data || json);
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

  // NOTE: dependent_action handling moved to main channel subscription below to avoid CHANNEL_ERROR
  // (Supabase doesn't allow multiple subscriptions to same row with same filter)

  const createRoom = async () => {
    if (isWaiting) return;
    const id = uuidv4();
    setRoomId(id);
    if (onRoomCreated) onRoomCreated(id);
    setIsWaiting(true);
    
    // Reset refs for new room
    collectedCandidatesRef.current = [];
    offerPublishedRef.current = false;
    appliedCandidateCountRef.current = 0;
    hasAppliedAnswerRef.current = false;
    lastAppliedAnswerSdpRef.current = null;
    applyingAnswerRef.current = false;
    hasStartedPollingRef.current = false;

    // Do NOT get guardian camera automatically at room creation to avoid prompting permissions.
    // The guardian can enable their local camera manually after the room is created.
    const localStream: MediaStream | undefined = undefined;
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
        console.error('Failed to create room via API - Status:', resp.status, 'Error:', json?.error, 'Full response:', json);
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
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
          // Free TURN relay servers for NAT traversal
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
          }
        ],
        iceCandidatePoolSize: 10
      }
    });
    peerRef.current = peer;

    peer.on("signal", async (offer: unknown) => {
      try {
        console.log('Guardian: signal payload', offer);
        console.log('[DEBUG] Signal event fired. Payload:', JSON.stringify(offer).substring(0, 200));
        console.log('[DEBUG] Signal payload type check:', offer && typeof offer === 'object' ? (offer as Record<string, unknown>)['type'] : 'not object');
        // Determine a short descriptor for logging
        let desc = 'signal';
        if (offer && typeof offer === 'object') {
          const o = offer as Record<string, unknown>;
          if (typeof o['type'] === 'string') desc = o['type'] as string;
          else if (o['candidate']) desc = 'candidate';
        }
        console.log('Guardian: signal event (desc)', desc);

        // Persist offer, answer, or candidates back to DB
        const offerSignal = offer && typeof offer === 'object' ? (offer as Record<string, unknown>)['type'] === 'offer' : false;
        const answerSignal = offer && typeof offer === 'object' ? (offer as Record<string, unknown>)['type'] === 'answer' : false;
        // ICE candidates from simple-peer have {candidate: {...}} without type field, OR type === 'candidate'
        const candidateSignal = offer && typeof offer === 'object' ? !!((offer as Record<string, unknown>)['candidate'] || (offer as Record<string, unknown>)['type'] === 'candidate') : false;
        console.log('[DEBUG] Signal types - offerSignal:', offerSignal, 'answerSignal:', answerSignal, 'candidateSignal:', candidateSignal);
        
        if (offerSignal) {
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
          
          // Mark offer as published so we can now persist candidates
          offerPublishedRef.current = true;
          
          // Flush any ICE candidates that were collected before offer was published
          if (collectedCandidatesRef.current.length > 0) {
            console.log('Guardian: flushing', collectedCandidatesRef.current.length, 'queued ICE candidates');
            const offerWithCandidates = {
              ...(offer as object),
              candidates: collectedCandidatesRef.current.map(c => c.toJSON()),
            };
            const updateResp = await fetch(`/api/signaling/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ offer_signal: offerWithCandidates }),
            });
            const updateJson = await updateResp.json().catch(() => null);
            console.log('Guardian: flushed queued candidates response', updateResp.status, updateJson);
          }
        } else if (answerSignal) {
          // Send answer back to dependent (for renegotiation)
          console.log('Guardian: sending answer to dependent (persisting to DB)');
          const resp = await fetch(`/api/signaling/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answer_signal: offer }),
          });
          const json = await resp.json().catch(() => null);
          console.log('Guardian: publish answer response', resp.status, json);
          if (!resp.ok) {
            console.error('Failed to publish answer via API', json);
            return;
          }
          console.log('Answer published to pairing_rooms via API', id, json?.data);
        } else if (candidateSignal) {
          // Guardian is the offerer, so its ICE candidates should be merged into offer_signal
          console.log('Guardian: sending ICE candidate (merging with existing offer)');
          try {
            const resp = await fetch(`/api/signaling/${id}`);
            const data = await resp.json().catch(() => null);
            const existingOffer = data?.data?.offer_signal || {};
            const candidates = Array.isArray(existingOffer.candidates) ? existingOffer.candidates : [];
            
            // Add this candidate if not already present
            const candidateObj = (offer as Record<string, unknown>)?.candidate;
            if (candidateObj && !candidates.find((c: unknown) => JSON.stringify(c) === JSON.stringify(candidateObj))) {
              candidates.push(candidateObj);
            }
            
            const updateResp = await fetch(`/api/signaling/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ offer_signal: { ...existingOffer, candidates } }),
            });
            const json = await updateResp.json().catch(() => null);
            console.log('Guardian: merged candidate into offer response', updateResp.status, json);
          } catch (err) {
            console.warn('Guardian: failed to merge candidate', err);
          }
        }

        // Start a fallback poll to detect answers in case realtime subscriptions miss the update
        // Only for initial offers (not for renegotiation answers/candidates)
        if (offerSignal && !hasStartedPollingRef.current) {
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
                      } catch (_e) {
                        console.warn('Guardian: failed to add recv transceiver', _e);
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
                    console.log('Guardian: polled answer SDP already applied or is being applied, will process candidates only', ans.candidates?.length || 0, 'candidates');
                  }

                  // Also apply any NEW candidates included in the update (skip already-applied ones)
                  const candidates = ans.candidates || (ans.candidate ? [ans.candidate] : []);
                  console.log('Guardian: answer_signal candidates array:', candidates.length, 'items, already applied:', appliedCandidateCountRef.current);
                  if (Array.isArray(candidates) && candidates.length > appliedCandidateCountRef.current) {
                    const newCandidates = candidates.slice(appliedCandidateCountRef.current);
                    console.log(`Guardian: applying ${newCandidates.length} new dependent candidates via addIceCandidate`);
                    const pc = (peerRef.current as unknown as { _pc?: RTCPeerConnection })?._pc;
                    if (pc && pc.remoteDescription) {
                      for (const c of newCandidates as RTCIceCandidateInit[]) {
                        try {
                          await pc.addIceCandidate(new RTCIceCandidate(c));
                          console.log('Guardian: applied dependent candidate:', c.candidate?.substring(0, 60));
                        } catch (e) {
                          console.warn('Guardian: failed to add dependent candidate:', e);
                        }
                      }
                    } else {
                      console.warn('Guardian: cannot apply candidates - no PC or remote description not set');
                    }
                    appliedCandidateCountRef.current = candidates.length;
                  }

                  // Check ICE connection state - only stop polling when ICE is connected or completed
                  const pc = (peerRef.current as unknown as { _pc?: RTCPeerConnection })?._pc;
                  const iceState = pc?.iceConnectionState;
                  if (iceState === 'connected' || iceState === 'completed') {
                    console.log('Guardian: ICE connected, stopping answer poll');
                    if (answerPollRef.current) {
                      clearInterval(answerPollRef.current);
                      answerPollRef.current = null;
                    }
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
      } catch (err) {
        console.error('Failed to publish signal (exception)', err);
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
      } catch {}

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
          let lastIceState = pc.iceConnectionState;
          let lastConnState = pc.connectionState;
          
          pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState !== lastIceState) {
              console.log(`Guardian PC ICE state: ${lastIceState} → ${pc.iceConnectionState}`);
              lastIceState = pc.iceConnectionState;
            }
          };
          
          pc.onconnectionstatechange = () => {
            const newState = pc.connectionState;
            if (newState !== lastConnState) {
              console.log(`Guardian PC connection state: ${lastConnState} → ${newState}`);
              lastConnState = newState;
            }
          };

          // Handle ICE candidates - collect and persist them to the offer_signal
          try {
            pc.onicecandidate = async (evt: RTCPeerConnectionIceEvent) => {
              console.log('Guardian PC onicecandidate', evt?.candidate);
              if (evt?.candidate) {
                // Log candidate type for debugging
                console.log(`Guardian: ICE candidate type=${evt.candidate.type} protocol=${evt.candidate.protocol} address=${evt.candidate.address}`);
                // If offer not yet published, queue the candidate
                if (!offerPublishedRef.current) {
                  console.log('Guardian: queuing ICE candidate (offer not yet published)');
                  collectedCandidatesRef.current.push(evt.candidate);
                } else {
                  // Offer is published, merge candidate into offer_signal
                  console.log('Guardian: persisting ICE candidate to offer_signal');
                  try {
                    const resp = await fetch(`/api/signaling/${id}`);
                    const data = await resp.json().catch(() => null);
                    const existingOffer = data?.data?.offer_signal || {};
                    const candidates = Array.isArray(existingOffer.candidates) ? existingOffer.candidates : [];
                    
                    // Add this candidate if not already present
                    const candidateJson = evt.candidate.toJSON();
                    if (!candidates.find((c: unknown) => JSON.stringify(c) === JSON.stringify(candidateJson))) {
                      candidates.push(candidateJson);
                    }
                    
                    const updateResp = await fetch(`/api/signaling/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ offer_signal: { ...existingOffer, candidates } }),
                    });
                    const json = await updateResp.json().catch(() => null);
                    console.log('Guardian: persisted ICE candidate response', updateResp.status, json);
                  } catch (err) {
                    console.warn('Guardian: failed to persist ICE candidate', err);
                  }
                }
              }
            };
          } catch {}

          try {
            console.log('Guardian PC transceivers at attach:', pc.getTransceivers ? pc.getTransceivers() : []);
          } catch {}

          // If the guardian has no local camera active, proactively add a recvonly transceiver
          try {
            if (!localCameraActive && typeof pc.addTransceiver === 'function' && !hasAddedRecvTransceiverRef.current) {
              try {
                // Add video and audio recvonly transceivers so dependent can send media
                // Note: data channels are created automatically by simple-peer, not via addTransceiver
                pc.addTransceiver('video', { direction: 'recvonly' });
                pc.addTransceiver('audio', { direction: 'recvonly' });
                console.log('Guardian: proactively added recvonly video and audio transceivers at attach');
                hasAddedRecvTransceiverRef.current = true;
                try { console.log('Guardian PC transceivers after proactive add:', pc.getTransceivers ? pc.getTransceivers() : []); } catch {}
              } catch (e) {
                console.warn('Guardian: failed to proactively add recv transceivers', e);
              }
            }
          } catch {}

          // Fallback: listen for individual track events and build a MediaStream if simple-peer 'stream' doesn't fire
          try {
            pc.ontrack = (ev: RTCTrackEvent) => {
              try {
                console.log('Guardian PC ontrack event (raw):', ev);
                console.log('[MIC_TEST] ontrack: track info:', { kind: ev.track?.kind, id: ev.track?.id, label: ev.track?.label });
                console.log('Guardian PC state at ontrack:', { connectionState: pc.connectionState, iceConnectionState: pc.iceConnectionState, signalingState: pc.signalingState });
                
                // Initialize remoteStream if it doesn't exist
                if (!remoteStreamRef.current) {
                  remoteStreamRef.current = new MediaStream();
                  console.log('Guardian: created new remoteStream to accumulate tracks');
                }

                // Add this track to the accumulating stream
                const currentRemoteStream = remoteStreamRef.current;
                if (ev.track && !currentRemoteStream.getTracks().find(t => t.id === ev.track.id)) {
                  currentRemoteStream.addTrack(ev.track);
                  console.log('Guardian: added', ev.track.kind, 'track to remoteStream; total tracks:', currentRemoteStream.getTracks().length);
                  // Log track state
                  console.log(`Guardian: ${ev.track.kind} track enabled=${ev.track.enabled} readyState=${ev.track.readyState}`);
                }

                // Log track counts for diagnostics
                const videoTracks = currentRemoteStream.getVideoTracks().length;
                const audioTracks = currentRemoteStream.getAudioTracks().length;
                console.log('Guardian: remoteStream now has', videoTracks, 'video and', audioTracks, 'audio tracks');

                // Update state with the accumulated stream
                setRemoteStreamState(currentRemoteStream);
                setTimeout(() => setShowMonitoring(true), 150);

                // Mark audio received if we have audio tracks (for mic test diagnostics)
                if (audioTracks > 0) {
                  setMicTestAudioReceived(true);
                  setTimeout(() => setMicTestAudioReceived(false), 8000);
                  console.log('[MIC_TEST] Guardian: ontrack produced audio tracks; set micTestAudioReceived=true');
                }
              } catch (e) {
                console.warn('Guardian PC ontrack handler failed', e);
              }
            };
          } catch {}
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
        (payload: { new: { offer_signal?: { type?: string; sdp?: string; candidates?: RTCIceCandidateInit[]; candidate?: RTCIceCandidateInit; transceiverRequest?: unknown; transceiverRequests?: unknown[]; [key: string]: unknown } | null; answer_signal?: { type?: string; sdp?: string; candidates?: RTCIceCandidateInit[]; candidate?: RTCIceCandidateInit; transceiverRequest?: unknown; transceiverRequests?: unknown[]; [key: string]: unknown } | null; guardian_event?: { type?: string; [key: string]: unknown } | null; dependent_action?: string } }) => {
          // LOG EVERY UPDATE EVENT RECEIVED
          console.log('[REALTIME] UPDATE event received from database. Payload keys:', Object.keys(payload.new || {}));
          console.log('[REALTIME] Full payload:', JSON.stringify(payload.new).substring(0, 300));
          
          // Handle dependent_action (consolidated from separate channel to avoid CHANNEL_ERROR)
          try {
            const dep = payload.new.dependent_action;
            if (dep) {
              console.log('GuardianPairing: received dependent_action', dep);
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
          } catch (_e) {
            console.warn('Failed to process guardian_event in realtime payload', _e);
          }

          // Handle renegotiation offer from dependent (when monitoring starts after pairing)
          const offer = payload.new.offer_signal;
          console.log('[REALTIME] Checking offer_signal:', { hasOffer: !!offer, hasPeer: !!peerRef.current, offerType: offer?.type, hasSdp: !!offer?.sdp });
          if (offer && peerRef.current && offer.type === 'offer' && offer.sdp) {
            try {
              console.log('[REALTIME] Received renegotiation offer from dependent during monitoring');
              // Signal the offer to simple-peer, which will trigger answer generation
              peerRef.current.signal(offer as Peer.SignalData | string);
              console.log('[REALTIME] Renegotiation offer signaled to peer');
            } catch (err) {
              console.error('[REALTIME] Failed to apply renegotiation offer', err);
            }
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
                    const req = (answer && (answer.transceiverRequest || (Array.isArray(answer.transceiverRequests) ? answer.transceiverRequests[0] : null))) as { kind?: string } | null;
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

                  // CRITICAL: Actually signal the answer to the peer connection!
                  peerRef.current.signal(answer as Peer.SignalData);
                  hasAppliedAnswerRef.current = true;
                  if (sdp) lastAppliedAnswerSdpRef.current = sdp;
                  console.log('Guardian: answer signaled to peer via realtime');
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
                  const candidatesArr = (candidates as unknown) as RTCIceCandidateInit[];
                  candidatesArr.forEach((c) => {
                    try {
                      peerRef.current?.signal({ type: 'candidate', candidate: c as unknown as RTCIceCandidate });
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
                const req = (answer && (answer.transceiverRequest || (Array.isArray(answer.transceiverRequests) ? answer.transceiverRequests[0] : null))) as { kind?: string } | null as { kind?: string } | null;
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
              } catch {}

              (answer.candidates as RTCIceCandidateInit[]).forEach((c) => {
                try {
                  // Construct an RTCIceCandidate from the init object to satisfy the peer.signal typing
                  const cand = new RTCIceCandidate(c);
                  peerRef.current?.signal({ type: 'candidate', candidate: cand as unknown as RTCIceCandidate });
                } catch (e) {
                  console.warn('Failed to signal candidate', e);
                }
              });
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
      .on('system', (msg: Record<string, unknown>) => {
        console.log('[REALTIME] System message:', msg);
      })
      .on('postgres_changes', (payload: Record<string, unknown>) => {
        console.log('[REALTIME] postgres_changes received:', payload);
      })
      .subscribe((status: string) => {
        console.log('[REALTIME] Subscription status:', status);
        if (status === 'SUBSCRIBED') {
          console.log('[REALTIME] Subscription callback - now listening for real updates');
        }
      });

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
