"use client";

import React, { useRef } from 'react'
import { useSearchParams } from 'next/navigation';
import MonitoringSystem from '@/app/admin/components/MonitoringSystem';

const page = () => {
  const searchParams = useSearchParams();
  const roomId = searchParams.get('roomId');
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)

  return (
    <div className='container max-w-[1400px] mt-6 mx-auto p-2 rounded-md bg-white shadow-md'>
      <h1 className="text-[#E7473C] text-4xl font-bold w-full max-w-[1200px] mx-auto mt-4">Your Dashboard</h1>
      <MonitoringSystem pairingRoomId={roomId} />
    </div>
  )
}

export default page
