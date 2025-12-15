import { type NextRequest, NextResponse } from 'next/server'

// Temporary compatibility route: some verification emails include an extra
// `/role` segment (e.g., `/role/auth/confirm`) which causes a 404. This route
// redirects those requests to the canonical `/auth/confirm` preserving query
// parameters.
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const original = request.url
  // Change pathname to the canonical confirm route
  url.pathname = '/auth/confirm'
  console.log('Redirecting legacy confirm URL to /auth/confirm:', original)
  return NextResponse.redirect(url)
}
