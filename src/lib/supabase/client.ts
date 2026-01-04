import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // If we're not running in a browser or env vars are missing, return a lightweight stub
  // to avoid build-time failures during prerendering. Real client behavior is only
  // expected in the browser at runtime.
  if (typeof window === 'undefined' || !url || !key) {
    return {
      auth: {
        getUser: async () => ({ data: { user: null } }),
      },
      channel: () => ({
        on: () => ({ subscribe: () => ({ unsubscribe: async () => {} }) }),
      }),
      from: () => ({ select: async () => ({ data: null, error: null }) }),
    } as unknown as ReturnType<typeof createBrowserClient>
  }

  return createBrowserClient(url, key)
}