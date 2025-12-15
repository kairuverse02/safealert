import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const { searchParams } = url
    
    // Log the full URL for debugging
    console.log('Confirm route received URL:', request.url)
    console.log('Search params:', Object.fromEntries(searchParams))
    
    let token_hash = searchParams.get('token_hash')
    let type = searchParams.get('type') as EmailOtpType | null
    const next = searchParams.get('next') ?? '/role'

    // If token_hash or type are null, try parsing from the full URL string
    // in case the & separator is missing
    if (!token_hash || !type) {
      const urlString = request.url
      const tokenMatch = urlString.match(/token_hash=([^&]+)/)
      const typeMatch = urlString.match(/type=([^&]+)/)
      
      if (tokenMatch) token_hash = decodeURIComponent(tokenMatch[1])
      if (typeMatch) type = decodeURIComponent(typeMatch[1]) as EmailOtpType
    }

    console.log('Parsed token_hash:', token_hash ? 'present' : 'missing')
    console.log('Parsed type:', type)

    if (token_hash && type) {
      const supabase = await createClient()

      const { error } = await supabase.auth.verifyOtp({
        type,
        token_hash,
      })
      
      console.log('Verify OTP result:', error ? `Error: ${error.message}` : 'Success')
      
      if (!error) {
        // Email verified successfully, redirect to the next page
        const redirectTo = request.nextUrl.clone()
        redirectTo.pathname = next
        redirectTo.searchParams.delete('token_hash')
        redirectTo.searchParams.delete('type')
        return NextResponse.redirect(redirectTo)
      } else {
        // Verification failed with Supabase error
        const redirectTo = request.nextUrl.clone()
        redirectTo.pathname = '/error'
        redirectTo.searchParams.set('message', 'Email verification failed')
        redirectTo.searchParams.set('reason', error.message)
        return NextResponse.redirect(redirectTo)
      }
    }

    // If we couldn't parse the required params
    console.log('Missing required parameters')
    const redirectTo = request.nextUrl.clone()
    redirectTo.pathname = '/error'
    redirectTo.searchParams.set('message', 'Invalid verification link')
    redirectTo.searchParams.set('reason', 'Missing token or type')
    return NextResponse.redirect(redirectTo)
  } catch (err) {
    console.error('Confirm route error:', err)
    const redirectTo = new URL(request.url)
    redirectTo.pathname = '/error'
    redirectTo.searchParams.set('message', 'Verification error')
    redirectTo.searchParams.set('reason', (err as Error).message || 'Unknown error')
    return NextResponse.redirect(redirectTo)
  }
}