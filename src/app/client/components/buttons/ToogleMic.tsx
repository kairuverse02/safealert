'use client'
import React from 'react'
import { Button } from '@/components/ui/button'
import { Mic, MicOff } from 'lucide-react';

const ToogleCam = () => {
  return ( <Button>
    <Mic size={32} className="mr-2"/>
    YOUR MIC
  </Button>
  )
}

export default ToogleCam
