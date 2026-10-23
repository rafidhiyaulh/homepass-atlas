export type Tone = 'good' | 'warn' | 'serious' | 'bad' | 'neutral' | 'low' | 'brand'

export function Badge({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return <span className={`badge b-${tone}`} title={title}>{children}</span>
}

// Boundary statuses: icon glyph + label + colour, never colour alone
export const STATUS: Record<string, { tone: Tone; label: string; icon: string; help: string }> = {
  clean:     { tone: 'good',    label: 'Clean',          icon: '✓', help: 'No contact with any other polygon' },
  touch:     { tone: 'low',     label: 'Touch only',     icon: '◇', help: 'Shares an edge/corner, no shared area' },
  sliver:    { tone: 'warn',    label: 'Sliver',         icon: '≈', help: 'Shares less than the sliver threshold (digitising noise)' },
  overlap:   { tone: 'serious', label: 'Overlap',        icon: '▲', help: 'Shares area with another polygon or the registry' },
  duplicate: { tone: 'bad',     label: 'Duplicate',      icon: '■', help: 'Same footprint submitted more than once' },
  invalid:   { tone: 'bad',     label: 'Self-intersect', icon: '✕', help: 'Ring crosses itself (invalid geometry)' },
}

export const ACTION: Record<string, { tone: Tone; label: string; icon: string }> = {
  maintain: { tone: 'good', label: 'Maintain', icon: '✓' },
  optimize: { tone: 'warn', label: 'Optimize', icon: '▲' },
  exit:     { tone: 'bad', label: 'Exit', icon: '✕' },
  ramping:  { tone: 'neutral', label: 'Ramping', icon: '…' },
}

export const RECO: Record<string, { tone: Tone; label: string }> = {
  build: { tone: 'brand', label: 'Build fiber' },
  fwa: { tone: 'low', label: 'HiFi Air (FWA)' },
  hold: { tone: 'neutral', label: 'Hold' },
  covered: { tone: 'neutral', label: 'Covered' },
}

export function StatusBadge({ status }: { status: string | null }) {
  const s = STATUS[status ?? ''] ?? { tone: 'neutral' as Tone, label: status ?? 'pending', icon: '…', help: '' }
  return <Badge tone={s.tone} title={s.help}><span aria-hidden>{s.icon}</span>{s.label}</Badge>
}

export function PartnerDot({ id, code }: { id: number; code?: string }) {
  return (
    <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: `var(--partner-${id})`, flex: 'none' }} />
      {code && <span className="mono" style={{ fontSize: 11.5 }}>{code}</span>}
    </span>
  )
}
