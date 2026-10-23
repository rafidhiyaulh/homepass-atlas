import { Compass, Eye, Target } from 'lucide-react'

// "What is this page for?" in three short answers, shown under every page title.
export function Explainer({ question, read, why }: { question: React.ReactNode; read: React.ReactNode; why: React.ReactNode }) {
  return (
    <div className="explainer">
      <div><span className="ex-h"><Target size={14} /> The question it answers</span><p>{question}</p></div>
      <div><span className="ex-h"><Eye size={14} /> How to read it</span><p>{read}</p></div>
      <div><span className="ex-h"><Compass size={14} /> Why it matters</span><p>{why}</p></div>
    </div>
  )
}

// Facts laid out as small label/value pairs instead of a run-on line with separators.
export function Facts({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <div className="facts">
      {items.map(i => (
        <div key={i.label}>
          <div className="facts-l">{i.label}</div>
          <div className="facts-v">{i.value}</div>
        </div>
      ))}
    </div>
  )
}
