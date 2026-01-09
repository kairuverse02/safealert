'use client'
import React, { useState, useEffect } from 'react'
import {Button} from '@/components/ui/button'
import { sendDependentAction } from '@/lib/signaling-client'

const Water = () => {
  const [showToast, setShowToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')
  const [isOnCooldown, setIsOnCooldown] = useState(false)
  const [cooldownTime, setCooldownTime] = useState(0)
  const [paired, setPaired] = useState(false)
  const COOLDOWN_DURATION = 10

  // Keep paired state in sync with localStorage and other tabs and same-tab events
  useEffect(() => {
    const check = (maybeId?: string | null) => {
      try { setPaired(Boolean(typeof maybeId !== 'undefined' ? maybeId : (typeof window !== 'undefined' && window.localStorage.getItem('pairingRoomId')))); } catch { setPaired(false); }
    }
    check()
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'pairingRoomId') check()
    }
    const onPairingChanged = (e: Event) => {
      try { const ce = e as CustomEvent; check(ce?.detail?.pairingRoomId ?? null); } catch { check(); }
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('pairing-changed', onPairingChanged as EventListener)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('pairing-changed', onPairingChanged as EventListener)
    }
  }, [])

  useEffect(() => {
    if (!isOnCooldown) return

    if (cooldownTime > 0) {
      const timer = setTimeout(() => setCooldownTime(cooldownTime - 1), 1000)
      return () => clearTimeout(timer)
    }

    if (cooldownTime === 0 && isOnCooldown) {
      setIsOnCooldown(false)
    }
  }, [isOnCooldown, cooldownTime])

  const handleClick = async () => {
    const roomId = typeof window !== 'undefined' ? window.localStorage.getItem('pairingRoomId') : null;
    if (!roomId) {
      // show an error toast for missing pairing
      setToastMessage('Not paired — connect to guardian first')
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
      console.warn('No pairing room id present — cannot send dependent action')
      return
    }

    setToastMessage('✓ I Need Water sent to your guardian')
    setShowToast(true)
    setIsOnCooldown(true)
    setCooldownTime(COOLDOWN_DURATION)

    // attempt to send dependent action to guardian
    try {
      const res = await sendDependentAction('water')
      if (!res.ok) {
        console.warn('sendDependentAction failed', res)
        // indicate failure to user by briefly toggling toast off/on to draw attention
        setToastMessage('Failed to notify guardian')
        setShowToast(false)
        setTimeout(() => setShowToast(true), 100)
      }
    } catch (err) {
      console.warn('sendDependentAction error', err)
      setToastMessage('Failed to notify guardian')
    }

    setTimeout(() => setShowToast(false), 3000)
  }

  return (
    <>
      <Button 
        onClick={handleClick}
        disabled={!paired || isOnCooldown}
        className='bg-[#329344] hover:bg-teal-600 text-white font-bold py-2 px-4 
            rounded-lg transition-all disabled:bg-gray-600 cursor-pointer disabled:cursor-not-allowed'
      >
        {isOnCooldown ? `I Need Water ${cooldownTime}s` : (paired ? 'I Need Water' : 'Not paired')}
      </Button>
      {!paired && (
        <p className="text-sm text-red-500 mt-2">Not paired — connect to your guardian to enable this button</p>
      )}

      {/* Toast Notification */}
      {showToast && (
        <div className={`fixed bottom-4 right-4 ${toastMessage && toastMessage.startsWith('Failed') ? 'bg-red-500' : 'bg-green-500'} text-white font-semibold py-3 px-6 rounded-lg shadow-lg animate-fade-in z-50`}>
          {toastMessage || '✓ I Need Water sent to your guardian'}
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fadeIn 0.3s ease-out;
        }
      `}</style>
    </>
  )
}

export default Water
