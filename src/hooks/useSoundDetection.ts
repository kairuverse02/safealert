import { useRef, useEffect, useCallback } from "react";
import * as Tone from "tone";
import { SOUND_THRESHOLD, SOUND_DETECTION_CONSECUTIVE, SOUND_COOLDOWN_MS, COUGH_THRESHOLD, COUGH_COOLDOWN_MS } from "@/lib/constants";

type SoundCallback = (message: string, type: "sound") => void;
type ErrorCallback = (message: string, type: "error") => void;

export function useSoundDetection(
  isActive: boolean,
  onSoundDetected: SoundCallback,
  onError: ErrorCallback,
  initAudio: () => Promise<void>,
  existingStream?: MediaStream | null
) {
  const micRef = useRef<Tone.UserMedia | null>(null);
  const meterRef = useRef<Tone.Meter | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // For remote stream analysis (when a MediaStream is provided), use WebAudio analyser
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataBufRef = useRef<Float32Array | null>(null);

  const start = useCallback(async () => {
    try {
      await initAudio(); // Ensure Tone.context is running if needed

      // If an external MediaStream is given (e.g., remote audio from peer), inspect and attach an analyser to it.
      let skipMicFallback = false;
      if (existingStream) {
        try {
          // If there are no audio tracks present, don't open the local mic on the guardian — instead surface a clear error
          if ((existingStream.getAudioTracks && existingStream.getAudioTracks().length === 0) || !existingStream.getAudioTracks) {
            skipMicFallback = true;
            console.warn('Provided MediaStream has no audio tracks — cannot analyze for sound on guardian side.');
            try { onError('Remote stream has no audio track. Ensure the dependent started monitoring and allowed microphone access.', 'error'); } catch (e) {}
          } else {
            const toneCtx = Tone as unknown as { context?: { rawContext?: AudioContext | null } };
            const rawCtx = (toneCtx && toneCtx.context && toneCtx.context.rawContext) || (typeof window !== 'undefined' && (window.AudioContext ? new (window.AudioContext)() : null));
            audioCtxRef.current = rawCtx as AudioContext;
            analyserRef.current = audioCtxRef.current.createAnalyser();
            analyserRef.current.fftSize = 2048;
            dataBufRef.current = new Float32Array(analyserRef.current.fftSize);
            const src = audioCtxRef.current.createMediaStreamSource(existingStream as MediaStream);
            src.connect(analyserRef.current);
            console.log('Using provided MediaStream for sound detection.');
          }
        } catch (err) {
          console.warn('Failed to attach analyser to provided stream:', err);
        }
      }

      // If we don't have an analyser yet, fall back to local microphone capture (Tone.UserMedia),
      // but only if we should not skip fallback (i.e., no remote stream provided or it has audio)
      if (!analyserRef.current && !skipMicFallback) {
        if (!micRef.current) {
          micRef.current = new Tone.UserMedia();
          meterRef.current = new Tone.Meter();
          await micRef.current.open();
          micRef.current.connect(meterRef.current);
          console.log("Microphone opened for sound detection.");
        }
      } else if (!analyserRef.current && skipMicFallback) {
        console.warn('Sound detection disabled: no analyser and skipping local mic fallback.');
        try { onError('Sound detection unavailable: remote stream has no audio and local microphone was not opened to avoid prompting guardian for mic access.', 'error'); } catch (e) {}
      }

      if (intervalRef.current) clearInterval(intervalRef.current);

      // Require several consecutive readings above threshold and add cooldown to avoid spamming
      const consecRef = { current: 0 };
      let lastDetected = 0;

      intervalRef.current = setInterval(() => {
        let dbLevel = Number.NEGATIVE_INFINITY;

        if (analyserRef.current && dataBufRef.current) {
          analyserRef.current.getFloatTimeDomainData(dataBufRef.current as unknown as Float32Array<ArrayBuffer>);
          const buf = dataBufRef.current;
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = buf[i];
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          if (rms > 0) dbLevel = 20 * Math.log10(rms);
        } else if (meterRef.current) {
          const level = meterRef.current.getValue();
          if (typeof level === 'number') dbLevel = level; else dbLevel = Math.max(...level.map(l => isFinite(l) ? l : -Infinity));
        } else {
          // No source available
          return;
        }

        // Only consider valid numeric readings
        if (!isFinite(dbLevel)) {
          consecRef.current = 0;
          return;
        }

        const now = Date.now();

        // First, check for cough-like spike (single strong transient)
        if (dbLevel > COUGH_THRESHOLD && (now - lastDetected) > COUGH_COOLDOWN_MS) {
          lastDetected = now;
          consecRef.current = 0;
          try {
            onSoundDetected(`Cough-like sound detected (level: ${Math.round(dbLevel)} dB)`, "sound");
          } catch (e) {
            console.warn('Sound detection (cough) callback failed', e);
          }
          return;
        }

        // If level exceeds threshold, increment consecutive counter, else reset
        if (dbLevel > SOUND_THRESHOLD) {
          consecRef.current += 1;
        } else {
          consecRef.current = 0;
        }

        // If we have required consecutive readings and cooldown has elapsed, trigger
        if (consecRef.current >= SOUND_DETECTION_CONSECUTIVE && (now - lastDetected) > SOUND_COOLDOWN_MS) {
          lastDetected = now;
          consecRef.current = 0;
          try {
            onSoundDetected(`Sound detected (level: ${Math.round(dbLevel)} dB)`, "sound");
          } catch (e) {
            console.warn('Sound detection callback failed', e);
          }
        }
      }, 200);
    } catch (err: unknown) {
      console.error("Error starting sound detection:", err);
      // Provide clearer guidance when permission is denied
      if ((err as { name?: string }) && (err as { name?: string }).name === 'NotAllowedError') {
        onError("Microphone permission denied. Please allow microphone access on the dependent device (patient) for sound detection.", "error");
      } else {
        onError("Could not access microphone or stream.", "error");
      }

      try {
        if (micRef.current) micRef.current.close();
      } catch {}
      micRef.current = null;
      meterRef.current = null;
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;

      // cleanup analyser/audio context if present
      try {
        if (analyserRef.current) {
          analyserRef.current.disconnect();
          analyserRef.current = null;
        }
      } catch {}
      try {
        if (audioCtxRef.current) {
          // do not close shared Tone context; only close if we created a raw context newly
          // audioCtxRef.current.close?.();
          audioCtxRef.current = null;
        }
      } catch {}

    }
  }, [initAudio, onSoundDetected, onError, existingStream]);

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;

    try {
      if (micRef.current && micRef.current.state === "started") {
        micRef.current.close();
        micRef.current = null;
        meterRef.current = null;
        console.log("Microphone closed for sound detection.");
      }
    } catch (e) {
      console.warn('Error closing mic user media', e);
    }

    try {
      if (analyserRef.current) {
        analyserRef.current.disconnect();
        analyserRef.current = null;
      }
    } catch (e) {
      console.warn('Error disconnecting analyser', e);
    }

    try {
      if (audioCtxRef.current) {
        // do not forcibly close global context if shared
        audioCtxRef.current = null;
      }
    } catch (e) {
      console.warn('Error clearing audio context ref', e);
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