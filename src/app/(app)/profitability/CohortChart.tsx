'use client'
import { LineChart, type Series } from '@/components/charts/LineChart'
import { fmtPct } from '@/lib/format'

// Cohorts are ordered in time, so they take one sequential hue (older = lighter); the plan is ink, dashed.
export function CohortChart({ cohorts, plan }: { cohorts: { cohort: number; age: number; takeup: number }[]; plan: { age: number; takeup: number }[] }) {
  const years = [...new Set(cohorts.map(c => c.cohort))].sort()
  const step = (i: number) => `var(--seq-${Math.min(4, 5 - years.length + i)})`
  const series: Series[] = [
    ...years.map((y, i) => ({
      key: String(y), label: `${y}`, color: step(i), emphasis: i === years.length - 1,
      points: cohorts.filter(c => c.cohort === y).map(c => ({ x: c.age, y: c.takeup })),
    })),
    { key: 'plan', label: 'Plan', color: 'var(--ink)', dashed: true, points: plan.filter(p => p.age <= Math.max(...cohorts.map(c => c.age))).map(p => ({ x: p.age, y: p.takeup })) },
  ]
  return <LineChart series={series} height={300} xLabel="Months since RFS" xFormat={v => `M${v}`} yFormat={v => fmtPct(v, 0)} />
}
