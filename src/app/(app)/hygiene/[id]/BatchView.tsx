'use client'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Download, FileCheck2 } from 'lucide-react'
import { Map, type Layer } from '@/components/Map'
import { Badge, PartnerDot, STATUS, StatusBadge } from '@/components/Badge'
import { Kpi } from '@/components/Kpi'
import { fmtInt, fmtPct, m2 } from '@/lib/format'
import type { Geometry } from 'geojson'

type Batch = {
  id: string; filename: string; status: string; polygons: number; shards_total: number; sliver_m2: string
  created_at: string; started_at: string | null; finished_at: string | null; error: string | null
  partner_id: number | null; partner_code: string | null; partner_name: string | null
  stats: { by_status: Record<string, number>; by_kind: Record<string, number>; area_m2: number; clean_area_m2: number; overlap_m2: number; homepass_est: number; homepass_dup: number; registry_hits: number } | null
}
type Shard = { shard: number; lo: number; hi: number; status: string; attempts: number; worker: string | null; ms: number | null; last_error: string | null }
type Boundary = { id: number; seq: number; name: string; folder: string | null; status: string; kinds: string[]; conflict_count: number; is_valid: boolean; valid_reason: string | null; area_m2: string; clean_area_m2: string; homepass_est: number | null; homepass_claimed: string | null }
type Conflict = { a_id: number; a_name: string; b_kind: string; b_id: number; b_name: string; kind: string; overlap_m2: string; homepass_dup: number | null }
type Geo = { boundaries: { id: number; name: string; status: string; geom: Geometry }[]; overlaps: { id: string; kind: string; overlap_m2: string; geom: Geometry }[]; registry: { id: number; code: string; partner_id: number; geom: Geometry }[] }

const ORDER = ['clean', 'touch', 'sliver', 'overlap', 'duplicate', 'invalid']
const FILL: Record<string, string> = { clean: 'var(--chart-good)', touch: 'var(--low)', sliver: 'var(--chart-warn)', overlap: 'var(--chart-serious)', duplicate: 'var(--chart-bad)', invalid: 'var(--chart-bad)' }
const KIND_LABEL: Record<string, string> = { overlap: 'Partial overlap', contains: 'Contains the other', within: 'Inside the other', duplicate: 'Duplicate', sliver: 'Sliver', touch: 'Touch only' }

