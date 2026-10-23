import type { Metadata } from 'next'
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta', weight: ['400', '500', '600', '700', '800'] })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', weight: ['400', '600'] })

export const metadata: Metadata = {
  title: { default: 'HomePass Atlas', template: '%s | HomePass Atlas' },
  description: 'HBB planning & profitability: boundary hygiene, RFS desktop study, profitability and portfolio actions. Concept prototype.',
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        {children}
      </body>
    </html>
  )
}
