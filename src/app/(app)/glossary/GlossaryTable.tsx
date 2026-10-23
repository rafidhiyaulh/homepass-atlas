'use client'
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

export type Entry = { g: string; t: string; d: string; b: string }

export function GlossaryTable({ entries }: { entries: Entry[] }) {
  const [q, setQ] = useState('')
  const [g, setG] = useState('All')
  const groups = ['All', ...new Set(entries.map(e => e.g))]
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return entries.filter(e => (g === 'All' || e.g === g) && (!s || `${e.t} ${e.d} ${e.b}`.toLowerCase().includes(s)))
  }, [entries, q, g])
  return (
    <section className="card">
      <div className="card-head" style={{ paddingBottom: 4 }}>
        <div className="seg" role="group" aria-label="Group">
          {groups.map(x => <button key={x} className={g === x ? 'on' : ''} onClick={() => setG(x)}>{x}</button>)}
        </div>
        <label className="row" style={{ gap: 6 }}>
          <Search size={14} className="muted" />
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a term" aria-label="Find a term" style={{ width: 220 }} />
        </label>
      </div>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="data">
          <thead><tr><th style={{ width: '18%' }}>Term</th><th style={{ width: '40%' }}>Meaning</th><th>Benchmark</th></tr></thead>
          <tbody>
            {rows.map(e => (
              <tr key={e.t}>
                <td className="strong">{e.t}</td>
                <td>{e.d}</td>
                <td className="muted">{e.b}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={3} className="muted">No term matches.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}
