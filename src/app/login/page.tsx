import { LoginForm } from './LoginForm'

export const metadata = { title: 'Sign in' }

export default function LoginPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px 16px', background: 'var(--bg)' }}>
      <div className="card" style={{ width: '100%', maxWidth: 440, overflow: 'hidden' }}>
        <div style={{ height: 3, background: 'var(--grad-brand)' }} />
        <div className="card-pad" style={{ padding: 26 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-ioh-business.png" alt="Indosat Ooredoo Hutchison" style={{ height: 28, width: 'auto' }} />
          <h1 className="page-title" style={{ marginTop: 16 }}>HomePass Atlas</h1>
          <p className="page-sub">Home broadband planning in one place.</p>
          <LoginForm />
          <p className="disclaimer" style={{ marginTop: 18 }}>Prototype by Rafi Dhiyaulhaq. Sample data, not an official Indosat product.</p>
        </div>
      </div>
    </div>
  )
}
