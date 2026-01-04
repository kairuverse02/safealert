"use client"
import React, { useEffect, useState } from 'react'
import ScanQr from './components/ScanQr';
import PatientScanner from './components/PatientScanner';

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
        <ScanQr />
      )}
    </div>
    </>
  );
}