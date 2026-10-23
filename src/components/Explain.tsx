// "What is this page for?" in three short answers, shown under every page title.
export function Explainer({ question, read, why }: { question: React.ReactNode; read: React.ReactNode; why: React.ReactNode }) {
  return (
    <dl className="explainer">
      <dt>Answers</dt><dd>{question}</dd>
      <dt>How to read</dt><dd>{read}</dd>
      <dt>Why it matters</dt><dd>{why}</dd>
    </dl>
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
