// --- Constants ---
export const ALERT_COOLDOWN = 3000; // ms
export const SOS_COOLDOWN = 15000; // ms
export const PATIENT_MOTION_BUFFER_FRAMES = 3;
export const PERIMETER_MOTION_THRESHOLD = 30; // Pixel brightness difference
export const PERIMETER_MIN_MOTION_PIXELS = 100; // Min pixels changed
export const PATIENT_MOTION_THRESHOLD = 6;
export const PATIENT_MIN_MOTION_PIXELS = 4;
export const MOTION_PERCENT_FALLBACK = 0.002; // fraction of frame (0.2%) to consider motion if pixel count is low
export const MOTION_ENERGY_WINDOW = 5; // number of frames to smooth motion over
export const MOTION_ENERGY_MULTIPLIER = 0.6; // multiplier applied to minPixels * window to detect motion-energy
export const SOUND_THRESHOLD = -30; // dB
export const SOUND_DETECTION_CONSECUTIVE = 3; // consecutive readings above threshold required
export const SOUND_COOLDOWN_MS = 3000; // ms between sound notifications

// Cough/spike detection: single strong spike is considered a cough/distress indicator
export const COUGH_THRESHOLD = -12; // dB - single-sample spike threshold for cough-like events
export const COUGH_DETECTION_CONSECUTIVE = 1; // consecutive readings above cough threshold
export const COUGH_COOLDOWN_MS = 5000; // ms between cough notifications

export const SOS_DURATION = 10000; // ms
export const SOS_FLASH_INTERVAL = 500; // ms
export const SOS_COUNTDOWN_DURATION = 5; // seconds