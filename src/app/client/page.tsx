"use client"
import React from 'react'
import { useSearchParams } from 'next/navigation'
import ScanQr from './components/ScanQr';
import PatientScanner from './components/PatientScanner';

export default function Home(){
  const searchParams = useSearchParams();
  const pairWithId = searchParams.get('pairWith');

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