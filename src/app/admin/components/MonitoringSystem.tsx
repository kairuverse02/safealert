"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { jsPDF } from "jspdf";
import { LogEntry, LogEntryType, MonitoringMode, Point } from "@/types";
import {
  ALERT_COOLDOWN,
  PATIENT_MOTION_BUFFER_FRAMES,
  PERIMETER_MIN_MOTION_PIXELS,
  PERIMETER_MOTION_THRESHOLD,
  PATIENT_MIN_MOTION_PIXELS,
  PATIENT_MOTION_THRESHOLD,
  MOTION_PERCENT_FALLBACK,
  MOTION_ENERGY_WINDOW,
  MOTION_ENERGY_MULTIPLIER,
  SOS_FLASH_INTERVAL,
} from "@/lib/constants";
import { detectMotion } from "@/lib/motion";
import { useAudio } from "@/hooks/useAudio";
import { createClient } from "@/lib/supabase/client";
import { useCamera } from "@/hooks/useCamera";
import { usePerimeter } from "@/hooks/usePerimeter";
import { useSoundDetection } from "@/hooks/useSoundDetection";

type Props = {
  pairingRoomId?: string | null;
  remoteStream?: MediaStream | null;
  isMonitoring?: boolean;
  onToggleMonitoring?: (start: boolean) => void;
};

