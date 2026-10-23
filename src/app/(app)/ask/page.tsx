import { requireMe } from '@/lib/auth'
import { AskView } from './AskView'
import { Explainer } from '@/components/Explain'

export const metadata = { title: 'Ask Atlas' }

export default async function Page() {
  await requireMe()
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Ask Atlas</h1>
          <p className="page-sub">Type a question in English or Bahasa Indonesia.</p>
        </div>
      </div>
      <Explainer
        question="Ask the data anything, no query needed."
        read="Tags show how the AI understood you. Results appear below."
        why="Fast answers for everyone. The AI cannot change data."
      />
      <AskView />
    </>
  )
}
