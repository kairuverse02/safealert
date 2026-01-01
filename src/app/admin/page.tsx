"use client";

import MonitoringSystem from "./components/MonitoringSystem";
import GuardianPairing from "./components/GuardianPairing";
import React, { useState } from "react";


export default function Home() {
  const [pairingRoomId, setPairingRoomId] = useState<string | null>(null);

  return (
    <>
      <div>
        <h1 className="text-neutral-950 text-3xl font-semibold w-full max-w-[1200px] mx-auto mt-10">Your Dashboard</h1>
        <div className="mx-auto max-w-[1200px] mt-6">
          <GuardianPairing onRoomCreated={(id: string) => setPairingRoomId(id)} />
        </div>
      </div>
    </>
  );
}
