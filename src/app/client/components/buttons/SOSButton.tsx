'use client'
import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const SOSButton = () => {
  const [isActivated, setIsActivated] = useState(false)

  const handleClick = () => {
    setIsActivated(!isActivated)
  }

  return (
    <Button 
      onClick={handleClick}
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
        'border-red-700'
      ]
      )}
    >
      <span className="text-white font-bold drop-shadow-lg">
      SOS
      </span>
    </Button>
  )
}

export default SOSButton
