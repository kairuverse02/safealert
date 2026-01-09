'use client'
import React, { useState, useEffect } from 'react'
import {Button} from '@/components/ui/button'
import { Bath } from 'lucide-react'
import { sendDependentAction } from '@/lib/signaling-client'

const Bathroom = () => {
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
      setToastMessage('Not paired — connect to guardian first')
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
      console.warn('No pairing room id present — cannot send dependent action')
      return
    }

    setToastMessage('✓ I Need Bathroom sent to your guardian')
    setShowToast(true)
    setIsOnCooldown(true)
    setCooldownTime(COOLDOWN_DURATION)

    try {
      const res = await sendDependentAction('bathroom')
      if (!res.ok) {
        console.warn('sendDependentAction failed', res)
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

  const triggerMicTest = async () => {
    console.log('[BATHROOM] triggerMicTest clicked, paired:', paired);
    if (!paired) {
      setToastMessage('Not paired — connect to guardian first')
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
      return
    }

    // If a global helper is available (exposed by PatientScanner when peer exists), call it directly
    try {
      const globalFn = (window as any).__patientMicTest;
      if (globalFn && typeof globalFn === 'function') {
        console.log('[BATHROOM] invoking global patient mic test');
        const ok = await globalFn();
        setToastMessage(ok ? 'Mic test running — please speak' : 'Mic test failed to start');
        setShowToast(true);
        setTimeout(() => setShowToast(false), 3000);
        return;
      }
    } catch (e) {
      console.warn('[BATHROOM] global mic test invocation failed', e);
    }

    // Fallback: dispatch event (older flow)
    try {
      console.log('[BATHROOM] dispatching dependent-mic-test event');
      window.dispatchEvent(new CustomEvent('dependent-mic-test'))
      setToastMessage('Mic test requested — please speak to test')
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
    } catch (e) {
      console.warn('Failed to dispatch mic test event', e)
      setToastMessage('Failed to request mic test')
      setShowToast(true)
      setTimeout(() => setShowToast(false), 3000)
    }
  }

  useEffect(() => {
    const handler = (e: Event) => {
      try {
        const ce = e as CustomEvent
        if (ce?.detail?.status) setToastMessage(String(ce.detail.status))
        else setToastMessage('Mic test update')
        setShowToast(true)
        setTimeout(() => setShowToast(false), 3000)
      } catch {
        // ignore
      }
    }
    window.addEventListener('mic-test-status', handler as EventListener)
    return () => window.removeEventListener('mic-test-status', handler as EventListener)
  }, [])

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button 
          onClick={handleClick}
          disabled={!paired || isOnCooldown}
          className='bg-[#329344] hover:bg-teal-600 text-white font-bold py-2 px-4 
              rounded-lg transition-all disabled:bg-gray-600 disabled:cursor-not-allowed cursor-pointer'
        >
          {isOnCooldown ? `I Need Bathroom ${cooldownTime}s` : (paired ? 'I Need Bathroom' : 'Not paired')}
        </Button>

        <Button
          onClick={triggerMicTest}
          disabled={!paired}
          className='bg-[#f97316] hover:bg-orange-500 text-white font-bold py-2 px-4 rounded-lg transition-all disabled:bg-gray-600 disabled:cursor-not-allowed cursor-pointer'
        >
          Test Mic
        </Button>
      </div>

      {!paired && (
        <p className="text-sm text-red-500 mt-2">Not paired — connect to your guardian to enable this button</p>
      )}

      {/* Toast Notification */}
      {showToast && (
        <div className={`fixed bottom-4 right-4 ${toastMessage && toastMessage.startsWith('Failed') ? 'bg-red-500' : 'bg-green-500'} text-white font-semibold py-3 px-6 rounded-lg shadow-lg animate-fade-in z-50`}>
          {toastMessage || '✓ I Need Bathroom sent to your guardian'}
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

export default Bathroom
