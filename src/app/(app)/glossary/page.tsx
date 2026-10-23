import { requireMe } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { fmtInt, fmtPct, rp } from '@/lib/format'
import { GlossaryTable, type Entry } from './GlossaryTable'

export const metadata = { title: 'Glossary' }

// Benchmarks: market figures cite their source; "This app" figures are read live from the database.
export default async function Page() {
  const me = await requireMe()
  const [v] = await asUser(me, tx => tx`
    select (select sum(homepass) from atlas.v_area_perf)::int as hp, (select count(*) from atlas.v_area_perf)::int as areas,
           (select sum(subs)::numeric / nullif(sum(homepass), 0) from atlas.v_area_perf)::float as takeup,
           (select sum(revenue_m) / nullif(sum(subs), 0) from atlas.v_area_perf)::float as arpu,
           (select avg(churn_m) from atlas.v_area_perf)::float as churn,
           (select percentile_cont(0.5) within group (order by payback_proj) from atlas.v_area_perf)::float as payback,
           (select sum(buildings) from atlas.h3_cells)::int as buildings, (select count(*) from atlas.h3_cells)::int as cells`)

  const E: Entry[] = [
    // business
    { g: 'Business', t: 'HBB', d: 'Home broadband: internet for homes.', b: '~25% of Indonesian homes have it (Opensignal, Dec 2025).' },
    { g: 'Business', t: 'FTTH', d: 'Fiber to the home. The cable reaches each house.', b: 'IndiHome holds ~67% of fixed broadband (Opensignal, 2025).' },
    { g: 'Business', t: 'FWA', d: 'Home internet over the mobile network. No cable needed.', b: 'Sold by Indosat as HiFi Air, 24 cities (2026).' },
    { g: 'Business', t: 'Home-pass', d: 'A home the fiber passes, ready to connect.', b: `This app: ${fmtInt(v.hp)} home-passes in ${v.areas} areas.` },
    { g: 'Business', t: 'Home-connect', d: 'A home-pass that actually got connected.', b: 'Home-connects divided by home-passes gives take-up.' },
    { g: 'Business', t: 'RFS', d: 'Ready for Service. The network is built, selling starts.', b: 'Area age is counted in months since RFS.' },
    { g: 'Business', t: 'RFS area', d: 'A boundary where the network is ready to sell.', b: `This app: ${v.areas} live RFS areas.` },
    { g: 'Business', t: 'Take-up rate', d: 'Paying customers divided by home-passes.', b: `This app: ${fmtPct(v.takeup)} now; plan is 15% at month 12.` },
    { g: 'Business', t: 'ARPU', d: 'Average monthly revenue per paying customer.', b: `This app: ${rp(v.arpu)} per month.` },
    { g: 'Business', t: 'Churn', d: 'Share of customers who cancel each month.', b: `This app: ${fmtPct(v.churn)} a month on average.` },
    { g: 'Business', t: 'Capex', d: 'Money spent up front to build the network.', b: 'This app: Rp 400K per home-pass, shared-build deals.' },
    { g: 'Business', t: 'SAC', d: 'Subscriber acquisition cost: modem, install and commission.', b: 'This app: Rp 650K per new customer.' },
    { g: 'Business', t: 'Margin', d: 'Revenue minus partner fees and acquisition cost.', b: 'Positive margin is needed before payback can happen.' },
    { g: 'Business', t: 'Payback', d: 'Months until earnings cover what was spent.', b: `This app: median ${v.payback ? Math.round(v.payback) : '-'} months; build if ≤ 30.` },
    { g: 'Business', t: 'Business plan (BP)', d: 'The take-up the company expected at each age.', b: 'This app: 15% at month 12, rising after.' },
    { g: 'Business', t: 'Cohort', d: 'Areas launched in the same period. Compared side by side.', b: 'This app groups cohorts by launch year.' },
    { g: 'Business', t: 'Partner (FiberCo)', d: 'Company owning the fiber. Indosat sells service on top.', b: 'Indosat fiber moved to IFT, 86,000+ km (2026).' },
    { g: 'Business', t: 'Open access', d: 'One fiber network rented by many internet providers.', b: 'IFT runs this wholesale model in Indonesia.' },
    { g: 'Business', t: 'Capex share deal', d: 'We pay part of the build per home-pass.', b: 'Slower payback, cheaper fee per customer.' },
    { g: 'Business', t: 'Revenue share deal', d: 'No build payment. Partner takes a fee per customer.', b: 'Fast payback, lower profit per customer.' },
    { g: 'Business', t: 'Maintain / Optimize / Exit', d: 'Keep, fix, or leave an area.', b: 'This app: exit if under 50% of plan after 18 months.' },
    { g: 'Business', t: 'Desktop study', d: 'Planning from maps and data before field visits.', b: 'Field survey then confirms the shortlisted places.' },
    // map and data
    { g: 'Map & data', t: 'GIS', d: 'Geographic Information System. Data tied to map locations.', b: 'Examples: QGIS, PostGIS, BigQuery GIS, Google Earth.' },
    { g: 'Map & data', t: 'RFS GIS layer', d: 'The map layer holding every RFS boundary.', b: 'Must be clean so homes are counted once.' },
    { g: 'Map & data', t: 'KML', d: 'Google Earth text format for map shapes.', b: 'Opens in Google Earth, QGIS and most GIS tools.' },
    { g: 'Map & data', t: 'KMZ', d: 'A zipped KML file. Partners send coverage maps this way.', b: 'This app accepts up to 20 MB per file.' },
    { g: 'Map & data', t: 'Polygon', d: 'A closed shape drawn on a map.', b: 'Each RFS boundary is one polygon.' },
    { g: 'Map & data', t: 'Clean boundary', d: 'Shares no ground with any other boundary.', b: 'Only clean ground should count as home-passes.' },
    { g: 'Map & data', t: 'Overlap / intersect', d: 'Two boundaries cover the same ground.', b: 'The homes inside get counted twice.' },
    { g: 'Map & data', t: 'Touch', d: 'Boundaries share a border line, not ground.', b: 'Normal for neighbours. Counted as clean.' },
    { g: 'Map & data', t: 'Sliver', d: 'A tiny overlap, usually a drawing mistake.', b: 'This app: under 500 m² by default.' },
    { g: 'Map & data', t: 'Duplicate', d: 'The same boundary submitted twice.', b: 'Doubles every home-pass inside it.' },
    { g: 'Map & data', t: 'Self-intersection', d: 'The outline crosses itself, like a figure 8.', b: 'Invalid shape. Must be redrawn before use.' },
    { g: 'Map & data', t: 'Registry', d: 'Official list of live areas and their boundaries.', b: 'New files are checked against it.' },
    { g: 'Map & data', t: 'Building footprint', d: 'A building outline seen from above.', b: `This app: ${fmtInt(v.buildings)} from Overture Maps.` },
    { g: 'Map & data', t: 'H3 hexagon', d: 'Equal-size hexagon grid for comparing places fairly.', b: `This app: ${fmtInt(v.cells)} hexagons, ~0.74 km² each.` },
    { g: 'Map & data', t: 'MDU', d: 'Multi-dwelling unit: apartments or flats.', b: 'Needs building-access deals to sell inside.' },
    // technology
    { g: 'Technology', t: 'SQL', d: 'The language for asking a database questions.', b: 'Used here for every number on screen.' },
    { g: 'Technology', t: 'PostGIS', d: 'Map functions added to the Postgres database.', b: 'Runs the overlap check, e.g. ST_Intersects.' },
    { g: 'Technology', t: 'API', d: 'A door the screens use to fetch data.', b: 'This app has 11 of them.' },
    { g: 'Technology', t: 'RLS', d: 'Row-level security. Each user sees only their rows.', b: 'Partners here see only their own areas.' },
    { g: 'Technology', t: 'Queue', d: 'A waiting line of jobs for workers.', b: 'This app uses pgmq inside Postgres.' },
    { g: 'Technology', t: 'Worker', d: 'A small server that takes one job at a time.', b: 'Several run in parallel on a big file.' },
    { g: 'Technology', t: 'Shard', d: 'One slice of a big job.', b: 'A KMZ is split into about six slices.' },
    { g: 'Technology', t: 'LLM', d: 'AI that reads and writes text.', b: 'This app uses Google Gemini.' },
    { g: 'Technology', t: 'LightGBM', d: 'A fast machine-learning model built from decision trees.', b: 'Predicts take-up after one year here.' },
    { g: 'Technology', t: 'SHAP', d: 'Shows which factors pushed a prediction up or down.', b: 'Shown for every hexagon on the RFS page.' },
    { g: 'Technology', t: 'MAE', d: 'Average size of the prediction error.', b: 'This app: about ±4 points of take-up.' },
    { g: 'Technology', t: 'Serverless', d: 'Code runs on demand. No servers to manage.', b: 'This app runs on Vercel.' },
  ]

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Glossary</h1>
          <p className="page-sub">Every term used on this site, with a benchmark.</p>
        </div>
      </div>
      <GlossaryTable entries={E} />
      <p className="disclaimer" style={{ marginTop: 12 }}>&quot;This app&quot; figures use sample data. Market figures cite their source.</p>
    </>
  )
}
