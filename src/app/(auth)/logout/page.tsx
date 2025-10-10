'use client'
import React, { use } from 'react'
import {useRouter} from 'next/navigation'
import { useEffect } from 'react'

const LogoutPage = () => {
    const router = useRouter();
    useEffect(() => {
        setTimeout(() => router.push('/'), 2000);
    }, []);
  return (
    <div className='text-2xl items-center font-bold'>You have logged out... redirecting in a sec</div>
  )
}

export default LogoutPage;
