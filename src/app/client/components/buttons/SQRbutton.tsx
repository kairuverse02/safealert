'use client'
import React, { useEffect, useState } from 'react'
import { ScanQrCode } from 'lucide-react'
import QrScannerModal from './QrScannerModal'

const SQRbutton: React.FC = () => {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handleQrScanned = (event: Event) => {
      const customEvent = event as CustomEvent;
      const roomId = customEvent.detail;
      console.log('QR code or join code received:', roomId);
      window.dispatchEvent(new CustomEvent('pairDevice', { detail: roomId }));
    };

    window.addEventListener('qrCodeScanned', handleQrScanned);
    return () => window.removeEventListener('qrCodeScanned', handleQrScanned);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-2 sm:gap-3 md:gap-4 h-16 sm:h-20 md:h-24 w-48 sm:w-64 md:w-80 rounded-lg sm:rounded-xl bg-[#E7473C] cursor-pointer hover:bg-[#D9271B] text-white font-bold px-3 sm:px-4 transition-all duration-200 hover:shadow-lg">
        <div className='flex items-center gap-2 sm:gap-2 md:gap-3'>
        <ScanQrCode size={32} className="sm:w-10 sm:h-10 md:w-12 md:h-12"/>
        <span className="text-lg sm:text-2xl md:text-3xl font-bold">CONNECT</span>
        </div>
      </button>
      <QrScannerModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export default SQRbutton
