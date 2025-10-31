'use client'
import React from 'react'
import {Button} from '@/components/ui/button'
import { Speech } from 'lucide-react';

const PushToTalk = () => {
  return (
    <Button className='bg-transparent border-2 border-solid border-black text-black 
  h-15 text-xl font-medium cursor-pointer hover:bg-blue-500 hover:text-white hover:border-blue-800'>
    I Need Water
    </Button>
  )
}

export default PushToTalk
