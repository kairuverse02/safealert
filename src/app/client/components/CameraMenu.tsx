'use client'
import React, { useRef, useState, useEffect } from 'react';
import { useWebRTC } from '@/contexts/WebRTCContext';
import { Video, VideoOff, Mic, MicOff } from 'lucide-react';

export default function CameraMenu() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  
  const { isPaired, localStream, startMonitoring, stopMonitoring } = useWebRTC();

  // Sync with WebRTC localStream
  useEffect(() => {
    if (localStream && videoRef.current) {
      videoRef.current.srcObject = localStream;
      videoRef.current.play().catch(() => {});
      const hasVideo = localStream.getVideoTracks().length > 0;
      const hasAudio = localStream.getAudioTracks().length > 0;
      setCamOn(hasVideo);
      setMicOn(hasAudio);
      streamRef.current = localStream;
    } else if (!localStream) {
      if (videoRef.current) videoRef.current.srcObject = null;
      setCamOn(false);
      setMicOn(false);
      streamRef.current = null;
    }
  }, [localStream]);

// Toggle camera - now triggers WebRTC monitoring
  const handleToggleCam = async () => {
    if (!camOn) {
      if (!isPaired) {
        alert('Please pair with a guardian first by scanning their QR code.');
        return;
      }
      try {
        await startMonitoring();
        // startMonitoring will update localStream, which will update our UI via useEffect
      } catch (err) {
        console.error('Failed to start monitoring:', err);
        alert('Camera access denied or not available.');
      }
    } else {
      await stopMonitoring();
    }
  };

  // Toggle mic - currently tied to camera (WebRTC gets both)
  const handleToggleMic = async () => {
    // For now, mic control follows camera since WebRTC startMonitoring gets both
    // In the future, we could add separate mic control with renegotiation
    if (!micOn && !camOn) {
      alert('Please enable camera first. Camera and microphone are enabled together.');
    }
  };

  return (
    <div className='h-[440px] text-white flex flex-col items-center justify-center '>
      <div className='h-92 w-full relative rounded'>
        <video 
          ref={videoRef} 
          autoPlay 
          muted 
          className="rounded-md w-full h-full bg-black object-cover absolute border-solid border-black" 
        />   
        <h1 className="absolute left-2 text-white text-shadow-lg">
          Your Camera
        </h1>
      </div>
      <div className='w-full flex justify-center gap-2 mt-4 mx-auto rounded-full'>
        <button onClick={handleToggleCam} className={`
    px-4 py-2 rounded-full flex items-center gap-2 mb-4
    ${camOn ? 'bg-neutral-800 hover:bg-green-700' : 'bg-[#E7473C] hover:bg-red-700'}
  `}
>
          {camOn ? (
        <>
        <Video size={25} />
        </>
      ) : (
        <>
          <VideoOff size={25} />
        </>
      )}
        </button>
        <button onClick={handleToggleMic} className={`
    px-4 rounded-full flex items-center gap-2 mb-4
    ${micOn ? 'bg-neutral-800 hover:bg-green-700' : 'bg-[#E7473C] hover:bg-red-700'}
  `}>
          {micOn ? (
        <>
          <Mic size={25} />
        </>
      ) : (
        <>
          <MicOff size={25}/>
        </>
      )}
        </button>
      </div>
    </div>
  )
}
