import { useRef, useEffect, useCallback } from "react";
import * as Tone from "tone";
import { SOUND_THRESHOLD } from "@/lib/constants";

type SoundCallback = (message: string, type: "sound") => void;
type ErrorCallback = (message: string, type: "error") => void;

export function useSoundDetection(
  isActive: boolean,
  onSoundDetected: SoundCallback,
  onError: ErrorCallback,
  initAudio: () => Promise<void>
) {
  const micRef = useRef<Tone.UserMedia | null>(null);
  const meterRef = useRef<Tone.Meter | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const start = useCallback(async () => {
    try {
      await initAudio(); // Ensure Tone.context is running
      if (!micRef.current) {
        micRef.current = new Tone.UserMedia();
        meterRef.current = new Tone.Meter();
        await micRef.current.open();
        micRef.current.connect(meterRef.current);
        console.log("Microphone opened for sound detection.");
      }

      if (intervalRef.current) clearInterval(intervalRef.current);
      
      // --- START: MODIFIED SECTION ---
      intervalRef.current = setInterval(() => {
        if (micRef.current && meterRef.current) {
          const level = meterRef.current.getValue();
          let dbLevel: number;

          // Check if level is a number (mono) or array (stereo)
          if (typeof level === 'number') {
            dbLevel = level;
          } else {
            // For stereo, find the loudest channel. Use -Infinity as base for Math.max
            dbLevel = Math.max(...level.map(l => isFinite(l) ? l : -Infinity));
          }

          // Check against threshold (and ensure it's a valid number)
          if (isFinite(dbLevel) && dbLevel > SOUND_THRESHOLD) {
            onSoundDetected(
              `Sound detected (level: ${Math.round(dbLevel)} dB)`,
              "sound"
            );
          }
        }
      }, 200);
    } catch (e) {
      console.error("Error starting sound detection:", e);
      onError("Could not access microphone.", "error");
      if (micRef.current) micRef.current.close();
      micRef.current = null;
      meterRef.current = null;
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [initAudio, onSoundDetected, onError]);

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    if (micRef.current && micRef.current.state === "started") {
      micRef.current.close();
      micRef.current = null;
      meterRef.current = null;
      console.log("Microphone closed for sound detection.");
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      start();
    } else {
      stop();
    }
    return stop; // Cleanup on unmount or if isActive changes
  }, [isActive, start, stop]);
}