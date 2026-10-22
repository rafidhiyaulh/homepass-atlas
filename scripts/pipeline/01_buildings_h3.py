"""Aggregate Overture Maps building footprints (Google Open Buildings + Microsoft + OSM) for the
Jabodetabek core into H3 resolution-8 cells. Only aggregates leave this script; no footprints are stored.

Output: scripts/data/h3_buildings.parquet  (h3, buildings, footprint_m2, small, medium, large)
"""
import sys, time, duckdb

RELEASE = "2026-09-23.1"
BBOX = dict(xmin=106.68, xmax=107.00, ymin=-6.40, ymax=-6.08)   # DKI Jakarta + edges of Depok/Tangerang/Bekasi
OUT = sys.argv[1] if len(sys.argv) > 1 else "scripts/data/h3_buildings.parquet"

c = duckdb.connect()
c.sql("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; LOAD h3; SET s3_region='us-west-2'; SET geometry_always_xy = true;")
t0 = time.time()
c.sql(f"""
COPY (
  WITH b AS (
    SELECT ST_Area_Spheroid(geometry) AS m2,
           ST_X(ST_Centroid(geometry)) AS lon, ST_Y(ST_Centroid(geometry)) AS lat
    FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=buildings/type=building/*', hive_partitioning=1)
    WHERE bbox.xmin BETWEEN {BBOX['xmin']} AND {BBOX['xmax']}
      AND bbox.ymin BETWEEN {BBOX['ymin']} AND {BBOX['ymax']}
  )
  SELECT h3_h3_to_string(h3_latlng_to_cell(lat, lon, 8)) AS h3,
         count(*) AS buildings,
         sum(m2) AS footprint_m2,
         count(*) FILTER (WHERE m2 < 25)              AS tiny,      -- sheds, kiosks: not a home
         count(*) FILTER (WHERE m2 BETWEEN 25 AND 500) AS small,    -- landed houses / ruko
         count(*) FILTER (WHERE m2 > 500 AND m2 <= 5000) AS medium, -- MDU / apartments / commercial
         count(*) FILTER (WHERE m2 > 5000) AS large,
         sum(m2) FILTER (WHERE m2 > 500 AND m2 <= 5000) AS medium_m2
  FROM b GROUP BY 1
) TO '{OUT}' (FORMAT parquet)
""")
print("rows", c.sql(f"select count(*), sum(buildings) from '{OUT}'").fetchall()[0], f"{time.time()-t0:.0f}s")
