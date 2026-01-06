'use client'
import React, { useState, useEffect } from 'react'
import {Button} from '@/components/ui/button'

const Water = () => {
  const [showToast, setShowToast] = useState(false)
  const [isOnCooldown, setIsOnCooldown] = useState(false)
  const [cooldownTime, setCooldownTime] = useState(0)
  const COOLDOWN_DURATION = 10

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

  const handleClick = () => {
    setShowToast(true)
    setIsOnCooldown(true)
    setCooldownTime(COOLDOWN_DURATION)
    setTimeout(() => setShowToast(false), 3000)
  }

  return (
    <>
      <Button 
        onClick={handleClick}
        disabled={isOnCooldown}
        className='bg-[#329344] hover:bg-teal-600 text-white font-bold py-2 px-4 
            rounded-lg transition-all disabled:bg-gray-600 cursor-pointer disabled:cursor-not-allowed'
      >
        {isOnCooldown ? `I Need Water ${cooldownTime}s` : 'I Need Water'}
      </Button>

      {/* Toast Notification */}
      {showToast && (
        <div className="fixed bottom-4 right-4 bg-green-500 text-white font-semibold py-3 px-6 rounded-lg shadow-lg animate-fade-in z-50">
          ✓ I Need Water sent to your guardian
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
