"use client";

import React, { useRef, useState, useEffect } from "react";
import QRCode from "react-qr-code";
import Peer from "simple-peer";
import { v4 as uuidv4 } from "uuid";
import { createClient } from "@/lib/supabase/client";
import { RealtimeChannel } from '@supabase/supabase-js';

type Props = {
  onRoomCreated?: (id: string) => void;
};

export default function GuardianPairing({ onRoomCreated }: Props) {
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

  // Send a start/stop monitoring request to the dependent by patching the pairing row
  const sendMonitoringRequest = async (start: boolean) => {
    if (!roomId) return;
    try {
      const action = start ? 'start_monitor' : 'stop_monitor';
      const resp = await fetch(`/api/signaling/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependent_action: action }),
      });
      const json = await resp.json().catch(() => null);
      console.log('Monitoring request response', resp.status, json);
      if (!resp.ok) {
        console.error('Failed to send monitoring request', json);
        return;
      }
      console.log('Monitoring request sent', action, json?.data || json);
      setIsMonitoring(start);
    } catch (err) {
      console.error('Failed to send monitoring request (exception)', err);
    }
  };

  useEffect(() => {
    try {
      console.log('[DBG] GuardianPairing mounted');
    } catch {
      // noop
    }
  }, []);

  const createRoom = async () => {
    if (isWaiting) return;
    const id = uuidv4();
    setRoomId(id);
    if (onRoomCreated) onRoomCreated(id);
    setIsWaiting(true);

    // Get guardian's camera stream first
    let localStream: MediaStream | undefined;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = localStream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }
    } catch (err) {
      console.error("Failed to get guardian camera", err);
      setIsWaiting(false);
      return;
    }

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

    const supabase = createClient();

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
                    // Apply only if we haven't applied an answer yet, or the SDP changed
                    if (!hasAppliedAnswerRef.current || lastAppliedAnswerSdpRef.current !== sdp) {
                      try {
                        console.log('Guardian: found answer via poll (sdp present), signaling peer', ans);
                        peerRef.current.signal(ans);
                        hasAppliedAnswerRef.current = true;
                        lastAppliedAnswerSdpRef.current = sdp;
                      } catch (err) {
                        console.warn('Guardian: failed to apply polled answer', err);
                      }
                    } else {
                      console.log('Guardian: polled answer SDP already applied, will process candidates only', ans.candidates || ans.candidate);
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
                    if (answerPollRef.current) {
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
        (payload: { new: { answer_signal?: any } }) => {
          const answer = payload.new.answer_signal;
          if (!answer || !peerRef.current) return;

          try {
            // If answer contains an 'sdp' (type === 'answer') signal it first
            if (answer.type === 'answer' || answer.sdp) {
              const sdp = answer.sdp as string | undefined;
              if (!hasAppliedAnswerRef.current || (sdp && lastAppliedAnswerSdpRef.current !== sdp)) {
                console.log('Received full answer via realtime, signaling peer');
                try {
                  // signal the main answer
                  peerRef.current.signal(answer as Peer.SignalData | string);
                  if (sdp) {
                    hasAppliedAnswerRef.current = true;
                    lastAppliedAnswerSdpRef.current = sdp;
                  }
                } catch (e) {
                  console.warn('Failed to signal full answer via realtime', e);
                }
              } else {
                console.log('Realtime: answer SDP already applied, will only apply candidates if present');
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
    });



    peer.on("stream", (stream: MediaStream) => {
      console.log('Guardian: got remote stream');
      if (remoteVideoRef.current) {
        try {
          remoteVideoRef.current.srcObject = stream;
          // mute to allow autoplay in most browsers; user may unmute later if desired
          remoteVideoRef.current.muted = true;
          remoteVideoRef.current.play().catch((e) => console.warn('Guardian remote video play failed', e));
        } catch (e) {
          console.warn('Guardian: failed to attach remote stream', e);
        }
      }
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

      {roomId && (
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col">
              <p className="text-sm font-semibold text-gray-700 mb-2">Your Camera</p>
              <video 
                ref={localVideoRef} 
                autoPlay 
                playsInline 
                muted 
                className="w-full aspect-video bg-black rounded-lg object-cover" 
              />
            </div>
            <div className="flex flex-col">
              <p className="text-sm font-semibold text-gray-700 mb-2">Dependent View</p>
              <video 
                ref={remoteVideoRef} 
                autoPlay 
                playsInline 
                muted 
                className="w-full aspect-video bg-black rounded-lg object-cover" 
              />
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
            {!isPaired ? null : (
              <button
                className={`flex-1 ${isMonitoring ? 'bg-gray-500 hover:bg-gray-600' : 'bg-green-600 hover:bg-green-700'} text-white px-4 py-2 rounded-lg cursor-pointer transition-colors font-medium`}
                onClick={() => sendMonitoringRequest(!isMonitoring)}
              >
                {isMonitoring ? 'Stop Monitoring' : 'Start Monitoring'}
              </button>
            )}
          </div>
        </div>
      )}

      {isPaired && <p className="text-green-600 mt-2">Paired successfully.</p>}
    </div>
  );
}
