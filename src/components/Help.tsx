'use client'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'

// Plain-language definitions for every bit of jargon on the site.
export const GLOSSARY = {
  kmz: 'A zipped Google Earth map file. Partners send coverage boundaries this way.',
  homepass: 'A home the fiber passes, ready to connect.',
  rfs: 'Ready for Service. The network is built, selling starts.',
  takeup: 'Paying customers divided by home-passes. 10% means 1 in 10 homes.',
  plan: 'The take-up the business plan expected by now.',
  payback: 'Months until earnings cover what was spent.',
  registry: 'Official list of live areas and their boundaries.',
  partner: 'Company owning the fiber. Indosat sells service on top.',
  clean: 'Shares no ground with any other boundary.',
  sliver: 'A tiny overlap, usually a drawing mistake.',
  touch: 'Boundaries share a border line, not ground. Counted as clean.',
  overlap: 'Two boundaries cover the same ground. Homes get counted twice.',
  duplicate: 'The same boundary submitted twice.',
  selfintersect: 'The outline crosses itself. The shape is invalid.',
  cohort: 'Areas launched in the same year, compared side by side.',
  fwa: 'HiFi Air: internet over the mobile network. No cable needed.',
  hex: 'Equal hexagons of about 0.74 km². Places compared fairly.',
  shap: 'Shows which factors pushed this prediction up or down.',
  margin: 'Revenue minus partner fees and installation costs.',
  churn: 'Share of customers who cancel each month.',
  shard: 'One slice of the file. Slices are checked in parallel.',
  worker: 'A small server that takes one job at a time.',
} as const
export type TermKey = keyof typeof GLOSSARY

// Floating explanation, rendered into <body> so tables and cards never clip it.
function Pop({ anchor, text }: { anchor: DOMRect; text: string }) {
  const left = Math.min(Math.max(12, anchor.left), window.innerWidth - 292)
  const below = anchor.bottom + 8 + 120 < window.innerHeight
  return createPortal(
    <div role="tooltip" className="pop" style={{ left, top: below ? anchor.bottom + 8 : undefined, bottom: below ? undefined : window.innerHeight - anchor.top + 8 }}>{text}</div>,
    document.body,
  )
}

function useHover() {
  const ref = useRef<HTMLSpanElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const on = () => ref.current && setRect(ref.current.getBoundingClientRect())
  const off = () => setRect(null)
  return { ref, rect, handlers: { onMouseEnter: on, onMouseLeave: off, onFocus: on, onBlur: off } }
}

// A word with a dotted underline that explains itself on hover or keyboard focus.
export function Term({ k, children }: { k: TermKey; children: React.ReactNode }) {
  const { ref, rect, handlers } = useHover()
  return (
    <span ref={ref} className="term" tabIndex={0} {...handlers}>
      {children}
      {rect && <Pop anchor={rect} text={GLOSSARY[k]} />}
    </span>
  )
}

// A small (i) icon for places where underlining the word would be too busy.
export function InfoTip({ text, k }: { text?: string; k?: TermKey }) {
  const { ref, rect, handlers } = useHover()
  const body = text ?? (k ? GLOSSARY[k] : '')
  return (
    <span ref={ref} className="info-tip" tabIndex={0} aria-label={body} {...handlers}>
      <Info size={12} />
      {rect && <Pop anchor={rect} text={body} />}
    </span>
  )
}
