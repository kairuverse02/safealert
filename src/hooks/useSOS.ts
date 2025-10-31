import { useState, useRef, useEffect, useCallback } from "react";
import * as Tone from "tone";
import { SOS_DURATION, SOS_COUNTDOWN_DURATION } from "@/lib/constants";

type AlertCallback = (message: string, type: "sos" | "info" | "error") => void;

export function useSOS(
  onAlert: AlertCallback,
  isMuted: boolean,
  initAudio: () => Promise<void>,
  synthRef: React.RefObject<Tone.Synth | null>
) {
  const [isSosActive, setIsSosActive] = useState(false);
  const [countdown, setCountdown] = useState(0); // 0 = not counting
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const activateSosAlert = useCallback(() => {
    setIsSosActive(true);
    onAlert("SOS alert triggered!", "sos");

    const playSosSound = () => {
      if (!isMutedRef.current && synthRef.current) {
        const toneNow = Tone.now();
        synthRef.current.triggerAttackRelease("C6", "8n", toneNow);
        synthRef.current.triggerAttackRelease("C5", "8n", toneNow + 0.2);
      }
    };

    playSosSound(); // Play immediately
    intervalRef.current = setInterval(playSosSound, 500);

    timeoutRef.current = setTimeout(() => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      setIsSosActive(false);
      setCountdown(0);
      onAlert("SOS alert ended.", "info");
    }, SOS_DURATION);
  }, [onAlert, synthRef]);

  const triggerSOS = useCallback(async () => {
    if (isSosActive || countdown > 0) return;

    try {
      await initAudio();
      setCountdown(SOS_COUNTDOWN_DURATION);

      countdownIntervalRef.current = setInterval(() => {
        setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);

      countdownTimeoutRef.current = setTimeout(() => {
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
        setCountdown(0);
        activateSosAlert();
      }, SOS_COUNTDOWN_DURATION * 1000);
    } catch (error) {
      console.error("SOS failed:", error);
      setCountdown(0);
      onAlert("SOS failed to initialize audio.", "error");
    }
  }, [isSosActive, countdown, initAudio, onAlert, activateSosAlert]);

  const cancelSOS = useCallback(() => {
    if (countdownTimeoutRef.current) {
      clearTimeout(countdownTimeoutRef.current);
      countdownTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setCountdown(0);
    setIsSosActive(false);
    onAlert("SOS cancelled by user.", "info");
    console.log("SOS Cancelled");
  }, [onAlert]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (countdownTimeoutRef.current) clearTimeout(countdownTimeoutRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, []);

  return { isSosActive, countdown, triggerSOS, cancelSOS };
}