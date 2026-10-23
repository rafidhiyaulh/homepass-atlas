'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Boxes, ChartLine, Compass, Gauge, LogOut, Map, Menu, MessageSquareText, Moon, Network, ShieldCheck, Sun } from 'lucide-react'

const NAV = [
  { group: 'Overview', items: [{ href: '/', label: 'Market overview', icon: Gauge }] },
  {
    group: 'Planning',
    items: [
      { href: '/hygiene', label: 'Boundary hygiene', icon: ShieldCheck },
      { href: '/rfs', label: 'RFS desktop study', icon: Compass },
    ],
  },
  {
    group: 'Performance',
    items: [
      { href: '/profitability', label: 'Profitability & cohorts', icon: ChartLine },
      { href: '/portfolio', label: 'Portfolio actions', icon: Boxes },
    ],
  },
  { group: 'Insight', items: [{ href: '/ask', label: 'Ask Atlas', icon: MessageSquareText }] },
  { group: 'About', items: [{ href: '/architecture', label: 'How it is built', icon: Network }] },
]

export function Shell({ me, children }: { me: { display_name: string; role: string; email?: string }; children: React.ReactNode }) {
  const path = usePathname()
  const [open, setOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null)

  useEffect(() => {
    const t = document.documentElement.dataset.theme
    setTheme(t === 'dark' || t === 'light' ? t : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  }, [])
  useEffect(() => setOpen(false), [path])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('atlas-theme', next) } catch {}
    setTheme(next)
    window.dispatchEvent(new Event('atlas-theme'))
  }

  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href))
  const current = NAV.flatMap(g => g.items).find(i => active(i.href))

  return (
    <div className="app">
      {open && <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 45 }} />}
      <aside className={`rail${open ? ' open' : ''}`} aria-label="Navigation">
        <div className="rail-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-ioh-business.png" alt="Indosat Ooredoo Hutchison" />
          <div className="product">HomePass Atlas</div>
          <div className="sub">HBB Market Planning &amp; Insight</div>
        </div>
        <nav>
          {NAV.map(g => (
            <div key={g.group}>
              <div className="group">{g.group}</div>
              {g.items.map(i => (
                <Link key={i.href} href={i.href} className={`nav-item${active(i.href) ? ' is-active' : ''}`}>
                  <i.icon size={15} strokeWidth={2} /> {i.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="rail-foot">
          Concept prototype by Rafi Dhiyaulhaq.<br />Not an official Indosat product. Partner and subscriber data are synthetic.
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-sm menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={16} /></button>
          <Map size={15} className="muted" aria-hidden />
          <span className="crumb">{current?.label ?? 'HomePass Atlas'}</span>
          <span className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
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
