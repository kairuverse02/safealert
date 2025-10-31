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
import { useCamera } from "@/hooks/useCamera";
import { usePerimeter } from "@/hooks/usePerimeter";
import { useSOS } from "@/hooks/useSOS";
import { useSoundDetection } from "@/hooks/useSoundDetection";

export default function MonitoringSystem() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastFrameDataRef = useRef<Uint8ClampedArray | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);

  const [currentMode, setCurrentMode] = useState<MonitoringMode>("idle");
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [patientMotionFrameCount, setPatientMotionFrameCount] = useState(0);
  const [lastAlertTime, setLastAlertTime] = useState(0);

  const currentModeRef = useRef(currentMode);
  useEffect(() => {
    currentModeRef.current = currentMode;
  }, [currentMode]);

  // --- Integrate Hooks ---
  const { initAudio, playSound, synthRef } = useAudio(isMuted);

  const triggerAlert = useCallback(
    (message: string, type: LogEntryType = "perimeter") => {
      const now = Date.now();
      setLastAlertTime((prevTime) => {
        if (
          now - prevTime < ALERT_COOLDOWN &&
          !["sos", "info", "error"].includes(type)
        )
          return prevTime;

        if (type !== "sos" && type !== "info") {
          playSound(type as any); // Type assertion as playSound has stricter types
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
        return now;
      });
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
      <div className="w-full max-w-3xl mx-auto bg-gray-200 rounded-2xl shadow-2xl p-6 space-y-4">
        {/* Header */}
        <p className="mt-1 text-center">{getStatusText()}</p>

        {/* Video/Canvas Area */}
        <div className="relative w-full bg-gray-900 rounded-lg overflow-hidden flex items-center justify-center">
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
            className="w-full h-100 cursor-crosshair"
            onClick={handleCanvasClick}
          ></canvas>
          {!isCameraActive && (
            <div className="absolute inset-0 bg-black bg-opacity-70 flex flex-col items-center justify-center text-center p-4 rounded-lg">
              <h2 className="text-2xl font-semibold mb-2">Welcome!</h2>
              <p>Click the "Start Camera" button below to begin.</p>
            </div>
          )}
        </div>

        {/* Controls Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <button
            onClick={handleStartStopCamera}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-all w-full"
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

        {/* Event Log */}
        <div className="bg-gray-900 p-4 rounded-lg h-32 overflow-y-auto">
          <h3 className="font-semibold text-lg mb-2">Event Log</h3>
          <div className="space-y-1 text-sm">
            {logEntries.length > 0 ? (
              logEntries.map(getLogEntryUI)
            ) : (
              <p className="text-gray-500">No events yet.</p>
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