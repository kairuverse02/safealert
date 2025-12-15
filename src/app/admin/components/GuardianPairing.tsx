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
  const peerRef = useRef<Peer.Instance | null>(null);
  const channelRef = useRef<any>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
        setIsWaiting(false);
        return;
      }
      console.log('Room created via API:', id, json.data);
    } catch (err) {
      console.error('Failed to create room (exception)', err);
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
    <div className="p-4 border rounded-md">
      <h3 className="font-semibold mb-2">Guardian Pairing</h3>
      {!roomId && (
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded"
          onClick={createRoom}
        >
          Create Pairing Room
        </button>
      )}

      {roomId && (
        <div className="mt-3 space-y-2">
          <p>
            Share this Room ID with the dependent (scan or copy):
            <strong className="ml-2 break-all">{roomId}</strong>
          </p>
          <div className="flex items-start gap-4">
            <div className="bg-white p-2 rounded">
              <QRCode value={roomId} size={128} />
            </div>
            <div className="flex-1">
              <p className="text-sm text-gray-500">Waiting for dependent to connect...</p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <p className="text-xs font-semibold mb-1">Your Camera</p>
                  <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-32 bg-black rounded" />
                </div>
                <div>
                  <p className="text-xs font-semibold mb-1">Dependent View</p>
                  <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-32 bg-black rounded" />
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  className="bg-blue-500 text-white px-3 py-1 rounded"
                  onClick={() => navigator.clipboard.writeText(roomId)}
                >
                  Copy ID
                </button>
                <button
                  className="bg-red-500 text-white px-3 py-1 rounded"
                  onClick={cleanup}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isPaired && <p className="text-green-600 mt-2">Paired successfully.</p>}
    </div>
  );
}
