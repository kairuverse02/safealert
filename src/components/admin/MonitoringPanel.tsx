import React from 'react'
import Image from 'next/image'
import { Unplug, Dot, Info} from 'lucide-react';
import {Button} from '@/components/ui/button'
import {Dialog, DialogClose, DialogContent, DialogTrigger, DialogHeader, DialogTitle, DialogFooter} from '@/components/ui/dialog'

const MonitoringPanel = () => {
    interface ConnectDeviceModalProps {
        isOpen: boolean;
        onClose: () => void;
    }

return (
    <div className='flex flex-col gap-4 max-w-[1200px] mx-auto py-4 min-h-screen'>
        {/* Status Bar */}
        <div className='grid grid-cols-3 items-center text-neutral-950 text-xl font-semibold rounded-full '>
            <h1 className='col-span-2 '>No Connected Device</h1>
            <div className='flex justify-end'>
                <Unplug size={28}/><h1>offline</h1>
            </div>
        </div>
        
        {/* CameraCard*/}
        <div className='grid grid-cols-3 rounded gap-2 h-[450px]'>
            <div className='col-span-2 bg-neutral-900 flex justify-center items-center'>
                <div className='text-center'>
                    <h1 className='text-base font-regular text-neutral-100'>Connect a device and enable the camera.</h1>
                    <div className='mt-4'>
                    <Dialog>
                        <DialogTrigger asChild>
                            <Button className='w-50 h-10 font-display font-semibold text-xl border-solid bg-blue-500 hover:bg-blue-300 rounded'>
                                + Connect Device
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader className='flex flex-col items-center'>
                                <DialogTitle className='text-2xl font-bold'>
                                    Connect Device
                                </DialogTitle>
                            </DialogHeader>
                            <div className='h-auto sm:h-[16rem] w-full max-w-md mx-auto p-4' >
                                <div className='flex flex-col gap-2'>
                                    <label htmlFor="username" className='text-lg sm:text-xl font-semibold'>Type Username</label>
                                    <input type="text" id="username" placeholder='@johndoe' className='border-2 border-solid border-neutral-200 rounded w-full h-8 sm:h-10 px-3'/>
                                </div>
                                <div className='flex flex-col gap-2 mt-4'>
                                    <label htmlFor="uniqueId" className='text-lg sm:text-xl font-semibold'>Type Unique ID</label>
                                    <input type="text" id="uniqueId" placeholder='f8b6d3e9-5c9a-4e2a-b67f-9c8a1b5c6e4d' className='border-2 border-solid border-neutral-200 rounded w-full h-8 sm:h-10 px-3'/>
                                    <div className='flex items-center mt-1'>
                                        <Info className='w-4 sm:w-[18px] text-neutral-900 flex-shrink-0'/>
                                        <h2 className='text-xs sm:text-sm text-neutral-900 ml-1'>
                                            The unique id is available in your profile page.
                                        </h2>
                                    </div>
                                </div>
                            </div>
                            <DialogFooter className=''>
                                <DialogClose asChild>
                                    <Button className='w-40 h-10 font-display font-semibold text-xl border-solid bg-red-500 hover:bg-red-300 rounded'>Discard</Button>
                                </DialogClose>
                                    <Button className='w-40 h-10 font-display font-semibold text-xl border-solid bg-blue-500 hover:bg-blue-300 rounded'>Connect</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                    </div>
                </div>
            </div>
        {/* Alerts Log*/}
            <div className='grid grid-rows-14 text-neutral-950 font-semibold bg-white'>
            </div>
        </div>

        {/* Control Bar */}
        <div className='grid grid-cols-3 gap-2'>
            <Button className='h-14 bg-neutral-500'>Connected: 00:00</Button>
            <Button className='h-14 bg-neutral-500'>Perimeter Detection</Button>
            <Button className='h-14 bg-neutral-500'>Push to talk</Button>
        </div>
    </div>
    
)
}

export default MonitoringPanel;
