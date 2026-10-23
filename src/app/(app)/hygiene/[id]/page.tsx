import { notFound } from 'next/navigation'
import { requireMe } from '@/lib/auth'
import { UUID } from '@/lib/guard'
import { BatchView } from './BatchView'

export const metadata = { title: 'Boundary check' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMe()
  const { id } = await params
  if (!UUID.test(id)) notFound()
  return <BatchView id={id} role={me.role} />
}
