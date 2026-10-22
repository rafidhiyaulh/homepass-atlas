"""Load seed outputs into schema atlas (admin connection). Replaces reference/registry data; leaves
uploads (batches) alone unless --reset-batches is given.

usage: python scripts/pipeline/04_seed.py [--reset-batches]
"""
import json, os, sys
import psycopg
from psycopg.types.json import Jsonb

S = "scripts/data/seed"
env = dict(l.split("=", 1) for l in open(".env.local").read().splitlines() if "=" in l and not l.startswith("#"))
url = env["DATABASE_ADMIN_URL"]

cells = json.load(open(f"{S}/cells.json"))
scores = {s["h3"]: s for s in json.load(open(f"{S}/scores.json"))}
partners = json.load(open(f"{S}/partners.json"))
areas = json.load(open(f"{S}/areas.json"))
monthly = json.load(open(f"{S}/monthly.json"))
run = json.load(open(f"{S}/model_run.json"))

with psycopg.connect(url, prepare_threshold=None, autocommit=False) as con, con.cursor() as cur:
    cur.execute("set search_path = atlas, extensions, public")
    if "--reset-batches" in sys.argv:
        cur.execute("truncate atlas.batches cascade; select pgmq.purge_queue('atlas_shards'); select pgmq.purge_queue('atlas_shards_dlq')")
    cur.execute("truncate atlas.area_monthly, atlas.h3_cells, atlas.model_runs")
    cur.execute("delete from atlas.conflicts where b_kind = 'registry'")
    cur.execute("delete from atlas.areas")
    cur.execute("alter sequence atlas.areas_id_seq restart")

    cur.executemany("""insert into atlas.partners (id, code, name, color, model, upfront_per_hp, fee_per_sub)
                       values (%(id)s, %(code)s, %(name)s, %(color)s, %(model)s, %(upfront_per_hp)s, %(fee_per_sub)s)
                       on conflict (id) do update set code = excluded.code, name = excluded.name, color = excluded.color,
                         model = excluded.model, upfront_per_hp = excluded.upfront_per_hp, fee_per_sub = excluded.fee_per_sub""",
                    partners)

    cur.executemany("""insert into atlas.areas (id, code, name, partner_id, kota, rfs_date, homepass, bp_takeup_m12, geom)
                       values (%(id)s, %(code)s, %(name)s, %(partner_id)s, %(kota)s, %(rfs_date)s, %(homepass)s, %(bp_takeup_m12)s,
                               ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%(g)s), 4326)))""",
                    [dict(a, g=json.dumps(a["geom"])) for a in areas])
    cur.execute("select setval('atlas.areas_id_seq', (select max(id) from atlas.areas))")

    with cur.copy("copy atlas.area_monthly (area_id, month, age_m, active_subs, gross_adds, churned, revenue, partner_cost) from stdin") as cp:
        for m in monthly:
            cp.write_row((m["area_id"], m["month"], m["age_m"], m["active_subs"], m["gross_adds"], m["churned"], m["revenue"], m["partner_cost"]))

    rows = []
    for c in cells:
        s = scores[c["h3"]]
        covered = c["covered_area_id"] is not None
        rows.append(dict(c, g=json.dumps(c["geom"]), p12=s["pred_takeup_m12"], p24=s["pred_takeup_m24"],
                         drivers=Jsonb({"base": s["base"], "items": s["drivers"]}),
                         score=s["rfs_score"], reco="covered" if covered else s["rfs_reco"], pb=s["payback_months"]))
    cur.executemany("""insert into atlas.h3_cells (h3, kota, geom, centroid, buildings, homepass_est, footprint_m2, mdu_share,
                         dist_cbd_km, competitors, covered_area_id, pred_takeup_m12, pred_takeup_m24, drivers, rfs_score, rfs_reco, payback_months)
                       values (%(h3)s, %(kota)s, ST_SetSRID(ST_GeomFromGeoJSON(%(g)s), 4326), ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326),
                         %(buildings)s, %(homepass_est)s, %(footprint_m2)s, %(mdu_share)s, %(dist_cbd_km)s, %(competitors)s,
                         %(covered_area_id)s, %(p12)s, %(p24)s, %(drivers)s, %(score)s, %(reco)s, %(pb)s)""", rows)

    cur.execute("insert into atlas.model_runs (model, target, metrics, importance, notes) values (%s, %s, %s, %s, %s)",
                (run["model"], run["target"], Jsonb(run["metrics"]), Jsonb(run["importance"]), run["notes"]))
    con.commit()
    cur.execute("select (select count(*) from atlas.h3_cells), (select count(*) from atlas.areas), (select count(*) from atlas.area_monthly)")
    print("cells, areas, monthly =", cur.fetchone())
