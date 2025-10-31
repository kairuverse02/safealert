'use client'

import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react';

interface QrScannerModalProps {
  open: boolean
  onClose: () => void
}

export default function QrScannerModal({ open, onClose }: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

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
          // @ts-ignore
          videoRef.current.srcObject = null
        } catch (e) {
          // ignore
        }
      }
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[50%] max-w-xl rounded-lg bg-white p-4 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-semibold">SCAN QR CODE</h2>
          <button className="text-sm text-gray-600 hover:cursor-pointer" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="h-72 bg-black rounded-md overflow-hidden flex items-center justify-center">
          <video ref={videoRef} className="w-full h-full object-cover" />
        </div>
        <div className="mt-3 text-sm text-gray-600">Point your camera at a QR code to scan it.</div>
      </div>
    </div>
  )
}
