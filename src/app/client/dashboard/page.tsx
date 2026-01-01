import CameraMenu from '../components/CameraMenu';

import SOSButton from '../components/buttons/SOSButton';
import TimeSessionBar from '../components/buttons/TimeSessionBar';
import PushToTalk from '../components/buttons/PushToTalk';
import QuickMessage from '../components/buttons/QuickMessage';
import React from 'react'

const page = () => {
  return (
    <div className=''>
      <h1 className="text-[#E7473C] text-4xl font-bold w-full max-w-[1200px] mx-auto mt-10">Your Dashboard</h1>
        <div className='grid grid-cols-1 md:grid-cols-2 gap-4 max-w-[1200px] mx-auto mt-6 bg-neutral-200'>
            <CameraMenu/>
            <div className='flex flex-col items-center justify-between py-4'>
              <h2 className='text-2xl font-medium'>Tap to Trigger Emergency🚨</h2>
              <SOSButton/>
            </div>
        </div>

      <div className='flex flex-col gap-2 w-full max-w-[1200px] justify-center mx-auto items-center my-4 md:flex-row'>
      <TimeSessionBar/>
      <PushToTalk/>
      <QuickMessage/>
      </div>
    </div>
  )
}

export default page
