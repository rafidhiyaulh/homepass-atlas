import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// Refreshes the Supabase session cookie on every navigation and sends signed-out users to /login.
// This is only an optimistic gate: every page and API route re-verifies the JWT and the database
// enforces row-level security regardless.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: list => {
        list.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })
  const { data } = await supabase.auth.getClaims()
  const path = request.nextUrl.pathname
  const open = path === '/login' || path.startsWith('/api/') || path.startsWith('/samples/')
  if (!data?.claims && !open) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo-ioh-business.png|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)'],
}
