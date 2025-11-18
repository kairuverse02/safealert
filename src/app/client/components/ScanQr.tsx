import React from 'react'
import ScanQR from '@/../public/assets/ScanQR.png';
import SQRbutton from './buttons/SQRbutton';
import Image from 'next/image';
const ScanQr = () => {
    return (
        <div className="flex flex-col items-center justify-center gap-2 text-center px-4">
            <h1 className="text-[#E7473C] text-4xl font-bold w-full max-w-[1200px] mt-10">Scan To Pair</h1>
            <h3 className="text-xl font-semibold">
                To Connect, Scan The QR Code From Your Guardian&apos;s device.
            </h3>
            <Image
                src={ScanQR}
                alt="QR Code"
                className="h-50 w-180 object-contain mx-auto mt-10"/>
            <SQRbutton />
        </div>
    )
}

export default ScanQr
