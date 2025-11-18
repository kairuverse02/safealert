'use client'
import React, { useRef, useState } from 'react';

import { Video, VideoOff, Mic, MicOff } from 'lucide-react';

export default function CameraMenu() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camOn, setCamOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);

// Toggle camera
  const handleToggleCam = async () => {
    if (!camOn) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: micOn });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setCamOn(true);
      } catch {
        alert('Camera access denied or not available.');
      }
    } else {
      if (streamRef.current) {
        streamRef.current.getVideoTracks().forEach(track => track.stop());
        // If mic is still on, keep audio tracks
        if (!micOn) streamRef.current.getAudioTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      setCamOn(false);
    }
  };

  // Toggle mic
  const handleToggleMic = async () => {
    if (!micOn) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: camOn, audio: true });
        streamRef.current = stream;
        if (videoRef.current && camOn) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setMicOn(true);
      } catch {
        alert('Microphone access denied or not available.');
      }
    } else {
      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach(track => track.stop());
        // If cam is still on, keep video tracks
        if (!camOn) streamRef.current.getVideoTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setMicOn(false);
    }
  };

  return (
    <div className='h-[440px] bg-neutral-400 text-white flex flex-col items-center justify-center rounded-xl'>
      <div className='h-90 w-full relative'>
      <video 
        ref={videoRef} 
        autoPlay 
        muted 
        className="w-full h-full bg-black object-cover absolute border-2 border-solid border-black rounded-xl" 
      />
      </div>
      <div className='w-full flex justify-center gap-2 mt-4 mx-auto'>
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
