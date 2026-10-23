import { requireMe } from '@/lib/auth'
import { Shell } from '@/components/Shell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireMe()
  return <Shell me={{ display_name: me.display_name, role: me.role, email: me.email }}>{children}</Shell>
}
