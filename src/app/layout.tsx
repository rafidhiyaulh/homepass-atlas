import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', weight: ['400', '500', '600', '700', '800'] })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', weight: ['400', '600'] })

export const metadata: Metadata = {
  title: { default: 'HomePass Atlas', template: '%s · HomePass Atlas' },
  description: 'HBB market planning & insight: boundary hygiene, RFS desktop study, profitability and portfolio actions. Concept prototype.',
  robots: { index: false, follow: false },
}

// Applies the stored theme before first paint (no flash). Static string, no user input.
const themeScript = `try{var t=localStorage.getItem('atlas-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
