import { useState, useRef, useEffect, useCallback } from "react";
import { Point, MonitoringMode } from "@/types";
import { isPointInPolygon } from "@/lib/geometry";

type CrossingCallback = (message: string, type: "perimeter") => void;

export function usePerimeter(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  currentMode: MonitoringMode
) {
  const [points, setPoints] = useState<Point[]>([]);
  const pointsRef = useRef(points);
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  const addPoint = useCallback((point: Point) => {
    setPoints((prev) => [...prev, point]);
  }, []);

  const clearPoints = useCallback(() => {
    setPoints([]);
  }, []);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const pts = pointsRef.current;
      if (pts.length === 0) return;
      ctx.strokeStyle = "rgba(52, 211, 153, 0.8)";
      ctx.lineWidth = 4;
      ctx.fillStyle = "rgba(52, 211, 153, 0.2)";
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (currentMode === "perimeter_monitoring" && pts.length > 1) {
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
      } else {
        ctx.stroke();
      }
    },
    [currentMode]
  );

  const checkCrossing = useCallback(
    (centroids: Point[], onCrossingDetected: CrossingCallback) => {
      const pts = pointsRef.current;
      for (const centroid of centroids) {
        if (isPointInPolygon(centroid, pts)) {
          onCrossingDetected(`Object detected inside perimeter.`, "perimeter");
          break;
        }
      }
    },
    []
  );

  return { points, addPoint, clearPoints, draw, checkCrossing };
}