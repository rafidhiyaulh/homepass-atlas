import { requireMe } from '@/lib/auth'
import { AskView } from './AskView'

export const metadata = { title: 'Ask Atlas' }

export default async function Page() {
  await requireMe()
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Market intelligence · natural language</div>
          <h1 className="page-title">Ask Atlas</h1>
          <p className="page-sub">
            Ask in plain English or Bahasa Indonesia. Gemini turns the question into a structured filter from a fixed catalogue;
            the server validates it and runs a parameterised query as you, so row-level security still applies. The model never writes SQL.
          </p>
        </div>
      </div>
      <AskView />
    </>
  )
}
