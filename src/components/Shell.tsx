'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LogOut, Menu, Moon, Sun } from 'lucide-react'

const NAV = [
  { group: 'Overview', items: [{ href: '/', label: 'Market overview' }] },
  {
    group: 'Planning',
    items: [
      { href: '/hygiene', label: 'Boundary hygiene' },
      { href: '/rfs', label: 'RFS desktop study' },
    ],
  },
  {
    group: 'Performance',
    items: [
      { href: '/profitability', label: 'Profitability & cohorts' },
      { href: '/portfolio', label: 'Portfolio actions' },
    ],
  },
  { group: 'Insight', items: [{ href: '/ask', label: 'Ask Atlas' }] },
  { group: 'About', items: [{ href: '/architecture', label: 'How it is built' }, { href: '/glossary', label: 'Glossary' }] },
]

export function Shell({ me, children }: { me: { display_name: string; role: string; email?: string }; children: React.ReactNode }) {
  const path = usePathname()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    // the OS preference applies by default (pure CSS); an explicit choice is remembered per browser
    try {
      const saved = localStorage.getItem('atlas-theme')
      if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved
    } catch {}
  }, [])

  const toggleTheme = () => {
    const root = document.documentElement
    const now = root.dataset.theme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    const next = now === 'dark' ? 'light' : 'dark'
    root.dataset.theme = next
    try { localStorage.setItem('atlas-theme', next) } catch {}
  }

  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href))
  const current = NAV.flatMap(g => g.items).find(i => active(i.href))

  return (
    <div className="app">
      {open && <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 45 }} />}
      <aside className={`rail${open ? ' open' : ''}`} aria-label="Navigation">
        <div className="rail-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo-light" src="/logo-ioh-business.png" alt="Indosat Ooredoo Hutchison" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo-dark" src="/logo-ioh-business-dark.png" alt="Indosat Ooredoo Hutchison" />
          <div className="product">HomePass Atlas</div>
          <div className="sub">HBB Planning &amp; Profitability</div>
        </div>
        <nav>
          {NAV.map(g => (
            <div key={g.group}>
              <div className="group">{g.group}</div>
              {g.items.map(i => (
                <Link key={i.href} href={i.href} onClick={() => setOpen(false)} className={`nav-item${active(i.href) ? ' is-active' : ''}`}>
                  {i.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="rail-foot">
          Prototype by Rafi Dhiyaulhaq<br />Sample data
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-sm menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={16} /></button>
          <span className="crumb">{current?.label ?? 'HomePass Atlas'}</span>
          <span className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={toggleTheme} aria-label="Toggle theme">
            <Sun size={15} className="when-dark" /><Moon size={15} className="when-light" />
          </button>
          <span className="small" style={{ textAlign: 'right', lineHeight: 1.25 }}>
            <span className="strong">{me.display_name}</span><br />
            <span className="muted">{me.role}</span>
          </span>
          <form action="/auth/signout" method="post">
            <button className="btn btn-sm" aria-label="Sign out"><LogOut size={14} /></button>
          </form>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
