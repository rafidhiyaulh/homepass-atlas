export const fmtInt = (n: number | null | undefined) => (n == null ? '-' : Math.round(Number(n)).toLocaleString('en-US'))
export const fmtPct = (n: number | null | undefined, d = 1) => (n == null ? '-' : `${(Number(n) * 100).toFixed(d)}%`)

// IDR compact: Rp 1.2B / Rp 340M / Rp 12K (English suffixes, as in the IOH reports)
export function rp(n: number | null | undefined, d = 1) {
  if (n == null) return '-'
  const v = Number(n)
  const a = Math.abs(v)
  const s = v < 0 ? '-' : ''
  if (a >= 1e12) return `${s}Rp ${(a / 1e12).toFixed(d)}T`
  if (a >= 1e9) return `${s}Rp ${(a / 1e9).toFixed(d)}B`
  if (a >= 1e6) return `${s}Rp ${(a / 1e6).toFixed(d)}M`
  if (a >= 1e3) return `${s}Rp ${(a / 1e3).toFixed(0)}K`
  return `${s}Rp ${a.toFixed(0)}`
}

export const m2 = (n: number | null | undefined) => {
  if (n == null) return '-'
  const v = Number(n)
  return v >= 1e6 ? `${(v / 1e6).toFixed(2)} km²` : v >= 1e4 ? `${(v / 1e4).toFixed(1)} ha` : `${Math.round(v).toLocaleString('en-US')} m²`
}

export const months = (n: number | null | undefined) => (n == null ? 'never' : `${Math.round(Number(n))} mo`)
