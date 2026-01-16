import { useRef, useEffect, useCallback } from "react";
import * as Tone from "tone";

type SoundType = "sound" | "patient_motion" | "error" | "perimeter" | "bathroom" | "water" | "sos";

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
    // Respect mute
    if (isMutedRef.current) return;
    const toneNow = Tone.now();

    switch (type) {
      case "sound":
        if (synthRef.current) synthRef.current.triggerAttackRelease("B6", "8n", toneNow);
        break;
      case "patient_motion":
        if (synthRef.current) synthRef.current.triggerAttackRelease("D6", "8n", toneNow);
        break;
      case "error":
        if (synthRef.current) synthRef.current.triggerAttackRelease("F#5", "8n", toneNow);
        break;
      case "perimeter":
        if (synthRef.current) {
          synthRef.current.triggerAttackRelease("C6", "8n", toneNow);
          synthRef.current.triggerAttackRelease("G6", "8n", toneNow + 0.2);
        }
        break;
      case "bathroom":
        if (synthRef.current) {
          synthRef.current.triggerAttackRelease("A5", "8n", toneNow);
          synthRef.current.triggerAttackRelease("E6", "8n", toneNow + 0.2);
        }
        break;
      case "water":
        // Short two-tone gentle chime for water request
        if (synthRef.current) {
          synthRef.current.triggerAttackRelease("E6", "16n", toneNow);
          synthRef.current.triggerAttackRelease("B6", "16n", toneNow + 0.12);
        }
        break;
      case "sos":
        // Ambulance-style siren: continuous frequency sweep using LFOs + gain envelope for 15 seconds
        try {
          // Master gain to control overall volume and allow smooth fade in/out
          const master = new Tone.Gain(0).toDestination();

          // Two slightly detuned oscillators for richness
          const oscA = new Tone.Oscillator({ type: "sawtooth" }).connect(master);
          const oscB = new Tone.Oscillator({ type: "sawtooth" }).connect(master);

          // Primary LFO: slow wail (wavelength ~1.0s up/down => 0.5-1.0Hz range)
          const lfoA = new Tone.LFO({ frequency: 0.8, min: 700, max: 1600, type: "sine" }).start();
          lfoA.connect(oscA.frequency);

          // Secondary LFO: slightly faster, different range to create a richer siren texture
          const lfoB = new Tone.LFO({ frequency: 1.2, min: 900, max: 2000, type: "sine" }).start();
          lfoB.connect(oscB.frequency);

          // Start oscillators at the scheduled time
          oscA.start(toneNow);
          oscB.start(toneNow);

          // Fade in to avoid click and set comfortable volume
          try { master.gain.linearRampTo(0.6, 0.15); } catch {}

          // Stop after 15s and clean up LFOs/oscillators
          setTimeout(() => {
            try { master.gain.linearRampTo(0, 0.4); } catch {}
            setTimeout(() => {
              try { lfoA.stop(); lfoA.dispose(); } catch {}
              try { lfoB.stop(); lfoB.dispose(); } catch {}
              try { oscA.stop(); oscA.dispose(); } catch {}
              try { oscB.stop(); oscB.dispose(); } catch {}
              try { master.dispose(); } catch {}
            }, 500);
          }, 15000);
        } catch {
          // Fallback to sustained synth with long release if oscillator creation fails
          if (synthRef.current) synthRef.current.triggerAttackRelease("C7", "15s", toneNow);
        }
        break;
      default:
        break;
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