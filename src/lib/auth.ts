import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { supabaseServer } from './supabase/server'
import { asUser, type Claims } from './db'

export type Me = Claims & { role: 'planner' | 'partner' | 'viewer'; partner_id: number | null; display_name: string }

// Verified identity for this request: the JWT is checked by Supabase (signature / auth server),
// then the profile is read through RLS, so a token without an atlas profile gets nothing.
export const getMe = cache(async (): Promise<Me | null> => {
  const supabase = await supabaseServer()
  const { data } = await supabase.auth.getClaims()
  const c = data?.claims
  if (!c?.sub) return null
  const claims = { sub: c.sub, email: c.email as string | undefined }
  const [p] = await asUser(claims, tx => tx`select role, partner_id, display_name from atlas.profiles where user_id = ${c.sub}`)
  if (!p) return null
  return { ...claims, role: p.role, partner_id: p.partner_id, display_name: p.display_name }
})

export async function requireMe(): Promise<Me> {
  const me = await getMe()
  if (!me) redirect('/login')
  return me
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code)
  }
}

// For route handlers: 401 instead of a redirect
export async function apiMe(): Promise<Me> {
  const me = await getMe()
  if (!me) throw new HttpError(401, 'unauthenticated')
  return me
}

export function apiError(e: unknown) {
  if (e instanceof HttpError) return Response.json({ error: e.message, code: e.code }, { status: e.status })
  const pg = e as { code?: string; message?: string }
  if (pg?.code === '42501') return Response.json({ error: 'not permitted', code: 'forbidden' }, { status: 403 })
  if (pg?.code === '22023') return Response.json({ error: pg.message, code: 'bad_request' }, { status: 400 })
  console.error(e)
  return Response.json({ error: 'internal error', code: 'internal' }, { status: 500 })
}