export default function MonitoringSystem({ pairingRoomId, remoteStream, isMonitoring = false, onToggleMonitoring }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastFrameDataRef = useRef<Uint8ClampedArray | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const lastAlertTimeRef = useRef(0);

  const [currentMode, setCurrentMode] = useState<MonitoringMode>("idle");
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [patientMotionFrameCount, setPatientMotionFrameCount] = useState(0);

  // Dynamic patient motion sensitivity (can be calibrated at runtime)
  const [patientThreshold, setPatientThreshold] = useState(PATIENT_MOTION_THRESHOLD);
  const [patientMinPixels, setPatientMinPixels] = useState(PATIENT_MIN_MOTION_PIXELS);
  const patientThresholdRef = useRef(patientThreshold);
  const patientMinPixelsRef = useRef(patientMinPixels);
  const calibrationRef = useRef(false); // calibration in-progress
  const calibratedRef = useRef(false); // whether calibration was performed for current patient session
  const motionHistoryRef = useRef<number[]>([]);
  useEffect(() => { patientThresholdRef.current = patientThreshold; }, [patientThreshold]);
  useEffect(() => { patientMinPixelsRef.current = patientMinPixels; }, [patientMinPixels]);

  const currentModeRef = useRef(currentMode);
  useEffect(() => {
    currentModeRef.current = currentMode;
  }, [currentMode]);

  const { initAudio, playSound } = useAudio(isMuted);

  const triggerAlert = useCallback(
    async (message: string, type: LogEntryType = "perimeter") => {
      const now = Date.now();
      const prevTime = lastAlertTimeRef.current;
      
      if (
        now - prevTime < ALERT_COOLDOWN &&
        !["sos", "info", "error"].includes(type)
      ) {
        return;
      }

      // Try to initialize audio (best-effort). Some browsers require a user gesture; await so playSound runs after init.
      try {
        await initAudio();
      } catch (e) {
        console.warn('MonitoringSystem: initAudio failed or was blocked', e);
      }

      // Play a sound for all actionable alerts except plain 'info' (which is quiet)
      if (type !== "info") {
        try {
          type SoundKey = 'sound' | 'patient_motion' | 'error' | 'perimeter' | 'bathroom' | 'water' | 'sos';
          const soundTypes = ['sound','patient_motion','error','perimeter','bathroom','water','sos'] as const;
          if ((soundTypes as readonly string[]).includes(type)) {
            playSound(type as SoundKey);
          }
        } catch (err) {
          console.warn('MonitoringSystem: playSound failed', err);
        }
      }

      setLogEntries((prev) => [
        {
          id: Date.now() + Math.random(),
          type,
          message,
          time: new Date().toLocaleTimeString(),
        },
        ...prev.slice(0, 19),
      ]);

      if (canvasRef.current) {
        canvasRef.current.classList.add("alert-active");
        setTimeout(
          () => canvasRef.current?.classList.remove("alert-active"),
          type === "sos" ? SOS_FLASH_INTERVAL : 1000
        );
      }
      
      lastAlertTimeRef.current = now;

      // Publish a guardian-side event to the pairing row so the dependent can display it
      if (pairingRoomId) {
        (async () => {
          try {
            const payload = { guardian_event: { type, message, time: new Date().toISOString() } };
            const resp = await fetch(`/api/signaling/${pairingRoomId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const json = await resp.json().catch(() => null);
            console.log('Published guardian_event', resp.status, json);
          } catch (err) {
            console.warn('Failed to publish guardian_event', err);
          }
        })();
      }
    },
    [initAudio, playSound, pairingRoomId]
  );

  const { startCamera, stopCamera, streamRef, isCameraActive } = useCamera(
    videoRef,
    triggerAlert
  );
  const {
    points: perimeterPoints,
    addPoint: addPerimeterPoint,
    clearPoints: clearPerimeterPoints,
    draw: drawPerimeter,
    checkCrossing: checkPerimeterCrossing,
  } = usePerimeter(canvasRef, currentMode);
  useSoundDetection(
    currentMode === "patient_monitoring" && !!remoteStream,
    triggerAlert,
    triggerAlert,
    initAudio,
    remoteStream || streamRef.current
  );
  // Removed SOS hook

  const setMode = (newMode: MonitoringMode) => {
    setPatientMotionFrameCount(0);
    lastFrameDataRef.current = null;

    if (newMode === "idle" || newMode === "patient_monitoring") {
      clearPerimeterPoints();
    }
    if (newMode === "patient_monitoring") {
      initAudio();
    }
    setCurrentMode(newMode);
  };

  const drawMotion = (ctx: CanvasRenderingContext2D, centroids: Point[]) => {
    ctx.fillStyle = "rgba(255, 0, 0, 0.5)"; // Red circles for motion
    centroids.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, 2 * Math.PI); // 10px radius circle
      ctx.fill();
    });
  };

  const animationLoop = useCallback(() => {
    animationFrameIdRef.current = requestAnimationFrame(animationLoop);

    const sourceStream = remoteStream || streamRef.current;

    if (!sourceStream) {
      return;
    }

    if (!videoRef.current || !canvasRef.current) {
      return;
    }

    // Log video state for diagnostics
    const readyState = videoRef.current.readyState;
    const videoWidth = videoRef.current.videoWidth;
    const videoHeight = videoRef.current.videoHeight;
    
    if (readyState < videoRef.current.HAVE_METADATA) {
      if (readyState === videoRef.current.HAVE_NOTHING) {
        console.log('MonitoringSystem: video readyState is HAVE_NOTHING - no data loaded yet');
      } else if (readyState === videoRef.current.HAVE_METADATA) {
        console.log('MonitoringSystem: video readyState is HAVE_METADATA');
      }
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    // If we'll be calling getImageData frequently, set willReadFrequently to true for better performance
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (!ctx) return;

    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      console.log('MonitoringSystem: video dimensions invalid', { videoWidth, videoHeight });
      return;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      console.log('MonitoringSystem: resizing canvas to', { videoWidth: video.videoWidth, videoHeight: video.videoHeight });
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let currentFrameData;
    try {
      currentFrameData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch (e) {
      console.error("Error getting image data:", e);
      return;
    }

    let motionCentroids: Point[] = [];
    const mode = currentModeRef.current;

    if (lastFrameDataRef.current) {
      if (mode === "perimeter_monitoring") {
        const perimRes = detectMotion(
          currentFrameData,
          lastFrameDataRef.current,
          canvas.width,
          PERIMETER_MOTION_THRESHOLD,
          PERIMETER_MIN_MOTION_PIXELS
        );
        motionCentroids = perimRes.centroids;
      } else if (mode === "patient_monitoring") {
        // Use calibrated thresholds, but be more sensitive while in patient_monitoring to detect subtle gestures
        const baseThreshold = patientThresholdRef.current;
        const baseMin = patientMinPixelsRef.current;
        const sensitivityFactor = (mode === 'patient_monitoring') ? 0.5 : 1.0; // halve thresholds to be more sensitive in patient mode
        const effThreshold = Math.max(1, Math.floor(baseThreshold * sensitivityFactor));
        const effMinPixels = Math.max(1, Math.floor(baseMin * sensitivityFactor));
        const energyMultiplier = MOTION_ENERGY_MULTIPLIER;

        const motionRes = detectMotion(
          currentFrameData,
          lastFrameDataRef.current,
          canvas.width,
          effThreshold,
          effMinPixels
        );
        motionCentroids = motionRes.centroids;
        const changed = motionRes.changedPixels;
        const framePixels = canvas.width * canvas.height;
        const percent = framePixels ? changed / framePixels : 0;

        // Compute simple brightness average (sampled) for per-frame diagnostics
        let brightnessSum = 0;
        let brightnessCount = 0;
        const sampleStep = 8; // sample every 8 pixels to keep compute light
        for (let i = 0; i < currentFrameData.length; i += 4 * sampleStep) {
          const g = (currentFrameData[i] + currentFrameData[i + 1] + currentFrameData[i + 2]) / 3;
          brightnessSum += g;
          brightnessCount++;
        }
        const brightnessAvg = brightnessCount ? brightnessSum / brightnessCount : 0;
        const brightnessDelta = lastBrightnessRef.current != null ? Math.abs(brightnessAvg - lastBrightnessRef.current) : 0;
        lastBrightnessRef.current = brightnessAvg;

        // Mean centroid and delta for rough motion magnitude (helps when changed pixels are sparse)
        let meanX = 0;
        let meanY = 0;
        if (motionCentroids.length > 0) {
          for (const p of motionCentroids) {
            meanX += p.x;
            meanY += p.y;
          }
          meanX /= motionCentroids.length;
          meanY /= motionCentroids.length;
        }
        const prevMean = prevMeanRef.current;
        const centroidDelta = prevMean && motionCentroids.length ? Math.hypot(meanX - prevMean.x, meanY - prevMean.y) : 0;
        if (motionCentroids.length > 0) prevMeanRef.current = { x: meanX, y: meanY };

        // Maintain a short history of changed-pixel counts for smoothing/energy
        const h = motionHistoryRef.current;
        h.push(changed);
        if (h.length > MOTION_ENERGY_WINDOW) h.splice(0, h.length - MOTION_ENERGY_WINDOW);
        const movingSum = h.reduce((a, b) => a + b, 0);
        const avgPercent = framePixels && h.length ? movingSum / (framePixels * h.length) : 0;



        // Consider motion detected either by pixel count OR percent-based fallback OR energy over recent frames OR centroidDelta / brightnessDelta
        const percentFallback = percent >= (MOTION_PERCENT_FALLBACK);
        const energyTriggered = movingSum >= (effMinPixels * MOTION_ENERGY_WINDOW * energyMultiplier);
        const deltaTriggered = centroidDelta >= 8 || brightnessDelta >= 6; // empirical fallbacks

        if (changed > effMinPixels || percentFallback || energyTriggered || deltaTriggered) {
          setPatientMotionFrameCount((prev) => prev + 1);
        } else {
          setPatientMotionFrameCount(0);
        }

        // Update overlay stats for UI
        try {
          setMotionStats({ changedPixels: changed, percent, movingSum, avgPercent, centroidDelta, brightnessAvg, brightnessDelta });
        } catch {}
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-canvas.width, 0);

    // Re-draw the video flipped
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (mode === "perimeter_setup" || mode === "perimeter_monitoring") {
      drawPerimeter(ctx);
    }

    if (motionCentroids.length > 0) {
      drawMotion(ctx, motionCentroids);
      if (mode === "perimeter_monitoring") {
        checkPerimeterCrossing(motionCentroids, triggerAlert);
      }
    }
    ctx.restore();

    lastFrameDataRef.current = new Uint8ClampedArray(currentFrameData);
  }, [drawPerimeter, checkPerimeterCrossing, triggerAlert, streamRef, remoteStream]);

  // --- Patient Motion Alert ---
  useEffect(() => {
    if (patientMotionFrameCount >= PATIENT_MOTION_BUFFER_FRAMES) {
      triggerAlert("Movement detected.", "patient_motion");
      setPatientMotionFrameCount(0);
    }
  }, [patientMotionFrameCount, triggerAlert]);

  // --- Animation Loop Control ---
  useEffect(() => {
    const shouldRun = (isCameraActive || !!remoteStream);
    if (shouldRun && !animationFrameIdRef.current) {
      animationFrameIdRef.current = requestAnimationFrame(animationLoop);
    } else if (!shouldRun && animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
    };
  }, [isCameraActive, animationLoop, remoteStream]);

  // Auto-calibrate when entering patient monitoring or when camera starts in patient mode
  useEffect(() => {
    try {
      if (currentMode === 'patient_monitoring') {
        // reset calibrated flag when switching into patient mode
        calibratedRef.current = false;
      }
      if (currentMode === 'patient_monitoring' && isCameraActive && !calibratedRef.current) {
        handleCalibrateMotion();
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMode, isCameraActive]);

  // Attach remote stream to the video element when provided and ensure playback starts
  useEffect(() => {
    if (videoRef.current) {
      try {
        // Log audio track count for diagnostics
        try { 
          const audioTracks = remoteStream ? remoteStream.getAudioTracks().length : 0;
          const videoTracks = remoteStream ? remoteStream.getVideoTracks().length : 0;
          console.log('MonitoringSystem: remoteStream has', videoTracks, 'video and', audioTracks, 'audio tracks');
        } catch {}

        // If remoteStream is falsy, clear the srcObject and stop any playback
        if (!remoteStream) {
          if (videoRef.current.srcObject) {
            videoRef.current.srcObject = null;
            try { videoRef.current.pause(); } catch {}
          }
          return;
        }

        // Avoid re-setting the same stream which can trigger load/play interruptions
        if (videoRef.current.srcObject === remoteStream) {
          // already attached
          console.log('MonitoringSystem: remoteStream already attached, skipping');
          return;
        }

        console.log('MonitoringSystem: setting srcObject to remoteStream and starting playback');
        videoRef.current.srcObject = remoteStream;
        videoRef.current.muted = true;
        // Play may be interrupted if another load occurs; catch and ignore AbortError
        videoRef.current.play().catch((err: unknown) => {
          if ((err as { name?: string }) && (err as { name?: string }).name === 'AbortError') {
            console.warn('MonitoringSystem: remote video play aborted (ignored)', (err as { message?: string }).message || err);
          } else {
            console.warn('MonitoringSystem: remote video play failed', err);
          }
        });
      } catch (e) {
        console.warn('MonitoringSystem: failed to attach remote stream', e);
      }
    }
  }, [remoteStream]);

  const handleStartStopCamera = async () => {
    if (isCameraActive) {
      stopCamera();
      setMode("idle");
    } else {
      const success = await startCamera();
      if (success) {
        setMode("perimeter_setup");
      }
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (currentModeRef.current !== "perimeter_setup") return;
    initAudio(); // Start audio context on user interaction
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickedX = (e.clientX - rect.left) * scaleX;
    // Flipped X coordinate because the canvas is scaledX(-1)
    const x = canvas.width - clickedX;
    const y = (e.clientY - rect.top) * scaleY;
    addPerimeterPoint({ x, y });
  };

  const handleSetPerimeter = () => setMode("perimeter_monitoring");
  const handleClearPerimeter = () => clearPerimeterPoints();
  const handlePatientModeToggle = () =>
    setMode(
      currentModeRef.current === "patient_monitoring"
        ? "perimeter_setup"
        : "patient_monitoring"
    );

  // Motion calibration: samples frames to estimate ambient pixel noise and set thresholds automatically
  const handleCalibrateMotion = async () => {
    // Allow calibration with either local camera (isCameraActive) OR the dependent's remote stream
    if (!isCameraActive && !remoteStream) {
      setLogEntries((prev) => [
        { id: Date.now() + Math.random(), type: "info", message: "Start the camera before calibrating motion.", time: new Date().toLocaleTimeString() },
        ...prev.slice(0, 19),
      ]);
      return;
    }

    // Avoid overlapping calibrations
    if (calibrationRef.current) return;
    calibrationRef.current = true;

    setLogEntries((prev) => [
      { id: Date.now() + Math.random(), type: "info", message: "Auto-calibrating motion sensitivity... please stay still for ~3s.", time: new Date().toLocaleTimeString() },
      ...prev.slice(0, 19),
    ]);

    // Choose the video source: prefer attached videoRef (local or remote). If not available, create a hidden video element for remoteStream
    let video: HTMLVideoElement | null = null;
    try {
      if (videoRef.current && (isCameraActive || videoRef.current.srcObject)) {
        video = videoRef.current;
      } else if (remoteStream) {
        // create an offscreen video element bound to remote stream to ensure we can sample frames
        video = document.createElement('video');
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        try { video.srcObject = remoteStream; } catch (e) { console.warn('MonitoringSystem: failed to set temp video srcObject', e); }
        // wait for metadata or timeout to ensure videoWidth/videoHeight are available
        await new Promise((resolve) => {
          let settled = false;
          const onMeta = () => { if (!settled) { settled = true; resolve(null); } };
          video!.addEventListener('loadedmetadata', onMeta);
          setTimeout(() => { if (!settled) { settled = true; resolve(null); } }, 1500);
        });
      }

      if (!video) {
        throw new Error('No video source available for calibration');
      }

      const samples = 30;
      const intervalMs = 120; // sample every ~120ms for ~3.6s
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = video.videoWidth || 320;
      tempCanvas.height = video.videoHeight || 240;
      const tctx = tempCanvas.getContext('2d') as CanvasRenderingContext2D | null;
      if (!tctx) throw new Error('Failed to get canvas context');

      let lastData: Uint8ClampedArray | null = null;
      const medians: number[] = [];

      for (let i = 0; i < samples; i++) {
        try { tctx.drawImage(video!, 0, 0, tempCanvas.width, tempCanvas.height); } catch { break; }
        let data;
        try { data = tctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height).data; } catch { break; }
        if (lastData) {
          const diffs: number[] = [];
          const step = 4; // finer sampling for sensitivity
          for (let j = 0; j < data.length; j += 4 * step) {
            const g1 = (lastData[j] + lastData[j+1] + lastData[j+2]) / 3;
            const g2 = (data[j] + data[j+1] + data[j+2]) / 3;
            diffs.push(Math.abs(g2 - g1));
          }
          diffs.sort((a,b)=>a-b);
          const mid = Math.floor(diffs.length/2);
          const median = diffs.length ? diffs[mid] : 0;
          medians.push(median);
        }
        lastData = new Uint8ClampedArray(data);
        await new Promise((r) => setTimeout(r, intervalMs));
      }

      const ambientMedian = medians.length ? medians[Math.floor(medians.length/2)] : 0;
      // Be more sensitive: lower baseline and smaller min-pixel proportion
      const newThreshold = Math.max(4, Math.round(ambientMedian * 1.3 + 1));
      const newMinPixels = Math.max(4, Math.round((tempCanvas.width * tempCanvas.height) * 0.0002));

      setPatientThreshold(newThreshold);
      setPatientMinPixels(newMinPixels);
      calibratedRef.current = true;

      setLogEntries((prev) => [
        { id: Date.now() + Math.random(), type: "info", message: `Auto-calibration complete. Threshold ${newThreshold}, minPixels ${newMinPixels}.`, time: new Date().toLocaleTimeString() },
        ...prev.slice(0, 19),
      ]);
    } catch (e) {
      console.warn('MonitoringSystem: calibration failed', e);
      setLogEntries((prev) => [
        { id: Date.now() + Math.random(), type: "error", message: "Auto-calibration failed.", time: new Date().toLocaleTimeString() },
        ...prev.slice(0, 19),
      ]);
    } finally {
      calibrationRef.current = false;
      try {
        // cleanup temp video if it was a separate element
        if (video && video !== videoRef.current) {
          try { ((video as unknown) as { srcObject?: MediaStream | null }).srcObject = null; } catch {}
        }
      } catch {}
    }
  }; 

  const handleEnableAudio = async () => {
    try {
      await initAudio();
      // Play a small test sound if not muted
      try { playSound('sound'); } catch {}
      console.log('MonitoringSystem: audio enabled by user gesture');
    } catch (e) {
      console.warn('MonitoringSystem: failed to enable audio', e);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleBathroomRequest = () => {
    initAudio();
    playSound("bathroom");
    setLogEntries((prev) => [
      {
        id: Date.now() + Math.random(),
        type: "bathroom",
        message: "User needs to go to the bathroom.",
        time: new Date().toLocaleTimeString(),
      },
      ...prev.slice(0, 19),
    ]);
  };

  const handleExportPDF = () => {
    if (logEntries.length === 0) {
      alert("No events to export.");
      return;
    }

    // Create PDF using jsPDF
    const pdf = new jsPDF();
    const timestamp = new Date().toLocaleString();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const pageWidth = pdf.internal.pageSize.getWidth();
    const margin = 10;
    let yPosition = margin;

    // Title
    pdf.setFontSize(16);
    pdf.text("Event Log Report", margin, yPosition);
    yPosition += 10;

    // Generated timestamp
    pdf.setFontSize(10);
    pdf.text(`Generated: ${timestamp}`, margin, yPosition);
    yPosition += 8;

    // Separator
    pdf.setDrawColor(0);
    pdf.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 6;

    // Events header
    pdf.setFontSize(12);
    pdf.text("Events:", margin, yPosition);
    yPosition += 8;

    // Events list
    pdf.setFontSize(9);
    logEntries.forEach((entry) => {
      const text = `[${entry.time}] ${entry.type.toUpperCase()}: ${entry.message}`;
      const lines = pdf.splitTextToSize(text, pageWidth - 2 * margin);
      
      // Check if we need a new page
      if (yPosition + lines.length * 5 > pageHeight - margin) {
        pdf.addPage();
        yPosition = margin;
      }

      pdf.text(lines, margin, yPosition);
      yPosition += lines.length * 5 + 2;
    });

    // Save PDF
    pdf.save(`event-log-${Date.now()}.pdf`);
  };

  const supabase = createClient();

  // When entering perimeter monitoring, publish perimeter points to pairing row
  useEffect(() => {
    if (currentMode === "perimeter_monitoring" && pairingRoomId) {
      // publish current perimeter points to DB so dependent can see them
      (async () => {
        try {
          const canvas = canvasRef.current;
          if (!canvas) return;
          const w = canvas.width || 1;
          const h = canvas.height || 1;
          // normalize points to relative coordinates (0..1)
          const normalized = perimeterPoints.map((p) => ({ x: p.x / w, y: p.y / h }));
          try {
            const resp = await fetch(`/api/signaling/${pairingRoomId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ perimeter_json: JSON.stringify(normalized) }),
            });
            const json = await resp.json();
            if (!resp.ok) console.error('Failed to publish perimeter via API', json);
          } catch (e) {
            console.error('Failed to publish perimeter to pairing_rooms (exception)', e);
          }
        } catch (e) {
          console.error("Failed to publish perimeter to pairing_rooms", e);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMode, pairingRoomId]);


  useEffect(() => {
    if (!pairingRoomId) return;

    console.log('MonitoringSystem: subscribing to room', pairingRoomId);

    const channel = supabase
      .channel(`room-${pairingRoomId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "pairing_rooms", filter: `id=eq.${pairingRoomId}` },
        (payload: { new: { dependent_action?: string; perimeter_json?: string } }) => {
          console.log('MonitoringSystem: received room update', payload);
          const action = payload.new.dependent_action;
          if (action) {
            try {
              if (action === "sos") {
                triggerAlert("Dependent triggered SOS", "sos");
              } else if (action === "bathroom") {
                triggerAlert("Dependent requested bathroom", "bathroom");
              } else {
                // generic dependent message
                triggerAlert(`Dependent: ${action}`, "info");
              }

              // mark as seen to avoid double processing via poll
              try {
                lastSeenDepRef.current = String(action);
              } catch {}

              // clear the dependent_action flag so it doesn't retrigger
              (async () => {
                try {
                  const rid = pairingRoomId;
                  if (rid) {
                    const clearResp = await fetch(`/api/signaling/${rid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dependent_action: null }) });
                    const clearJson = await clearResp.json().catch(() => null);
                    console.log('Guardian: Cleared dependent_action response', clearResp.status, clearJson);
                  }
                } catch (err) {
                  console.warn('Guardian: Failed to clear dependent_action', err);
                }
              })();
            } catch (e) {
              console.warn('Failed to process dependent_action', e);
            }
          } else if (payload.new.perimeter_json) {
            // perimeter updates handled by client drawing already, no-op here
          }
        }
      )
      // Also log raw update payloads for diagnostics
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "pairing_rooms", filter: `id=eq.${pairingRoomId}` },
        (payload: unknown) => {
          try {
            console.log('MonitoringSystem: raw room update payload', JSON.stringify(payload));
          } catch {
            console.log('MonitoringSystem: raw room update payload (failed to stringify)', payload);
          }
        }
      )
      .subscribe((status: unknown) => {
        console.log('MonitoringSystem: channel subscribe status', status);
      });

    try {
      console.log('MonitoringSystem: subscription created for room', pairingRoomId);
    } catch {}

    // Persistent polling fallback: poll the room state every 1s and dedupe events using lastSeenDepRef
    const lastSeenDepRef = { current: null as string | null };
    let pollIntervalId: number | null = window.setInterval(async () => {
      try {
        const resp = await fetch(`/api/signaling/${pairingRoomId}`);
        const js = await resp.json().catch(() => null);
        if (resp.ok && js?.data) {
          const dep = js.data.dependent_action;
          if (dep && dep !== lastSeenDepRef.current) {
            console.log('MonitoringSystem: polled detected dependent_action', dep);
            lastSeenDepRef.current = dep;
            try {
              if (dep === 'sos') triggerAlert('Dependent triggered SOS', 'sos');
              else if (dep === 'bathroom') triggerAlert('Dependent requested bathroom', 'bathroom');
              else if (dep === 'water') triggerAlert('Dependent requested water', 'water');
              else triggerAlert(`Dependent: ${dep}`, 'info');
            } catch (e) {
              console.warn('MonitoringSystem: failed processing polled dependent_action', e);
            }

            // clear it so it won't re-trigger
            try {
              const clearResp = await fetch(`/api/signaling/${pairingRoomId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dependent_action: null }) });
              const clearJson = await clearResp.json().catch(() => null);
              console.log('MonitoringSystem: Cleared dependent_action after poll', clearResp.status, clearJson);
            } catch (err) {
              console.warn('MonitoringSystem: Failed to clear dependent_action after poll', err);
            }
          }
        }
      } catch (e) {
        console.warn('MonitoringSystem: polling failed', e);
      }
    }, 1000);

    // Clear the poll interval on cleanup
    // (we also clear it below in the useEffect cleanup)
    // store pollIntervalId so cleanup can access it
    // NOTE: keep the polling running while the component is mounted to be resilient against missed realtime events
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const __pollInterval = pollIntervalId;

    // Also fetch current room state once on mount so we process any dependent_action that may have been set
    (async () => {
      try {
        const resp = await fetch(`/api/signaling/${pairingRoomId}`);
        const js = await resp.json().catch(() => null);
        console.log('MonitoringSystem: initial room fetch', resp.status, js);
        const dep = js?.data?.dependent_action;
        if (dep) {
          console.log('MonitoringSystem: processing existing dependent_action on mount', dep);
          // Reuse same processing logic
          if (dep === "sos") {
            triggerAlert("Dependent triggered SOS", "sos");
          } else if (dep === "bathroom") {
            triggerAlert("Dependent requested bathroom", "bathroom");
          } else if (dep === "water") {
            triggerAlert("Dependent requested water", "water");
          } else {
            triggerAlert(`Dependent: ${dep}`, "info");
          }

          // Clear it so it won't retrigger
          try {
            const clearResp = await fetch(`/api/signaling/${pairingRoomId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dependent_action: null }) });
            const clearJson = await clearResp.json().catch(() => null);
            console.log('MonitoringSystem: Cleared dependent_action on mount', clearResp.status, clearJson);
          } catch (err) {
            console.warn('MonitoringSystem: Failed to clear dependent_action on mount', err);
          }
        }
      } catch (e) {
        console.warn('MonitoringSystem: initial room fetch failed', e);
      }
    })();

    return () => {
      try {
        channel.unsubscribe();
      } catch {}

      try {
        if (pollIntervalId) {
          clearInterval(pollIntervalId);
          pollIntervalId = null;
        }
      } catch (e) {
        console.warn('MonitoringSystem: failed to clear poll interval on cleanup', e);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairingRoomId]);
  const getStatusText = () => {
    switch (currentMode) {
      case "idle":
        return "Status: Idle";
      case "perimeter_setup":
        return "Status: Camera Active. Click to draw perimeter.";
      case "perimeter_monitoring":
        return "Status: Monitoring Perimeter";
      case "patient_monitoring":
        return "Status: Patient Mode Active (Motion & Sound)";
      default:
        return "Status: Unknown";
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_motionStats, setMotionStats] = useState({ changedPixels: 0, percent: 0, movingSum: 0, avgPercent: 0, centroidDelta: 0, brightnessAvg: 0, brightnessDelta: 0 });
  const lastBrightnessRef = useRef<number | null>(null);
  const prevMeanRef = useRef<{ x: number; y: number } | null>(null);

  const getLogEntryUI = ({ id, time, type, message }: LogEntry) => {
    let headerClass, headerText;
    switch (type) {
      case "sound":
        headerClass = "text-yellow-400";
        headerText = "SOUND";
        break;
      case "patient_motion":
        headerClass = "text-purple-400";
        headerText = "MOTION";
        break;
      case "bathroom":
        headerClass = "text-teal-400";
        headerText = "REQUEST";
        break;
      case "water":
        headerClass = "text-cyan-400";
        headerText = "WATER";
        break;
      case "error":
        headerClass = "text-red-500";
        headerText = "ERROR";
        break;
      case "sos":
        headerClass = "text-red-600 font-extrabold";
        headerText = "!!! SOS !!!";
        break;
      case "info":
        headerClass = "text-blue-400";
        headerText = "INFO";
        break;
      case "perimeter":
        headerClass = "text-green-400";
        headerText = "PERIMETER";
        break; // Changed color
      default:
        headerClass = "text-gray-500";
        headerText = "SYSTEM";
        break;
    }
    return (
      <p key={id}>
        <span className={`font-bold ${headerClass}`}>
          [{time}] {headerText}:
        </span>{" "}
        {message}
      </p>
    );
  };

  return (
    <>
      {/* Main container */}
      <div className="w-full mx-auto max-w-6xl bg-[#F0F0F0] rounded-xl shadow-2xl border-2 border-solid border-black p-6 my-4 space-y-4">
        <h1 className="text-center font-xl font-semibold">{getStatusText()}</h1>

        {/* Video and Log Grid Container*/}
        <div className="grid grid-cols-3">
        {/* Video/Canvas Area */}
        <div className="relative w-full rounded-tl-md rounded-bl-md bg-gray-900 overflow-hidden flex items-center justify-center col-span-2">
          <video
            ref={videoRef}
            className="absolute top-0 left-0 w-full h-full object-cover"
            style={{ transform: "scaleX(-1)" }} // Flip video element for intuitive view
            playsInline
            autoPlay
            muted
            onLoadedMetadata={() => console.log('MonitoringSystem: video onLoadedMetadata fired')}
            onPlay={() => console.log('MonitoringSystem: video onPlay fired')}
            onError={(e) => console.error('MonitoringSystem: video onError', e)}
          ></video>
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 w-full h-full cursor-crosshair z-10"
            onClick={handleCanvasClick}
          ></canvas>
          {!(isCameraActive || !!remoteStream) && (
            <div className="absolute inset-0 bg-black bg-opacity-70 text-white flex flex-col items-center justify-center text-center p-4 rounded-tl-md rounded-bl-md">
              <h2 className="text-2xl font-semibold mb-2">Welcome!</h2>
              <p>Start your camera or wait for the dependent to connect their feed.</p>
            </div>
          )}
        </div>
        {/* Event Log */}
        <div className="bg-[#F0F0F0] border-2 border-solid border-black px-4 rounded-tr-md rounded-br-md h-100 overflow-y-auto">
          <h3 className="font-semibold text-lg text-black text-center p-2 sticky top-0 bg-[#F0F0F0]">Event Log</h3>
          <div className="space-y-1 text-sm">
            {logEntries.length > 0 ? (
              logEntries.map(getLogEntryUI)
            ) : (
              <p className="text-gray-500">No events yet.</p>
            )}
          </div>
        </div>
        </div>

        {/* Controls Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {remoteStream && !isCameraActive ? (
            <button
              disabled
              className="bg-gray-500 text-white font-bold py-2 px-4 rounded-lg transition-all w-full cursor-not-allowed"
              title="Using remote feed"
            >
              Viewing Remote Feed
            </button>
          ) : (
            <button
              onClick={handleStartStopCamera}
              className="bg-[#E7473C] hover:bg-red-500 text-white font-bold py-2 px-4 rounded-lg transition-all w-full"
            >
              {isCameraActive ? "Stop Camera" : "Start Camera"}
            </button>
          )}
          <button
            onClick={handlePatientModeToggle}
            disabled={!(isCameraActive || !!remoteStream)}
            className={`text-white font-bold py-2 px-4 rounded-lg transition-all w-full disabled:bg-gray-600 disabled:cursor-not-allowed ${
              currentMode === "patient_monitoring"
                ? "bg-green-500 hover:bg-green-600 animate-pulse"
                : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {currentMode === "patient_monitoring"
              ? "Patient Mode ON"
              : "Patient Mode"}
          </button>
          <button
            onClick={handleCalibrateMotion}
            disabled={!(isCameraActive || !!remoteStream)}
            className="bg-yellow-600 hover:bg-yellow-700 text-black font-bold py-2 px-4 rounded-lg transition-all w-full disabled:bg-gray-600 disabled:cursor-not-allowed"
          >
            Recalibrate Motion
          </button>

          <button
            onClick={handleSetPerimeter}
            disabled={
              currentMode !== "perimeter_setup" || perimeterPoints.length < 3
            }
            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-all w-full disabled:bg-gray-600 disabled:cursor-not-allowed"
          >
            Set Perimeter
          </button>
          <button
            onClick={handleClearPerimeter}
            disabled={
              !["perimeter_setup", "perimeter_monitoring"].includes(currentMode) ||
              perimeterPoints.length === 0
            }
            className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg transition-all w-full disabled:bg-gray-600 disabled:cursor-not-allowed"
          >
            Clear Perimeter
          </button>
          <button
            onClick={() => onToggleMonitoring ? onToggleMonitoring(!isMonitoring) : undefined}
            disabled={!onToggleMonitoring || !pairingRoomId}
            className={`text-white font-bold py-2 px-4 rounded-lg transition-all w-full ${isMonitoring ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'} ${(!onToggleMonitoring || !pairingRoomId) ? 'opacity-60 cursor-not-allowed' : ''}`}
            title={isMonitoring ? 'Stop Monitoring' : 'Start Monitoring'}
          >
            {isMonitoring ? 'Stop Monitoring' : 'Start Monitoring'}
          </button>
          <button
            onClick={() => setIsMuted((prev) => !prev)}
            disabled={!(isCameraActive || !!remoteStream)}
            className={`text-white font-bold py-2 px-4 rounded-lg transition-all w-full disabled:bg-gray-600 ${
              isMuted
                ? "bg-red-600 hover:bg-red-700"
                : "bg-purple-600 hover:bg-purple-700"
            }`}
          >
            {isMuted ? "Unmute" : "Mute"}
          </button>
          <button
            onClick={handleEnableAudio}
            className={`text-white font-bold py-2 px-4 rounded-lg transition-all w-full bg-gray-700 hover:bg-gray-800`}
          >
            Enable Audio
          </button>
          {/* Export PDF Button */}
          <button
            onClick={handleExportPDF}
            disabled={logEntries.length === 0}
            className="sm:col-span-2 mt-4 sm:mt-0 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-all w-full disabled:bg-gray-600 disabled:cursor-not-allowed"
          >
            Export Event Log
          </button>
        </div>
      </div>
      <style>{`
        .alert-active {
            box-shadow: 0 0 20px 8px rgba(239, 68, 68, 0.7) !important;
        }
    `}</style>
    </>
  );
}