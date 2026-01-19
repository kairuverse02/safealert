'use client'

import React, { useEffect, useRef, useState } from 'react'
import { X, Loader } from 'lucide-react';
import jsQR from 'jsqr'

interface QrScannerModalProps {
  open: boolean
  onClose: () => void
}

export default function QrScannerModal({ open, onClose }: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [pasteInput, setPasteInput] = useState<string>('')
  const [useCamera, setUseCamera] = useState<boolean>(true)
  const [scaning, setScanning] = useState(false)

  // QR code detection library
  useEffect(() => {
    if (!open) return

    let mounted = true
    let currentVideo: HTMLVideoElement | null = null
    let animationFrameId: number | null = null

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment' }, 
          audio: false 
        })
        if (!mounted) return
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          currentVideo = videoRef.current
          setScanning(true)
        }
      } catch (err) {
        console.error('Could not start camera', err)
        setScanning(false)
      }
    }

    startCamera()

    // Simple QR code detection using canvas
    const detectQRCode = async () => {
      if (!videoRef.current || !canvasRef.current || !mounted) return

      try {
        const video = videoRef.current
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight

          ctx?.drawImage(video, 0, 0, canvas.width, canvas.height)

          // Use jsQR library if available (can be added to package.json)
          // For now, just keep scanning
          if (typeof (window as any).jsQR !== 'undefined') {
            const imageData = ctx?.getImageData(0, 0, canvas.width, canvas.height)
            if (imageData) {
              const code = (window as any).jsQR(imageData.data, imageData.width, imageData.height)
              if (code && code.data) {
                console.log('QR code detected:', code.data)
                // Extract room ID from QR data
                const roomId = code.data.split('=').pop() || code.data
                handleQRDetected(roomId)
                return
              }
            }
          }
        }
      } catch (err) {
        console.error('QR detection error:', err)
      }

      if (mounted) {
        animationFrameId = requestAnimationFrame(detectQRCode)
      }
    }

    const handleQRDetected = (roomId: string) => {
      console.log('QR code scanned:', roomId)
      setPasteInput('')
      onClose()
      setScanning(false)
      window.dispatchEvent(new CustomEvent('qrCodeScanned', { detail: roomId.trim() }))
    }

    if (useCamera && videoRef.current) {
      animationFrameId = requestAnimationFrame(detectQRCode)
    }

    return () => {
      mounted = false
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId)
      }
      const v = currentVideo
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
      if (v) {
        try {
          v.pause()
          ;(v as HTMLVideoElement).srcObject = null
        } catch {
          // ignore
        }
      }
    }
  }, [open, useCamera])

  if (!open) return null

  const handlePasteAndClose = async () => {
    if (pasteInput.trim()) {
      console.log('Pairing with room:', pasteInput.trim())
      setPasteInput('')
      onClose()
      setScanning(false)
      window.dispatchEvent(new CustomEvent('qrCodeScanned', { detail: pasteInput.trim() }))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full sm:w-[90%] max-w-xl rounded-lg bg-white p-4 sm:p-6 shadow-lg mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg sm:text-xl font-semibold">
            {useCamera ? 'SCAN QR CODE' : 'PASTE JOIN CODE'}
          </h2>
          <button 
            className="text-gray-600 hover:text-gray-900 transition-colors" 
            onClick={onClose} 
            aria-label="Close"
          >
            <X size={24} />
          </button>
        </div>

        {useCamera ? (
          <>
            <div className="relative h-64 sm:h-72 bg-black rounded-md overflow-hidden flex items-center justify-center">
              <video 
                ref={videoRef} 
                className="w-full h-full object-cover" 
                playsInline
              />
              <canvas 
                ref={canvasRef} 
                style={{ display: 'none' }} 
              />
              {scaning && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="border-4 border-green-500 w-32 h-32 rounded-lg animate-pulse"></div>
                </div>
              )}
            </div>
            <div className="mt-3 text-sm text-gray-600">
              Point your camera at a QR code to scan it.
            </div>
            <button
              onClick={() => setUseCamera(false)}
              className="mt-4 w-full py-2 text-blue-600 hover:text-blue-700 text-sm font-semibold transition-colors"
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handlePasteAndClose()
                  }
                }}
                placeholder="Paste the room ID here..."
                autoFocus
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm sm:text-base"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePasteAndClose}
                disabled={!pasteInput.trim()}
                className="flex-1 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-semibold disabled:bg-gray-400 transition-colors text-sm sm:text-base"
              >
                Join
              </button>
              <button
                onClick={() => setUseCamera(true)}
                className="flex-1 py-2 text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 font-semibold transition-colors text-sm sm:text-base"
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
