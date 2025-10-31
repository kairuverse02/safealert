import React from 'react'
import { Button } from '@/components/ui/button'

const ControlBar = () => {
  return (
    <div className='grid grid-cols-3 gap-2'>
        <Button className='h-14 bg-neutral-500'>Connected: 00:00</Button>
        <Button className='h-14 bg-neutral-500'>Perimeter Detection</Button>
        <Button className='h-14 bg-neutral-500'>Push to talk</Button>
    </div>
  )
}

export default ControlBar
