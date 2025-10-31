import { Point } from "@/types";

/**
 * Detects motion between two frames based on grayscale difference.
 */
export const detectMotion = (
  currentFrameData: Uint8ClampedArray,
  lastFrameData: Uint8ClampedArray | null,
  width: number,
  threshold: number,
  minPixels: number
): Point[] => {
  if (!lastFrameData || !currentFrameData || !width) return [];

  let changedPixels = 0;
  const motionPoints: Point[] = [];
  const centroids: Point[] = [];

  for (let i = 0; i < currentFrameData.length; i += 4) {
    const gray1 =
      (lastFrameData[i] + lastFrameData[i + 1] + lastFrameData[i + 2]) / 3;
    const gray2 =
      (currentFrameData[i] + currentFrameData[i + 1] + currentFrameData[i + 2]) /
      3;
    if (Math.abs(gray1 - gray2) > threshold) {
      motionPoints.push({
        x: (i / 4) % width,
        y: Math.floor(i / 4 / width),
      });
      changedPixels++;
    }
  }

  if (changedPixels > minPixels && motionPoints.length > 0) {
    const sum = motionPoints.reduce(
      (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
      { x: 0, y: 0 }
    );
    centroids.push({ x: sum.x / motionPoints.length, y: sum.y / motionPoints.length });
  }
  return centroids;
};