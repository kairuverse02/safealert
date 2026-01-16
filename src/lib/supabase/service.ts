import { createClient } from '@supabase/supabase-js'

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  // Accept either exact env var name or a lowercase variant that might exist in .env.local
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.supabase_service_role_key
  
  console.log('[SERVICE CLIENT DEBUG] URL exists:', !!url, 'Key exists:', !!key)
  
  if (!url || !key) {
    const missing = [] as string[]
    if (!url) missing.push('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL')
    if (!key) missing.push('SUPABASE_SERVICE_ROLE_KEY or supabase_service_role_key')
    const error = 'Missing environment variable(s): ' + missing.join(', ')
    console.error('[SERVICE CLIENT ERROR]', error)
    throw new Error(error)
  }

  return createClient(url, key, { auth: { persistSession: false } })
}
