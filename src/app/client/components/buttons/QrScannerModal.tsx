'use client'

import React, { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react';

interface QrScannerModalProps {
  open: boolean
  onClose: () => void
}

export default function QrScannerModal({ open, onClose }: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [pasteInput, setPasteInput] = useState<string>('')
  const [useCamera, setUseCamera] = useState<boolean>(true)

  useEffect(() => {
    if (!open) return

    let mounted = true

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (!mounted) return
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch (err) {
        console.error('Could not start camera', err)
      }
    }

    startCamera()

    return () => {
      mounted = false
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
      if (videoRef.current) {
        try {
          videoRef.current.pause()
          // @ts-expect-error - srcObject may not be defined in type
          videoRef.current.srcObject = null
        } catch {
          // ignore
        }
      }
    }
  }, [open])

  if (!open) return null

  const handlePasteAndClose = async () => {
    if (pasteInput.trim()) {
      console.log('Pairing with room:', pasteInput.trim());
      setPasteInput('');
      onClose();
      // Trigger pairing - dispatch custom event so parent can handle it
      window.dispatchEvent(new CustomEvent('qrCodeScanned', { detail: pasteInput.trim() }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[50%] max-w-xl rounded-lg bg-white p-4 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">{useCamera ? 'SCAN QR CODE' : 'PASTE JOIN CODE'}</h2>
          <button className="text-sm text-gray-600 hover:cursor-pointer" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        
        {useCamera ? (
          <>
            <div className="h-72 bg-black rounded-md overflow-hidden flex items-center justify-center">
              <video ref={videoRef} className="w-full h-full object-cover" />
            </div>
            <div className="mt-3 text-sm text-gray-600">Point your camera at a QR code to scan it.</div>
            <button 
              onClick={() => setUseCamera(false)}
              className="mt-3 w-full py-2 text-blue-600 hover:text-blue-700 text-sm font-semibold"
            >
              Or paste join code instead
            </button>
          </>
        ) : (
          <>
            <div className="mt-2 mb-4">
              <input
                type="text"
                value={pasteInput}
                onChange={(e) => setPasteInput(e.target.value)}
                placeholder="Paste the room ID here..."
                autoFocus
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePasteAndClose}
                className="flex-1 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold"
              >
                Join
              </button>
              <button
                onClick={() => setUseCamera(true)}
                className="flex-1 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 font-semibold"
              >
                Use Camera
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
