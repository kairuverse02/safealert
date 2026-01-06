import CameraMenu from '../components/CameraMenu';

import SOSButton from '../components/buttons/SOSButton';
import Water from '../components/buttons/Water';
import Bathroom from '../components/buttons/Bathroom';
import React from 'react'

const page = () => {
  return (
    <div className='container max-w-[1400px] mt-6 mx-auto p-2 rounded-md bg-white shadow-md'>
      <h1 className="text-[#E7473C] text-4xl font-bold w-full max-w-[1200px] mx-auto mt-4">Your Dashboard</h1>
        <div className='grid grid-cols-1 md:grid-cols-2 gap-4 max-w-[1200px] mx-auto mt-6 bg-neutral-200 rounded-xl shadow-2xl border-2 border-solid border-black'>
            <CameraMenu/>
            <div className='flex flex-col items-center justify-between py-4'>
              <h2 className='text-2xl font-medium'>Tap to Trigger Emergency🚨</h2>
              <SOSButton/>
            </div>
        </div>
      {/* QuickMessages Buttons */}
      <div className='flex flex-col gap-2 w-full max-w-[1200px] justify-center mx-auto items-center my-4 md:flex-row'>
      <Water/>
      <Bathroom/>
      </div>
    </div>
  )
}

export default page
