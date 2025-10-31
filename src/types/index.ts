export type Point = {
  x: number;
  y: number;
};

export type LogEntryType =
  | "sound"
  | "patient_motion"
  | "bathroom"
  | "error"
  | "sos"
  | "info"
  | "perimeter"
  | "system";

export type LogEntry = {
  id: number;
  type: LogEntryType;
  message: string;
  time: string;
};

export type MonitoringMode =
  | "idle"
  | "perimeter_setup"
  | "perimeter_monitoring"
  | "patient_monitoring";