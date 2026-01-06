'use client'
import React, { useState } from 'react'
import { LogEntry } from "@/types";
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


  

const AlertsLog = () => {
    const [logEntries] = useState<LogEntry[]>([]);
  return (
    <div>
      <div className='bg-neutral-200 h-[440px]'>
        <h1 className='pl-2 text-black font-semibold text-lg '>
        Events Log
        </h1>

      </div>
    </div>
  )
}

export default AlertsLog
