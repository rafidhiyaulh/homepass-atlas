// Create demo accounts (Supabase Auth) + atlas.profiles rows, and the private upload bucket.
// Idempotent. Needs SUPABASE_SERVICE_ROLE_KEY, ATLAS_DEMO_PASSWORD, DATABASE_ADMIN_URL.
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const sql = postgres(process.env.DATABASE_ADMIN_URL, { prepare: false, max: 1, onnotice: () => {} })

const DEMO = [
  { email: 'planner@homepass-atlas.demo', role: 'planner', partner: null, name: 'Market Planner' },
  { email: 'nsf@homepass-atlas.demo', role: 'partner', partner: 1, name: 'Nusa Serat Fiber (partner)' },
  { email: 'viewer@homepass-atlas.demo', role: 'viewer', partner: null, name: 'Business Viewer' },
]

const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
for (const d of DEMO) {
  let user = list.users.find(u => u.email === d.email)
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: d.email, password: process.env.ATLAS_DEMO_PASSWORD, email_confirm: true,
      app_metadata: { app: 'homepass-atlas' },
    })
    if (error) throw error
    user = data.user
  } else {
    await admin.auth.admin.updateUserById(user.id, { password: process.env.ATLAS_DEMO_PASSWORD })
  }
  await sql`insert into atlas.profiles (user_id, email, role, partner_id, display_name)
            values (${user.id}, ${d.email}, ${d.role}, ${d.partner}, ${d.name})
            on conflict (user_id) do update set role = excluded.role, partner_id = excluded.partner_id, display_name = excluded.display_name`
  console.log('user', d.email, d.role)
}

const { error: bErr } = await admin.storage.createBucket('atlas-uploads', { public: false, fileSizeLimit: '20MB' })
console.log('bucket', bErr ? bErr.message : 'created')
await sql.end()
