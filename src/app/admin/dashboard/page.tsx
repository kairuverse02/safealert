"use client";

import React, { useState, useEffect } from 'react'
import MonitoringSystem from '@/app/admin/components/MonitoringSystem';

const Page = () => {
  const [roomId, setRoomId] = useState<string | null>(null);


  useEffect(() => {
    try {
      const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      setRoomId(sp.get('roomId'));
    } catch {}
  }, []);

  return (
    <div className='container max-w-[1400px] mt-6 mx-auto p-2 rounded-md bg-white shadow-md'>
      <h1 className="text-[#E7473C] text-4xl font-bold w-full max-w-[1200px] mx-auto mt-4">Your Dashboard</h1>
      <MonitoringSystem pairingRoomId={roomId} />
    </div>
  )
}

export default Page
