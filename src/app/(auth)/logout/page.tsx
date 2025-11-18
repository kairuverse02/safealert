'use client'
import React from 'react'
import {useRouter} from 'next/navigation'
import { useEffect } from 'react'

const LogoutPage = () => {
    const router = useRouter();
    useEffect(() => {
        setTimeout(() => router.push('/'), 2000);
    }, [router]);
  return (
    <div className='text-xl'>You have logged out... redirecting in a sec</div>
  )
}

export default LogoutPage;
  