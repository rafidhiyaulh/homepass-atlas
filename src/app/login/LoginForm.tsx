'use client'
import { useActionState } from 'react'
import { signIn } from './actions'

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, null)
  return (
    <div style={{ marginTop: 18 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>One-click demo</div>
      <form action={action} className="stack">
        <button className="btn btn-primary" name="demo" value="planner" disabled={pending} style={{ width: '100%', justifyContent: 'center' }}>
          Continue as Market Planner
        </button>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" name="demo" value="partner" disabled={pending} style={{ flex: 1, justifyContent: 'center' }}>Partner (NSF)</button>
          <button className="btn" name="demo" value="viewer" disabled={pending} style={{ flex: 1, justifyContent: 'center' }}>Viewer</button>
        </div>
      </form>
      <div className="hr" />
      <form action={action} className="stack">
        <input className="input" name="email" type="email" placeholder="Email" autoComplete="username" style={{ width: '100%' }} />
        <input className="input" name="password" type="password" placeholder="Password" autoComplete="current-password" style={{ width: '100%' }} />
        <button className="btn" disabled={pending} style={{ width: '100%', justifyContent: 'center' }}>Sign in</button>
      </form>
      {state?.error && <p role="alert" style={{ color: 'var(--crit)', marginTop: 10, fontWeight: 600 }}>{state.error}</p>}
      <p className="small muted" style={{ marginTop: 10 }}>The three roles see different data: the partner account only sees its own areas and uploads (row-level security in Postgres).</p>
    </div>
  )
}
