import { useState, useRef, useEffect, useCallback } from "react";
import * as Tone from "tone";

type SoundType = "sound" | "patient_motion" | "error" | "perimeter" | "bathroom";

export function useAudio(isMuted: boolean) {
  const synthRef = useRef<Tone.Synth | null>(null);
  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const initAudio = useCallback(async () => {
    if (synthRef.current) return;
    if (Tone.context.state !== "running") {
      await Tone.start();
      console.log("Audio context started.");
    }
    if (!synthRef.current) {
      synthRef.current = new Tone.Synth().toDestination();
    }
  }, []);

  const playSound = useCallback((type: SoundType) => {
    if (!isMutedRef.current && synthRef.current) {
      const toneNow = Tone.now();
      switch (type) {
        case "sound":
          synthRef.current.triggerAttackRelease("B6", "8n", toneNow);
          break;
        case "patient_motion":
          synthRef.current.triggerAttackRelease("D6", "8n", toneNow);
          break;
        case "error":
          synthRef.current.triggerAttackRelease("F#5", "8n", toneNow);
          break;
        case "perimeter":
          synthRef.current.triggerAttackRelease("C6", "8n", toneNow);
          synthRef.current.triggerAttackRelease("G6", "8n", toneNow + 0.2);
          break;
        case "bathroom":
          synthRef.current.triggerAttackRelease("A5", "8n", toneNow);
          synthRef.current.triggerAttackRelease("E6", "8n", toneNow + 0.2);
          break;
        default:
          break;
      }
    }
  }, []);

  useEffect(() => {
    // Return cleanup function
    return () => {
      if (synthRef.current) {
        synthRef.current.dispose();
        synthRef.current = null;
      }
    };
  }, []);

  return { initAudio, playSound, synthRef };
}