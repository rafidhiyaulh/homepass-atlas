'use server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { supabaseServer } from '@/lib/supabase/server'
import { sql } from '@/lib/db'

const DEMO: Record<string, string> = {
  planner: 'planner@homepass-atlas.demo',
  partner: 'nsf@homepass-atlas.demo',
  viewer: 'viewer@homepass-atlas.demo',
}

async function limited(key: string) {
  // brute-force guard shared by every server instance (Postgres counter, see atlas.hit)
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  const [r] = await sql.begin(async tx => {
    await tx`set local role atlas_worker`
    return tx`select atlas.hit(${'login:' + key + ':' + ip}, 10, 300) as ok`
  })
  return !r.ok
}

export async function signIn(_: unknown, form: FormData) {
  const demo = String(form.get('demo') ?? '')
  const email = DEMO[demo] ?? String(form.get('email') ?? '').trim().toLowerCase()
  const password = DEMO[demo] ? process.env.ATLAS_DEMO_PASSWORD! : String(form.get('password') ?? '')
  if (!email || !password) return { error: 'Enter email and password.' }
  if (await limited(demo || email)) return { error: 'Too many attempts. Try again in a few minutes.' }
  const supabase = await supabaseServer()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { error: 'Sign-in failed. Check the credentials.' }
  redirect('/')
}
