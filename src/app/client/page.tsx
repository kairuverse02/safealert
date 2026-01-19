"use client"
import React, { useEffect, useState } from 'react'
import Image from 'next/image';
import PatientScanner from './components/PatientScanner';
import SQRbutton from './components/buttons/SQRbutton';

export default function Home(){
  const [pairWithId, setPairWithId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      setPairWithId(params.get('pairWith'));
    }
  }, []);

  return (
    <>
    <div>
      {pairWithId ? (
        <PatientScanner initialRoomId={pairWithId} />
      ) : (
        <div className="flex flex-col items-center justify-center gap-3 sm:gap-4 md:gap-6 text-center px-4 h-screen overflow-hidden">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-[#E7473C] w-full max-w-[1200px]">
            Scan To Pair
          </h1>
          <h3 className="text-sm sm:text-base md:text-lg font-semibold text-gray-700 max-w-md flex-shrink-0">
            To Connect, Scan The QR Code From Your Guardian&apos;s device.
          </h3>
          <Image
            src="/assets/ScanQR.png"
            alt="QR Code"
            width={400}
            height={400}
            priority
            className="h-64 w-64 sm:h-72 sm:w-72 md:h-80 md:w-80 lg:h-96 lg:w-96 object-contain mx-auto flex-shrink-0"
          />
          <SQRbutton />
        </div>
      )}
    </div>
    </>
  );
}