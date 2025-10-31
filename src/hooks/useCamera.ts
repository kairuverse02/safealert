import { useState, useRef, useEffect, useCallback } from "react";

type ErrorCallback = (message: string, type: "error") => void;

export function useCamera(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  onCameraError: ErrorCallback
) {
  const streamRef = useRef<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);

  const startCamera = useCallback(async () => {
    if (streamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsCameraActive(true);
      return true;
    } catch (error) {
      console.error("Camera access error:", error);
      onCameraError("Could not access camera. Check permissions.", "error");
      setIsCameraActive(false);
      return false;
    }
  }, [videoRef, onCameraError]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  }, [videoRef]);

  // Cleanup on unmount
  useEffect(() => stopCamera, [stopCamera]);

  return { startCamera, stopCamera, streamRef, isCameraActive };
}