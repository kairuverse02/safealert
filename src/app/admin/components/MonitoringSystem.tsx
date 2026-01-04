"use client"; // VERY IMPORTANT! This enables hooks and browser APIs

import React, { useState, useRef, useEffect, useCallback } from "react";
import { LogEntry, LogEntryType, MonitoringMode, Point } from "@/types";
import {
  ALERT_COOLDOWN,
  PATIENT_MOTION_BUFFER_FRAMES,
  PERIMETER_MIN_MOTION_PIXELS,
  PERIMETER_MOTION_THRESHOLD,
  PATIENT_MIN_MOTION_PIXELS,
  PATIENT_MOTION_THRESHOLD,
  SOS_FLASH_INTERVAL,
} from "@/lib/constants";
import { detectMotion } from "@/lib/motion";
import { useAudio } from "@/hooks/useAudio";
import { createClient } from "@/lib/supabase/client";
import { useCamera } from "@/hooks/useCamera";
import { usePerimeter } from "@/hooks/usePerimeter";
import { useSOS } from "@/hooks/useSOS";
import { useSoundDetection } from "@/hooks/useSoundDetection";

type Props = {
  pairingRoomId?: string | null;
};

export default function MonitoringSystem({ pairingRoomId }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastFrameDataRef = useRef<Uint8ClampedArray | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const lastAlertTimeRef = useRef(0);

  const [currentMode, setCurrentMode] = useState<MonitoringMode>("idle");
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [patientMotionFrameCount, setPatientMotionFrameCount] = useState(0);

  const currentModeRef = useRef(currentMode);
  useEffect(() => {
    currentModeRef.current = currentMode;
  }, [currentMode]);

  // --- Integrate Hooks ---
  const { initAudio, playSound, synthRef } = useAudio(isMuted);

  const triggerAlert = useCallback(
    (message: string, type: LogEntryType = "perimeter") => {
      const now = Date.now();
      const prevTime = lastAlertTimeRef.current;
      
      if (
        now - prevTime < ALERT_COOLDOWN &&
        !["sos", "info", "error"].includes(type)
      ) {
        return;
      }

      if (type !== "sos" && type !== "info") {
        playSound(type as 'sound' | 'patient_motion' | 'error' | 'perimeter' | 'bathroom');
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
    },
    [playSound]
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
    currentMode === "patient_monitoring",
    triggerAlert,
    triggerAlert,
    initAudio
  );
  const { isSosActive, countdown, triggerSOS, cancelSOS } = useSOS(
    triggerAlert,
    isMuted,
    initAudio,
    synthRef
  );

  // --- State/Mode Management ---
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

  // --- Drawing Utility ---
  // This function was missing in your original code, so I've added a basic implementation
  const drawMotion = (ctx: CanvasRenderingContext2D, centroids: Point[]) => {
    ctx.fillStyle = "rgba(255, 0, 0, 0.5)"; // Red circles for motion
    centroids.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10, 0, 2 * Math.PI); // 10px radius circle
      ctx.fill();
    });
  };

  // --- Main Animation Loop ---
  const animationLoop = useCallback(() => {
    animationFrameIdRef.current = requestAnimationFrame(animationLoop);

    if (
      !streamRef.current ||
      !videoRef.current ||
      !canvasRef.current ||
      videoRef.current.readyState < videoRef.current.HAVE_METADATA
    ) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      return;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
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
        motionCentroids = detectMotion(
          currentFrameData,
          lastFrameDataRef.current,
          canvas.width,
          PERIMETER_MOTION_THRESHOLD,
          PERIMETER_MIN_MOTION_PIXELS
        );
      } else if (mode === "patient_monitoring") {
        motionCentroids = detectMotion(
          currentFrameData,
          lastFrameDataRef.current,
          canvas.width,
          PATIENT_MOTION_THRESHOLD,
          PATIENT_MIN_MOTION_PIXELS
        );
        if (motionCentroids.length > 0) {
          setPatientMotionFrameCount((prev) => prev + 1);
        } else {
          setPatientMotionFrameCount(0);
        }
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
  }, [drawPerimeter, checkPerimeterCrossing, triggerAlert, streamRef]);

  // --- Patient Motion Alert ---
  useEffect(() => {
    if (patientMotionFrameCount >= PATIENT_MOTION_BUFFER_FRAMES) {
      triggerAlert("Movement detected.", "patient_motion");
      setPatientMotionFrameCount(0);
    }
  }, [patientMotionFrameCount, triggerAlert]);

  // --- Animation Loop Control ---
  useEffect(() => {
    if (isCameraActive && !animationFrameIdRef.current) {
      animationFrameIdRef.current = requestAnimationFrame(animationLoop);
    } else if (!isCameraActive && animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
        animationFrameIdRef.current = null;
      }
    };
  }, [isCameraActive, animationLoop]);

  // --- Event Handlers ---
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

  const handleBathroomRequest = () => {
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

  // --- UI Rendering ---

  // Supabase client for publishing perimeter and listening for dependent actions
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

  // Subscribe to dependent actions (sos/bathroom) from pairing row
  useEffect(() => {
    if (!pairingRoomId) return;
    const channel = supabase
      .channel(`room-${pairingRoomId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "pairing_rooms", filter: `id=eq.${pairingRoomId}` },
        (payload: { new: { dependent_action?: string; perimeter_json?: string } }) => {
          const action = payload.new.dependent_action;
          if (action === "sos") {
            triggerAlert("Dependent triggered SOS", "sos");
          } else if (action === "bathroom") {
            triggerAlert("Dependent requested bathroom", "bathroom");
          } else if (payload.new.perimeter_json) {
            // perimeter updates handled by client drawing already, no-op here
          }
        }
      )
      .subscribe();

    return () => {
      try {
        channel.unsubscribe();
      } catch {}
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
        {/* Header */}
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
          ></video>
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 w-full h-full cursor-crosshair z-10"
            onClick={handleCanvasClick}
          ></canvas>
          {!isCameraActive && (
            <div className="absolute inset-0 bg-black bg-opacity-70 text-white flex flex-col items-center justify-center text-center p-4 rounded-tl-md rounded-bl-md">
              <h2 className="text-2xl font-semibold mb-2">Welcome!</h2>
              <p>Click the &quot;Start Camera&quot; button below to begin.</p>
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
          <button
            onClick={handleStartStopCamera}
            className="bg-[#E7473C] hover:bg-red-500 text-white font-bold py-2 px-4 rounded-lg transition-all w-full"
          >
            {isCameraActive ? "Stop Camera" : "Start Camera"}
          </button>
          <button
            onClick={handlePatientModeToggle}
            disabled={!isCameraActive}
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
            onClick={handleBathroomRequest}
            disabled={!isCameraActive}
            className="bg-teal-500 hover:bg-teal-600 text-white font-bold py-2 px-4 
            rounded-lg transition-all w-full disabled:bg-gray-600 disabled:cursor-not-allowed"
          >
            Bathroom
          </button>
          <button
            onClick={() => setIsMuted((prev) => !prev)}
            disabled={!isCameraActive}
            className={`text-white font-bold py-2 px-4 rounded-lg transition-all w-full disabled:bg-gray-600 ${
              isMuted
                ? "bg-red-600 hover:bg-red-700"
                : "bg-purple-600 hover:bg-purple-700"
            }`}
          >
            {isMuted ? "Unmute" : "Mute"}
          </button>
          {/* SOS Button Area */}
          <div className="sm:col-span-2 mt-4 sm:mt-0 flex flex-col sm:flex-row gap-2">
            <button
              onClick={triggerSOS}
              disabled={!isCameraActive || isSosActive || countdown > 0}
              className={`flex-grow bg-red-800 hover:bg-red-900 text-white font-extrabold text-xl py-3 px-6 rounded-lg transition-all w-full disabled:bg-gray-600 disabled:cursor-not-allowed ${
                isSosActive ? "animate-pulse" : ""
              }`}
            >
              {isSosActive
                ? "SOS ACTIVE!"
                : countdown > 0
                ? `SOS IN ${countdown}s...`
                : "SOS ALERT"}
            </button>
            {countdown > 0 && (
              <button
                onClick={cancelSOS}
                className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-lg transition-all w-full sm:w-auto"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
      {/* Inline styles for alert flash */}
      <style>{`
        .alert-active {
            box-shadow: 0 0 20px 8px rgba(239, 68, 68, 0.7) !important;
        }
    `}</style>
    </>
  );
}