'use client'
import React from 'react'
import { Button } from '@/components/ui/button'
import { Video } from 'lucide-react';

const ToogleCam = () => {
  return ( <Button>
    <Video size={32} className="mr-2"/>
    YOUR CAMERA
  </Button>
  )
}

export default ToogleCam
