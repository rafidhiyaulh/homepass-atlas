export function Kpi({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string }) {
  return (
    <div className="kpi" style={accent ? { borderTopColor: accent } : undefined}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

export function Card({ title, sub, right, children, pad = true }: { title?: string; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; pad?: boolean }) {
  return (
    <section className="card">
      {(title || right) && (
        <div className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {right}
        </div>
      )}
      <div className={pad ? 'card-pad' : undefined} style={!pad && title ? { marginTop: 12 } : undefined}>{children}</div>
    </section>
  )
}