export function BatchView({ id, role }: { id: string; role: string }) {
  const [d, setD] = useState<{ batch: Batch; shards: Shard[]; boundaries: Boundary[]; conflicts: Conflict[] } | null>(null)
  const [geo, setGeo] = useState<Geo | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [promoted, setPromoted] = useState<number | null>(null)

  const load = useCallback(() => {
    fetch(`/api/batches/${id}`, { cache: 'no-store' })
      .then(async r => ({ ok: r.ok, j: await r.json() }))
      .then(({ ok, j }) => (ok ? setD(j) : setErr(j.error ?? 'Not found')))
  }, [id])
  const done = d?.batch.status === 'done'
  const settled = done || d?.batch.status === 'failed' || err != null
  // poll until the batch is done or failed
  useEffect(() => {
    if (settled) return
    const first = setTimeout(load, 0)
    const t = setInterval(load, 1000)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [settled, load])
  useEffect(() => {
    if (!done) return
    let alive = true
    fetch(`/api/batches/${id}/geo`).then(r => r.json()).then(g => { if (alive) setGeo(g) })
    return () => { alive = false }
  }, [done, id])

  const layers: Layer[] = useMemo(() => {
    if (!geo) return []
    return [
      { id: 'registry', interactive: false, shapes: geo.registry.map(r => ({ id: r.id, geom: r.geom, cls: 'p-registry', fillOpacity: 0.08, weight: 1, dash: '4 3', tip: `Registry ${r.code}` })) },
      { id: 'b', shapes: geo.boundaries.filter(b => filter === 'all' || b.status === filter).map(b => ({ id: b.id, geom: b.geom, cls: `p-${b.status}`, fillOpacity: 0.22, weight: 1.6, tip: `${b.name} · ${STATUS[b.status]?.label ?? b.status}` })) },
      { id: 'ov', interactive: false, shapes: geo.overlaps.map(o => ({ id: o.id, geom: o.geom, cls: 'p-conflict', fillOpacity: 0.55, weight: 0.8 })) },
    ]
  }, [geo, filter])

  if (err) return <div className="note">{err}. <Link href="/hygiene">Back to submissions</Link></div>
  if (!d) return <div className="skeleton" style={{ height: 300 }} />
  const { batch, shards, boundaries, conflicts } = d
  const doneShards = shards.filter(s => s.status === 'done').length
  const st = batch.stats
  const bs = st?.by_status ?? {}
  const cleanN = (bs.clean ?? 0) + (bs.touch ?? 0)
  const secs = batch.finished_at && batch.started_at ? (new Date(batch.finished_at).getTime() - new Date(batch.started_at).getTime()) / 1000 : null
  const workers = [...new Set(shards.map(s => s.worker).filter(Boolean))]
  const selB = boundaries.find(b => b.id === sel)
  const selConf = conflicts.filter(c => c.a_id === sel || (c.b_kind === 'batch' && c.b_id === sel))
  const rows = boundaries.filter(b => filter === 'all' || b.status === filter)

  async function promote() {
    const r = await fetch(`/api/batches/${id}/promote`, { method: 'POST' })
    const j = await r.json()
    setPromoted(r.ok ? j.promoted : -1)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/hygiene" className="small row" style={{ gap: 4, display: 'inline-flex' }}><ArrowLeft size={13} /> All submissions</Link>
          <h1 className="page-title" style={{ marginTop: 4 }}>{batch.filename}</h1>
          <p className="page-sub row" style={{ gap: 8 }}>
            {batch.partner_id && <PartnerDot id={batch.partner_id} code={batch.partner_code ?? ''} />} {batch.partner_name}
            <span>·</span> {fmtInt(batch.polygons)} polygons <span>·</span> sliver threshold {fmtInt(Number(batch.sliver_m2))} m²
            {secs != null && <><span>·</span> checked in {secs.toFixed(1)} s by {workers.length} worker{workers.length === 1 ? '' : 's'}</>}
          </p>
        </div>
        {done && (
          <div className="toolbar">
            <a className="btn" href={`/api/batches/${id}/export?what=clean`}><Download size={14} /> Clean polygons</a>
            <a className="btn" href={`/api/batches/${id}/export?what=clean_parts`}><Download size={14} /> Clean parts only</a>
            <a className="btn" href={`/api/batches/${id}/export?what=issues`}><Download size={14} /> Issues</a>
            {role === 'planner' && <button className="btn btn-primary" onClick={promote} disabled={promoted != null}><FileCheck2 size={14} /> {promoted == null ? 'Promote clean to registry' : promoted < 0 ? 'Failed' : `${promoted} added`}</button>}
          </div>
        )}
      </div>

      {!done && (
        <section className="card card-pad" style={{ marginBottom: 14 }}>
          <div className="row between">
            <div className="strong">{batch.status === 'failed' ? 'Check failed' : batch.status === 'finalizing' ? 'Merging shard results…' : `Workers processing shards · ${doneShards}/${batch.shards_total}`}</div>
            <Badge tone={batch.status === 'failed' ? 'bad' : 'warn'}>{batch.status}</Badge>
          </div>
          <div className="progress" style={{ margin: '10px 0' }}><div style={{ width: `${batch.shards_total ? (doneShards / batch.shards_total) * 100 : 5}%` }} /></div>
          {batch.error && <p style={{ color: 'var(--crit)' }}>{batch.error}</p>}
          <ShardGrid shards={shards} />
        </section>
      )}

      {done && st && (
        <>
          <div className="kpis">
            <Kpi label="Clean polygons" value={`${cleanN} / ${batch.polygons}`} sub={`${fmtPct(cleanN / batch.polygons, 0)} usable as-is (touch-only counts as clean)`} accent="var(--chart-good)" />
            <Kpi label="Polygons with issues" value={fmtInt(batch.polygons - cleanN)} sub={`${bs.overlap ?? 0} overlap · ${bs.duplicate ?? 0} duplicate · ${bs.invalid ?? 0} self-intersect · ${bs.sliver ?? 0} sliver`} accent="var(--chart-serious)" />
            <Kpi label="Overlapping area" value={m2(st.overlap_m2)} sub={`${fmtPct(st.overlap_m2 / st.area_m2)} of submitted area`} accent="var(--chart-bad)" />
            <Kpi label="HP double counted" value={fmtInt(st.homepass_dup)} sub={`of ${fmtInt(st.homepass_est)} estimated in this file`} accent="var(--brand)" />
            <Kpi label="Hits on live registry" value={fmtInt(st.registry_hits)} sub="polygons overlapping areas already RFS" accent="var(--ink)" />
          </div>

          <section className="card" style={{ marginBottom: 14 }}>
            <div className="card-head">
              <div>
                <h2 className="card-title">Where the problems are</h2>
                <div className="card-sub">Coloured by status. Red patches are shared area. Dashed grey outlines are areas already in the home-pass registry.</div>
              </div>
              <div className="seg" role="group" aria-label="Filter by status">
                {['all', ...ORDER].map(s => (
                  <button key={s} className={filter === s ? 'on' : ''} onClick={() => setFilter(s)}>
                    {s === 'all' ? `All ${batch.polygons}` : `${STATUS[s].label} ${bs[s] ?? 0}`}
                  </button>
                ))}
              </div>
            </div>
            <StatusBar counts={bs} total={batch.polygons} />
            <div style={{ position: 'relative', marginTop: 4 }}>
              {geo ? <Map layers={layers} selected={sel} onSelect={(l, i) => l === 'b' && setSel(Number(i))} fitLayer="b" fitKey={`${id}`} /> : <div className="map skeleton" />}
              {selB && (
                <div className="card card-pad" style={{ position: 'absolute', top: 12, right: 12, width: 320, zIndex: 500 }}>
                  <div className="row between"><span className="strong">{selB.name}</span><button className="btn btn-ghost btn-sm" onClick={() => setSel(null)} aria-label="Close">✕</button></div>
                  <div style={{ margin: '6px 0' }}><StatusBadge status={selB.status} /></div>
                  {!selB.is_valid && <div className="small" style={{ color: 'var(--crit)' }}>{selB.valid_reason}</div>}
                  <div className="small muted">Area {m2(Number(selB.area_m2))} · clean part {m2(Number(selB.clean_area_m2))}</div>
                  <div className="small muted">Home-passes est. {fmtInt(selB.homepass_est)}{selB.homepass_claimed ? ` · claimed ${fmtInt(Number(selB.homepass_claimed))}` : ''}</div>
                  {selConf.length > 0 && <div className="hr" />}
                  {selConf.slice(0, 6).map((c, i) => (
                    <div key={i} className="small" style={{ marginTop: 4 }}>
                      <span className="strong">{KIND_LABEL[c.a_id === sel ? c.kind : c.kind === 'contains' ? 'within' : c.kind === 'within' ? 'contains' : c.kind]}</span> with {c.a_id === sel ? c.b_name : c.a_name}
                      {Number(c.overlap_m2) > 0 && <span className="muted"> · {m2(Number(c.overlap_m2))}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="legend">
              {ORDER.map(s => <span key={s} className="k"><span className="sw" style={{ background: FILL[s] }} /><span aria-hidden>{STATUS[s].icon}</span> {STATUS[s].label}</span>)}
              <span className="k"><span className="sw" style={{ background: 'var(--crit)' }} /> Shared area</span>
              <span className="k"><span className="sw" style={{ border: '1.5px dashed var(--ink2)' }} /> Registry (already RFS)</span>
            </div>
          </section>

          <div className="cols-2">
            <section className="card">
              <div className="card-head"><div><h2 className="card-title">Polygons</h2><div className="card-sub">Click a row to find it on the map.</div></div></div>
              <div className="table-wrap" style={{ maxHeight: 520, marginTop: 10 }}>
                <table className="data">
                  <thead><tr><th>#</th><th>Name</th><th>Status</th><th className="num">Area</th><th className="num">Clean</th><th className="num">HP est.</th><th className="num">HP claimed</th></tr></thead>
                  <tbody>
                    {rows.map(b => (
                      <tr key={b.id} className={`clickable${sel === b.id ? ' is-sel' : ''}`} onClick={() => setSel(b.id)}>
                        <td className="mono small muted">{b.seq}</td>
                        <td>{b.name}{b.folder && <div className="small muted">{b.folder}</div>}</td>
                        <td><StatusBadge status={b.status} /></td>
                        <td className="num">{m2(Number(b.area_m2))}</td>
                        <td className="num">{fmtPct(Number(b.clean_area_m2) / Math.max(1, Number(b.area_m2)), 0)}</td>
                        <td className="num">{fmtInt(b.homepass_est)}</td>
                        <td className="num" style={b.homepass_claimed && b.homepass_est && Number(b.homepass_claimed) > b.homepass_est * 1.15 ? { color: 'var(--high)', fontWeight: 700 } : undefined}>{b.homepass_claimed ? fmtInt(Number(b.homepass_claimed)) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="card">
              <div className="card-head"><div><h2 className="card-title">Conflicting pairs</h2><div className="card-sub">{conflicts.filter(c => c.kind !== 'touch').length} pairs share area; {conflicts.filter(c => c.kind === 'touch').length} only touch.</div></div></div>
              <div className="table-wrap" style={{ maxHeight: 520, marginTop: 10 }}>
                <table className="data">
                  <thead><tr><th>Polygon</th><th>Relation</th><th>With</th><th className="num">Shared</th><th className="num">HP dup.</th></tr></thead>
                  <tbody>
                    {conflicts.map((c, i) => (
                      <tr key={i} className="clickable" onClick={() => setSel(c.a_id)}>
                        <td>{c.a_name}</td>
                        <td><Badge tone={c.kind === 'touch' ? 'low' : c.kind === 'sliver' ? 'warn' : c.kind === 'duplicate' ? 'bad' : 'serious'}>{KIND_LABEL[c.kind]}</Badge></td>
                        <td>{c.b_kind === 'registry' ? <span className="strong">{c.b_name}</span> : c.b_name}</td>
                        <td className="num">{Number(c.overlap_m2) > 0 ? m2(Number(c.overlap_m2)) : '-'}</td>
                        <td className="num">{c.homepass_dup ? fmtInt(c.homepass_dup) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="card card-pad" style={{ marginTop: 14 }}>
            <div className="row between">
              <h2 className="card-title">How the check ran</h2>
              <span className="small muted">{batch.shards_total} shards · {workers.length} distinct workers · at-least-once delivery, idempotent shards</span>
            </div>
            <div style={{ marginTop: 10 }}><ShardGrid shards={shards} /></div>
            <details style={{ marginTop: 12 }}>
              <summary className="strong" style={{ cursor: 'pointer' }}>The SQL behind each pair</summary>
              <pre className="pre" style={{ marginTop: 8 }}>{SQL}</pre>
            </details>
          </section>
        </>
      )}
    </>
  )
}

function StatusBar({ counts, total }: { counts: Record<string, number>; total: number }) {
  const parts = ORDER.filter(s => counts[s])
  return (
    <div style={{ padding: '12px 16px 6px' }}>
      <div style={{ display: 'flex', gap: 2, height: 14 }} role="img" aria-label={parts.map(s => `${STATUS[s].label} ${counts[s]}`).join(', ')}>
        {parts.map((s, i) => (
          <div key={s} title={`${STATUS[s].label}: ${counts[s]}`} style={{ flex: counts[s] / total, background: FILL[s], borderRadius: i === 0 ? '4px 0 0 4px' : i === parts.length - 1 ? '0 4px 4px 0' : 0, minWidth: 4 }} />
        ))}
      </div>
    </div>
  )
}

function ShardGrid({ shards }: { shards: Shard[] }) {
  return (
    <div className="shards">
      {shards.map(s => (
        <div key={s.shard} className={`shard ${s.status}`} title={`shard ${s.shard}: polygons ${s.lo}-${s.hi} · ${s.status}${s.worker ? ` · ${s.worker}` : ''}${s.ms != null ? ` · ${s.ms} ms` : ''}${s.attempts > 1 ? ` · ${s.attempts} attempts` : ''}${s.last_error ? ` · ${s.last_error}` : ''}`}>
          {s.shard}
        </div>
      ))}
      <span className="small muted" style={{ marginLeft: 6 }}>hover a shard for its worker and timing</span>
    </div>
  )
}

const SQL = `-- one shard = a range of polygons; each worker classifies every pair it owns
select a.id, b.id, k.kind, k.overlap_m2
from atlas.boundaries a
join atlas.boundaries b
  on b.batch_id = a.batch_id and b.seq > a.seq   -- each pair once
 and a.geom && b.geom                             -- GiST bounding-box prefilter
cross join lateral atlas.classify_pair(a.geom, b.geom, :sliver_m2) k
where a.batch_id = :batch and a.seq between :lo and :hi;

-- classify_pair(a, b):
--   not ST_Intersects                         -> no row (clean pair)
--   ST_Relate interior/interior = 'F'         -> touch      (edge/corner only)
--   area(ST_SymDifference) < 1% of smaller    -> duplicate
--   ST_Covers(a, b) / ST_CoveredBy(a, b)      -> contains / within
--   area(ST_Intersection) < sliver threshold  -> sliver
--   otherwise                                 -> overlap
-- self-intersection is caught at load time with ST_IsValid / ST_IsValidReason,
-- then ST_MakeValid repairs the ring so the pair checks can still run.
-- areas are geodesic: ST_Area(geom::geography), in m².`
