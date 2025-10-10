'use client'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import { Shield, User2 } from 'lucide-react'

export default function RolePage() {
  const router = useRouter()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <div className="text-center mb-10">
        <h1 className="text-5xl font-bold text-gray-900 mb-4">Choose Your Role</h1>
        <p className="text-xl text-gray-600">Select how you want to use Safe Alert</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-6 w-full max-w-2xl px-4">
        {/* Admin Button */}
        <Button
          onClick={() => router.push('/admin')}
          className="flex-1 flex flex-col items-center gap-4 p-8 bg-neutral-900 hover:bg-neutral-900 
          text-white rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg">
          <div>
            <h2 className="text-2xl font-bold mb-2">As Guardian</h2>
          </div>
        </Button>

        {/* Client Button */}
        <Button
          onClick={() => router.push('/client')}
          className="flex-1 flex flex-col items-center gap-4 p-8 bg-white-500 hover:bg-white
          text-black ring-2 ring-neutral-900 ring-inset rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg"
        >
          <div>
            <h2 className="text-2xl font-bold mb-2">As Dependancy</h2>
          </div>
        </Button>
      </div>
    </div>
  )
}
