'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, UploadCloud } from 'lucide-react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { Badge, PartnerDot } from '@/components/Badge'
import { fmtInt } from '@/lib/format'
import { Term } from '@/components/Help'

type Partner = { id: number; code: string; name: string }
type Batch = {
  id: string; filename: string; status: string; polygons: number; shards_total: number; shards_done: number
  created_at: string; partner_code: string | null; partner_id: number | null
  stats: { by_status?: Record<string, number>; homepass_dup?: number } | null; error: string | null
}

const BATCH_TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral' | 'low'> = { done: 'good', processing: 'warn', finalizing: 'warn', queued: 'low', failed: 'bad' }

export function HygieneHome({ partners, role, myPartner }: { partners: Partner[]; role: string; myPartner: number | null }) {
  const router = useRouter()
  const [batches, setBatches] = useState<Batch[] | null>(null)
  const [partnerId, setPartnerId] = useState<number>(myPartner ?? 1)
  const [sliver, setSliver] = useState(500)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    fetch('/api/batches', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(j => { if (j) setBatches(j.batches) })
  }, [])
  // poll while anything is still being processed
  const busyBatches = batches === null || batches.some(b => b.status !== 'done' && b.status !== 'failed')
  useEffect(() => {
    if (!busyBatches) return
    const t = setInterval(load, 1500)
    const first = setTimeout(load, 0)
    return () => { clearInterval(t); clearTimeout(first) }
  }, [busyBatches, load])

  async function upload(file: File) {
    setError(null)
    try {
      setBusy('Requesting upload slot…')
      const s = await fetch('/api/uploads/sign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filename: file.name, size: file.size }) })
      const sj = await s.json()
      if (!s.ok) throw new Error(sj.error)
      setBusy('Uploading to private storage…')
      const { error: upErr } = await supabaseBrowser().storage.from('atlas-uploads').uploadToSignedUrl(sj.path, sj.token, file, { contentType: 'application/octet-stream' })
      if (upErr) throw new Error(upErr.message)
      setBusy('Parsing KMZ and queueing shards…')
      const b = await fetch('/api/batches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: sj.path, filename: file.name, partnerId, sliverM2: sliver }) })
      const bj = await b.json()
      if (!b.ok) throw new Error(bj.error)
      router.push(`/hygiene/${bj.id}`)
    } catch (e) {
      setError((e as Error).message || 'Upload failed')
      setBusy(null)
    }
  }

  const canUpload = role !== 'viewer'
  return (
    <div className="cols-2">
      <section className="card">
        <div className="card-head"><div><h2 className="card-title">Checked files</h2><div className="card-sub">Newest first. Same file twice reuses the result.</div></div></div>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data">
            <thead><tr><th>File</th><th>Partner</th><th>Status</th><th className="num">Shapes</th><th>Result</th><th>Uploaded</th></tr></thead>
            <tbody>
              {batches === null && <tr><td colSpan={6}><div className="skeleton" style={{ height: 18 }} /></td></tr>}
              {batches?.length === 0 && <tr><td colSpan={6} className="muted">Nothing yet. Try a sample file on the right.</td></tr>}
              {batches?.map(b => {
                const s = b.stats?.by_status ?? {}
                const clean = (s.clean ?? 0) + (s.touch ?? 0)
                return (
                  <tr key={b.id} className="clickable" onClick={() => router.push(`/hygiene/${b.id}`)}>
                    <td><Link href={`/hygiene/${b.id}`} onClick={e => e.stopPropagation()} className="strong" style={{ color: 'var(--ink)' }}>{b.filename}</Link></td>
                    <td>{b.partner_id ? <PartnerDot id={b.partner_id} code={b.partner_code ?? ''} /> : '-'}</td>
                    <td><Badge tone={BATCH_TONE[b.status] ?? 'neutral'}>{b.status === 'processing' ? `checking ${b.shards_done} of ${b.shards_total}` : b.status}</Badge></td>
                    <td className="num">{fmtInt(b.polygons)}</td>
                    <td className="small">{b.status === 'done' ? <><span className="strong">{clean}</span> clean, <span className="strong">{b.polygons - clean}</span> to fix</> : b.error ? <span style={{ color: 'var(--crit)' }}>{b.error}</span> : '…'}</td>
                    <td className="small muted">{new Date(b.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><div><h2 className="card-title">Check a KMZ</h2><div className="card-sub">A .kmz or .kml file, up to 20 MB.</div></div></div>
        <div className="card-pad stack">
          {!canUpload && <div className="note">Viewers can read results but not upload.</div>}
          <div className="row">
            <label className="small strong" htmlFor="partner" style={{ width: 130 }}>From partner</label>
            <select id="partner" className="select" value={partnerId} disabled={role === 'partner' || !canUpload} onChange={e => setPartnerId(Number(e.target.value))} style={{ flex: 1 }}>
              {partners.map(p => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </select>
          </div>
          <div className="row">
            <label className="small strong" htmlFor="sliver" style={{ width: 130 }}>Ignore overlaps under</label>
            <input id="sliver" className="input" type="number" min={0} max={20000} step={50} value={sliver} disabled={!canUpload} onChange={e => setSliver(Number(e.target.value))} style={{ width: 110 }} />
            <span className="small muted">m², treated as a <Term k="sliver">sliver</Term></span>
          </div>
          <div
            className={`drop${drag ? ' on' : ''}`}
            role="button" tabIndex={0} aria-disabled={!canUpload || !!busy}
            onClick={() => canUpload && !busy && input.current?.click()}
            onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && canUpload && !busy) input.current?.click() }}
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f && canUpload && !busy) upload(f) }}
          >
            <UploadCloud size={26} style={{ color: 'var(--accent)' }} />
            <div className="strong" style={{ marginTop: 6 }}>{busy ?? 'Drop a KMZ here or click to choose'}</div>
            <div className="small muted">Stored privately and scanned for unsafe content.</div>
            <input ref={input} type="file" accept=".kmz,.kml" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
          </div>
          {error && <p role="alert" style={{ color: 'var(--crit)', fontWeight: 600 }}>{error}</p>}
          <div className="hr" />
          <div className="small strong">Sample files</div>
          <div className="small muted">Fictional partners, with every kind of mistake planted in.</div>
          <div className="row">
            <a className="btn btn-sm" href="/samples/NSF_Q4-2026_rollout.kmz" download><Download size={13} /> NSF_Q4-2026_rollout.kmz</a>
            <a className="btn btn-sm" href="/samples/JOP_Q4-2026_rollout.kmz" download><Download size={13} /> JOP_Q4-2026_rollout.kmz</a>
          </div>
        </div>
      </section>
    </div>
  )
}
