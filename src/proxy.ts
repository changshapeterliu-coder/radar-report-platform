import { NextRequest, NextResponse } from 'next/server';
import { createMiddlewareClient } from '@/lib/supabase/middleware';

const PUBLIC_ROUTES = ['/login'];

/**
 * Routes that should be completely unauthenticated — they handle their own
 * auth (signature verification for Inngest, etc.) and must be reachable by
 * external servers with no user session.
 */
const UNAUTHENTICATED_API_ROUTES = ['/api/inngest'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Let Inngest (and any future external-webhook routes) through untouched.
  // These routes handle their own signature verification via the Inngest SDK.
  if (UNAUTHENTICATED_API_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  const { supabase, response } = createMiddlewareClient(request);

  // Refresh session — this keeps the session alive
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Allow unauthenticated users to access public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    // If already authenticated, redirect away from login
    if (user) {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }
    return response;
  }

  // Redirect unauthenticated users to /login
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
