import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Public routes that don't require authentication
const PUBLIC_ROUTES = ['/', '/login', '/signup', '/verify-email']

// Routes that require authentication
const PROTECTED_ROUTES = ['/admin', '/client', '/profile', '/account', '/dashboard', '/privacy']

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Check if trying to access protected routes
  const isProtectedRoute = PROTECTED_ROUTES.some(route => pathname.startsWith(route))
  const isPublicRoute = PUBLIC_ROUTES.includes(pathname)
  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/signup') || pathname.startsWith('/verify-email')

  // Redirect unauthenticated users trying to access protected routes
  if (isProtectedRoute && !user) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Redirect authenticated users away from auth pages
  if (isAuthRoute && user) {
    // Redirect to role selection or dashboard based on user metadata
    const role = user.user_metadata?.role
    if (role === 'guardian') {
      return NextResponse.redirect(new URL('/admin/dashboard', request.url))
    } else if (role === 'dependent') {
      return NextResponse.redirect(new URL('/client/dashboard', request.url))
    } else {
      return NextResponse.redirect(new URL('/role', request.url))
    }
  }

  // Redirect to home if user is on root and authenticated
  if (pathname === '/' && user) {
    const role = user.user_metadata?.role
    if (role === 'guardian') {
      return NextResponse.redirect(new URL('/admin/dashboard', request.url))
    } else if (role === 'dependent') {
      return NextResponse.redirect(new URL('/client/dashboard', request.url))
    }
  }

  return response
}