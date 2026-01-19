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
    console.log('[CameraMenu] localStream changed:', localStream ? `${localStream.getVideoTracks().length}v ${localStream.getAudioTracks().length}a` : 'null');
    
    if (localStream && videoRef.current) {
      console.log('[CameraMenu] Setting video srcObject and starting playback');
      videoRef.current.srcObject = localStream;
      videoRef.current.play().catch((e) => console.warn('[CameraMenu] Video play failed:', e));
      const hasVideo = localStream.getVideoTracks().length > 0;
      const hasAudio = localStream.getAudioTracks().length > 0;
      console.log('[CameraMenu] Setting UI state: camOn=', hasVideo, 'micOn=', hasAudio);
      setCamOn(hasVideo);
      setMicOn(hasAudio);
      streamRef.current = localStream;
      
      // Log track details
      localStream.getVideoTracks().forEach((t, i) => {
        const settings = t.getSettings();
        console.log(`[CameraMenu] Video track ${i}: ${settings.width}x${settings.height}, enabled=${t.enabled}, readyState=${t.readyState}`);
      });
    } else if (!localStream) {
      console.log('[CameraMenu] localStream is null, clearing video');
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
    <div className='w-full flex flex-col items-center justify-center gap-2'>
      <div className='w-full aspect-video relative rounded overflow-hidden bg-black'>
        <video 
          ref={videoRef} 
          autoPlay 
          muted 
          className="w-full h-full bg-black object-cover absolute border-solid border-black" 
        />   
        <h1 className="absolute left-2 top-2 text-white text-sm sm:text-base text-shadow-lg">
          Your Camera
        </h1>
      </div>
      <div className='w-full flex justify-center gap-2 mx-auto rounded-full'>
        <button onClick={handleToggleCam} className={`
    px-3 sm:px-4 py-2 rounded-full flex items-center gap-2 transition-colors
    ${camOn ? 'bg-neutral-800 hover:bg-green-700' : 'bg-[#E7473C] hover:bg-red-700'}
  `}
>
          {camOn ? (
        <>
        <Video size={20} className="sm:w-6 sm:h-6" />
        </>
      ) : (
        <>
          <VideoOff size={20} className="sm:w-6 sm:h-6" />
        </>
      )}
        </button>
        <button onClick={handleToggleMic} className={`
    px-3 sm:px-4 py-2 rounded-full flex items-center gap-2 transition-colors
    ${micOn ? 'bg-neutral-800 hover:bg-green-700' : 'bg-[#E7473C] hover:bg-red-700'}
  `}>
          {micOn ? (
        <>
          <Mic size={20} className="sm:w-6 sm:h-6" />
        </>
      ) : (
        <>
          <MicOff size={20} className="sm:w-6 sm:h-6" />
        </>
      )}
        </button>
      </div>
    </div>
  )
}
