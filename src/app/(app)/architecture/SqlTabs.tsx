'use client'
import { useState } from 'react'

const SQL: Record<string, string> = {
  PostGIS: `-- boundaries(id, name, geom)  loaded from KML (ogr2ogr / ST_GeomFromKML)
with b as (
  select id, name, ST_IsValid(geom) as is_valid, ST_MakeValid(geom) as geom from boundaries
), pairs as (
  select a.id, x.id as other,
         case when not ST_Intersects(a.geom, x.geom) then null
              when ST_Relate(a.geom, x.geom, 'F********') then 'touch'      -- interiors disjoint
              else 'overlap' end as rel,
         ST_Area(ST_Intersection(a.geom, x.geom)::geography) as shared_m2
  from b a join b x on a.id <> x.id and a.geom && x.geom           -- GiST prefilter
)
select b.id, b.name,
  case when not b.is_valid                                         then 'self_intersect'
       when exists (select 1 from pairs p where p.id = b.id and p.rel = 'overlap') then 'overlap'
       when exists (select 1 from pairs p where p.id = b.id and p.rel = 'touch')   then 'touch_only'
       else 'clean' end as status
from b order by status, b.name;`,
  'BigQuery GIS': `-- GEOGRAPHY is always valid in BigQuery: make_valid repairs, so flag invalid input first
with raw as (
  select id, name, geojson, safe.st_geogfromgeojson(geojson) is null as was_invalid,
         st_geogfromgeojson(geojson, make_valid => true) as g
  from \`project.dataset.boundaries_raw\`
), pairs as (
  select a.id, x.id as other,
         st_intersects(a.g, x.g) and not st_touches(a.g, x.g) as overlaps,
         st_touches(a.g, x.g) as touches,
         st_area(st_intersection(a.g, x.g)) as shared_m2              -- m2 on the spheroid
  from raw a join raw x on a.id < x.id and st_intersects(a.g, x.g)
)
select r.id, r.name,
  case when r.was_invalid then 'self_intersect'
       when exists (select 1 from pairs p where (p.id = r.id or p.other = r.id) and p.overlaps) then 'overlap'
       when exists (select 1 from pairs p where (p.id = r.id or p.other = r.id) and p.touches)  then 'touch_only'
       else 'clean' end as status
from raw r;`,
  DuckDB: `INSTALL spatial; LOAD spatial; SET geometry_always_xy = true;
create table b as
select row_number() over () as id, Name as name, ST_IsValid(geom) as is_valid, ST_MakeValid(geom) as geom
from ST_Read('/vsizip/partner.kmz/doc.kml');           -- or unzip first

select a.id, a.name,
  case when not a.is_valid then 'self_intersect'
       when exists (select 1 from b x where x.id <> a.id
                    and ST_Intersects(a.geom, x.geom) and not ST_Touches(a.geom, x.geom)) then 'overlap'
       when exists (select 1 from b x where x.id <> a.id and ST_Touches(a.geom, x.geom))   then 'touch_only'
       else 'clean' end as status
from b a order by status;
-- shared area in m2: ST_Area_Spheroid(ST_Intersection(a.geom, x.geom))`,
}

const WHY: Record<string, string> = {
  PostGIS: 'The database behind this app. It runs the real check.',
  'BigQuery GIS': 'Google\'s data warehouse, common in telco data teams.',
  DuckDB: 'Runs on a laptop, no setup. Ideal for quick tests.',
}

export function SqlTabs() {
  const [k, setK] = useState('PostGIS')
  return (
    <>
      <div className="seg" role="tablist">
        {Object.keys(SQL).map(t => <button key={t} role="tab" aria-selected={k === t} className={k === t ? 'on' : ''} onClick={() => setK(t)}>{t}</button>)}
      </div>
      <p className="small strong" style={{ marginTop: 10 }}>{WHY[k]}</p>
      <pre className="pre" style={{ marginTop: 8 }}>{SQL[k]}</pre>
      <div className="small muted" style={{ marginTop: 8 }}>
        <div className="strong" style={{ color: 'var(--ink2)' }}>Ask the business first:</div>
        <ul style={{ margin: '4px 0 0 18px' }}>
          <li>Does a shared border count as a clash?</li>
          <li>How small is a drawing mistake, in m²?</li>
          <li>Check within the file, or against live areas too?</li>
        </ul>
      </div>
    </>
  )
}
