import React from 'react'

import {Info, QrCode, Copy} from 'lucide-react';
import {Button} from '@/components/ui/button'
import {Dialog, DialogClose, DialogContent, DialogTrigger, DialogHeader, DialogTitle, DialogFooter} from '@/components/ui/dialog'
import MonitoringSystem from "../components/MonitoringSystem";

const CameraCard = () => {
    interface ConnectDeviceModalProps {
        isOpen: boolean;
        onClose: () => void;
    }

return (
    <div className='bg-neutral-900 flex justify-center items-center w-200 h-120'>
        {/* <div className='text-center bg-red-400 w-150 h-80'>
            <h1 className='text-2xl font-bold text-neutral-100'>Connect your dependant's device</h1>
            <h3 className='text-base'>No camera is currently active. Please pair a device to begin monitoring. 
                Scan the QR code below or manually enter the Unique ID.</h3> 
            <div className='justify-center flex items-center justify-center'>
                <QrCode size={140} className='bg-white border-4 rounded-xl border-solid border-black'/>
            </div>
            <div className='font-semibold border-4 border-solid border-black mt-4 w-4/5 flex items-center justify-center text-xl'>
                <h3>d5b2-a9e1-4f8c</h3> <Copy/>
            </div>
        </div>  */}
    <MonitoringSystem/>
    </div>
    
)
}

export default CameraCard;
