export type Tone = 'good' | 'warn' | 'serious' | 'bad' | 'neutral' | 'low' | 'brand'

export function Badge({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return <span className={`badge b-${tone}`} title={title}>{children}</span>
}

// Boundary statuses: icon glyph + label + colour, never colour alone
export const STATUS: Record<string, { tone: Tone; label: string; icon: string; help: string }> = {
  clean:     { tone: 'good',    label: 'Clean',          icon: '✓', help: 'Shares no ground with any other shape' },
  touch:     { tone: 'low',     label: 'Border only',    icon: '◇', help: 'Shares a border line but no ground, still clean' },
  sliver:    { tone: 'warn',    label: 'Sliver',         icon: '≈', help: 'A tiny overlap, most likely a drawing mistake' },
  overlap:   { tone: 'serious', label: 'Overlap',        icon: '▲', help: 'Covers ground that another shape also covers' },
  duplicate: { tone: 'bad',     label: 'Duplicate',      icon: '■', help: 'The same shape was sent twice' },
  invalid:   { tone: 'bad',     label: 'Broken shape',   icon: '✕', help: 'The outline crosses itself, so the shape is invalid' },
}

export const ACTION: Record<string, { tone: Tone; label: string; icon: string }> = {
  maintain: { tone: 'good', label: 'Keep', icon: '✓' },
  optimize: { tone: 'warn', label: 'Fix', icon: '▲' },
  exit:     { tone: 'bad', label: 'Exit', icon: '✕' },
  ramping:  { tone: 'neutral', label: 'Too early', icon: '…' },
}

export const RECO: Record<string, { tone: Tone; label: string }> = {
  build: { tone: 'brand', label: 'Build fiber' },
  fwa: { tone: 'low', label: 'Offer HiFi Air' },
  hold: { tone: 'neutral', label: 'Wait' },
  covered: { tone: 'neutral', label: 'Has fiber' },
}

export function StatusBadge({ status }: { status: string | null }) {
  const s = STATUS[status ?? ''] ?? { tone: 'neutral' as Tone, label: status ?? 'pending', icon: '…', help: '' }
  return <Badge tone={s.tone} title={s.help}><span aria-hidden>{s.icon}</span>{s.label}</Badge>
}

export function PartnerDot({ id, code, name }: { id: number; code?: string; name?: string }) {
  return (
    <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: `var(--partner-${id})`, flex: 'none' }} />
      {code && <span className="mono" style={{ fontSize: 11.5 }}>{code}</span>}
      {name && <span>{name}</span>}
    </span>
  )
}
