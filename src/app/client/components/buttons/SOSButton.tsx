'use client'
import React, { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { sendDependentAction } from '@/lib/signaling-client'

const SOSButton = () => {
  const [showModal, setShowModal] = useState(false)
  const [isActivated, setIsActivated] = useState(false)
  const [countdown, setCountdown] = useState(10)
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [notified, setNotified] = useState(false)
  const [modalExpired, setModalExpired] = useState(false)
  const [notifiedCountdown, setNotifiedCountdown] = useState(40)
  const [paired, setPaired] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [showToast, setShowToast] = useState(false)

  useEffect(() => {
    if (!showModal) {
      setCountdown(5)
      setIsConfirmed(false)
      setNotified(false)
      setModalExpired(false)
      setNotifiedCountdown(40)
    }
  }, [showModal])

  // Keep paired state in sync with localStorage and other tabs and same-tab events
  useEffect(() => {
    const check = (maybeId?: string | null) => {
      try { setPaired(Boolean(typeof maybeId !== 'undefined' ? maybeId : (typeof window !== 'undefined' && window.localStorage.getItem('pairingRoomId')))); } catch { setPaired(false); }
    }
    check()
    const onStorage = (e: StorageEvent) => { if (e.key === 'pairingRoomId') check() }
    const onPairingChanged = (e: Event) => { try { const ce = e as CustomEvent; check(ce?.detail?.pairingRoomId ?? null) } catch { check() } }
    window.addEventListener('storage', onStorage)
    window.addEventListener('pairing-changed', onPairingChanged as EventListener)
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener('pairing-changed', onPairingChanged as EventListener) }
  }, [])

  const sentRef = useRef(false)

  useEffect(() => {
    if (!showModal || modalExpired) return

    if (countdown > 0 && !isConfirmed) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    }

    if (countdown === 0 && !isConfirmed && !notified) {
      setNotified(true)
      setIsActivated(true)
    }

    if (notified && notifiedCountdown > 0) {
      const timer = setTimeout(() => setNotifiedCountdown(notifiedCountdown - 1), 1000)
      return () => clearTimeout(timer)
    }

    if (notified && notifiedCountdown === 0) {
      setShowModal(false)
      setModalExpired(true)
    }
  }, [countdown, showModal, isConfirmed, notified, modalExpired, notifiedCountdown])

  // send the dependent action to guardian when notified becomes true
  useEffect(() => {
    if (notified && !sentRef.current) {
      sentRef.current = true
      ;(async () => {
        try {
          const res = await sendDependentAction('sos')
          console.log('SOS sent', res)
          if (!res.ok) {
            setToastMessage('Failed to send SOS — not paired or network error')
            setShowToast(true)
            setTimeout(() => setShowToast(false), 4000)
          }
        } catch (err) {
          console.warn('Failed to send SOS', err)
          setToastMessage('Failed to send SOS — network error')
          setShowToast(true)
          setTimeout(() => setShowToast(false), 4000)
        }
      })()
    }
    return () => {}
  }, [notified])

  const handleSOSClick = () => {
    if (!paired) {
      setToastMessage('Not paired — connect to guardian first')
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
      return
    }
    setShowModal(true)
  }

  const handleConfirm = () => {
    setIsConfirmed(true)
    setNotified(true)
    setIsActivated(true)
  }

  const handleDiscard = () => {
    setShowModal(false)
    setIsActivated(false)
  }

  return (
    <>
      <Button 
        onClick={handleSOSClick}
        disabled={showModal}
        className={cn(
          'h-[330px] w-[330px] font-display font-semibold text-8xl rounded-full text-white transition-all duration-300',
          'transform hover:scale-103 active:scale-95',
          'shadow-2xl hover:shadow-3xl',
          'border-b-15 active:border-b-2',
          isActivated ? [
            'bg-red-500 hover:bg-red-500',
            'shadow-[0_0_50px_rgba(239,68,68,0.7)]',
            'animate-[pulse_2s_ease-in-out_infinite]',
            'border-red-700'
          ] : [
            'bg-red-500 hover:bg-red-500',
            'shadow-none',
            'border-red-700 cursor-pointer'
          ]
        )}
      >
        <span className="text-white font-bold drop-shadow-lg">
          SOS
        </span>
      </Button>

      {/* Confirmation Modal */}
      {showModal && !modalExpired && (
        <div className="fixed inset-0 bg-white/50 backdrop-blur-md flex items-center justify-center z-50">
          <div className={cn(
            'bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 transition-all duration-300',
            notified ? 'scale-100' : 'scale-95'
          )}>
            {!notified ? (
              <>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">
                  Emergency Alert
                </h2>
                <p className="text-gray-600 mb-4">
                  Did you accidentally tap SOS?
                </p>
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
                  <p className="text-sm text-gray-700">
                    <span className="font-semibold">Sending EMERGENCY ALERT to your guardian</span> in {countdown}s
                  </p>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={handleDiscard}
                    className="flex-1 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold py-2 cursor-pointer rounded-lg transition-all"
                  >
                    Discard
                  </Button>
                  <Button
                    onClick={handleConfirm}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 cursor-pointer rounded-lg transition-all"
                  >
                    Confirm
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4 animate-pulse">
                    <svg
                      className="w-8 h-8 text-green-600 animate-bounce"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <h2 className="text-2xl font-bold text-gray-800 mb-2">
                    Guardian is Notified
                  </h2>
                  <p className="text-gray-600 mb-4">
                    Emergency alert sent successfully
                  </p>
                  <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-4">
                    <p className="text-sm text-gray-700">
                      Your guardian has been notified. Help is on the way.
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-gray-700">
                      Closing in <span className="text-red-600">{notifiedCountdown}</span>s
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Small toast for not paired / errors */}
      {showToast && (
        <div className={`fixed bottom-4 right-4 ${toastMessage && toastMessage.startsWith('Failed') ? 'bg-red-500' : 'bg-green-500'} text-white font-semibold py-3 px-6 rounded-lg shadow-lg animate-fade-in z-50`}>
          {toastMessage}
        </div>
      )}
    </>
  )
}

export default SOSButton
