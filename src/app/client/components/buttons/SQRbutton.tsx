'use client'
import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScanQrCode } from 'lucide-react'
import QrScannerModal from './QrScannerModal'

const SQRbutton: React.FC = () => {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-4 h-20 w-64 rounded-xl bg-[#E7473C] hover:bg-[#D9271B] text-white font-bold px-4 mt-12">
        <div className='flex items-center gap-2'>
        <ScanQrCode size={48}/>
        <span className="text-3xl font-bold flex-end">CONNECT</span>
        </div>
      </button>
      <QrScannerModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export default SQRbutton
