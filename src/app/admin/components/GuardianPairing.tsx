"use client";

import React, { useRef, useState, useEffect } from "react";
import QRCode from "react-qr-code";
import Peer from "simple-peer";
import { v4 as uuidv4 } from "uuid";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

type Props = {
  onRoomCreated?: (id: string) => void;
};

export default function GuardianPairing({ onRoomCreated }: Props) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isPaired, setIsPaired] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const peerRef = useRef<Peer.Instance | null>(null);
  const channelRef = useRef<any>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    try {
      console.log('[DBG] GuardianPairing mounted');
    } catch (e) {
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

    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream: localStream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      }
    });
    peerRef.current = peer;

    peer.on("signal", async (offer: any) => {
      try {
        console.log('Guardian: signal event, sending offer/ice candidate to API', offer && (offer.type || (offer.candidate ? 'candidate' : 'signal')));
        const resp = await fetch(`/api/signaling/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offer_signal: offer }),
        });
        const json = await resp.json();
        if (!resp.ok) {
          console.error('Failed to publish offer via API', json);
          return;
        }
        console.log('Offer published to pairing_rooms via API', id, json.data);
      } catch (err) {
        console.error('Failed to publish offer (exception)', err);
      }
    });

    peer.on('error', (err) => {
      console.error('Guardian peer error', err);
    });

    // Attach connection state logging if underlying RTCPeerConnection is available
    peer.on('connect', () => {
      console.log('Guardian: peer.connect event');
    });
    // @ts-ignore - access underlying RTCPeerConnection for diagnostics
    const guardianPc: RTCPeerConnection | undefined = (peer as any)?._pc;
    if (guardianPc) {
      guardianPc.oniceconnectionstatechange = () => console.log('Guardian PC ICE state:', guardianPc.iceConnectionState);
      guardianPc.onconnectionstatechange = () => console.log('Guardian PC connection state:', (guardianPc as any).connectionState || guardianPc.iceConnectionState);
    }

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
        (payload) => {
          const answer = payload.new.answer_signal;
          if (answer && peerRef.current) {
            console.log("Received answer, signaling peer");
            peerRef.current.signal(answer);
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
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
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
          </div>
        </div>
      )}

      {isPaired && <p className="text-green-600 mt-2">Paired successfully.</p>}
    </div>
  );
}
