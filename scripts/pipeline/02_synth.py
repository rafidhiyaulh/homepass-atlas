"""Build the H3 market grid from real building aggregates, then generate a SYNTHETIC home-pass registry
(fictional partners, RFS areas) and monthly performance on top of it.

Real:      building counts/footprints (Overture Maps), kota boundaries (BPS via geoBoundaries).
Synthetic: partners, RFS areas, subscribers, revenue, competitor presence. The generating process is
           written down here so the ML module can be checked against a known truth.

Outputs (scripts/data/seed/): cells.json, partners.json, areas.json, monthly.json, train.parquet
"""
import json, math, os
from datetime import date
import h3, numpy as np, pandas as pd
from shapely.geometry import shape, Point, Polygon, mapping
from shapely.ops import unary_union
from shapely.prepared import prep

rng = np.random.default_rng(20261023)
D = "scripts/data"
OUT = f"{D}/seed"
os.makedirs(OUT, exist_ok=True)

KOTA = ["Kota Jakarta Pusat", "Kota Jakarta Selatan", "Kota Jakarta Barat", "Kota Jakarta Timur", "Kota Jakarta Utara",
        "Kota Depok", "Kota Tangerang", "Kota Tangerang Selatan", "Kota Bekasi"]
SHORT = {"Kota Jakarta Pusat": "JKP", "Kota Jakarta Selatan": "JKS", "Kota Jakarta Barat": "JKB", "Kota Jakarta Timur": "JKT",
         "Kota Jakarta Utara": "JKU", "Kota Depok": "DPK", "Kota Tangerang": "TNG", "Kota Tangerang Selatan": "TSL", "Kota Bekasi": "BKS"}
CBD = (-6.1949, 106.8230)          # Bundaran HI
TAU = 7.0                          # months: take-up ramp time constant (truth)
AS_OF = date(2026, 9, 1)           # last month of actuals

# ------------------------------------------------------------------ grid
adm = json.load(open(f"{D}/idn_adm2.geojson"))
kota_geo = {f["properties"]["shapeName"]: shape(f["geometry"]) for f in adm["features"] if f["properties"]["shapeName"] in KOTA}
kota_prep = {k: prep(g) for k, g in kota_geo.items()}

b = pd.read_parquet(f"{D}/h3_buildings.parquet")
rows = []
for r in b.itertuples():
    lat, lng = h3.cell_to_latlng(r.h3)
    k = next((k for k, g in kota_prep.items() if g.contains(Point(lng, lat))), None)
    if k is None or r.buildings < 40:
        continue
    medium_m2 = float(r.medium_m2 or 0)
    # home-pass heuristic: small footprints ~ one household each; mid-size buildings (MDU, ruko blocks,
    # apartments) ~ half residential, one unit per 120 m2 of footprint, assuming ~3 floors
    hp = int(round(r.small * 0.9 + medium_m2 * 0.5 * 3 / 120))
    rows.append(dict(h3=r.h3, kota=k, lat=lat, lng=lng, buildings=int(r.buildings), homepass_est=hp,
                     footprint_m2=float(r.footprint_m2), mdu_share=medium_m2 / max(float(r.footprint_m2), 1)))
cells = pd.DataFrame(rows)

def hav(lat1, lng1, lat2, lng2):
    p = math.pi / 180
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lng2 - lng1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))

cells["dist_cbd_km"] = [hav(CBD[0], CBD[1], a, o) for a, o in zip(cells.lat, cells.lng)]
cells["avg_bldg_m2"] = cells.footprint_m2 / cells.buildings
cells["density"] = cells.buildings / h3.average_hexagon_area(8, unit="km^2")
# synthetic competitor presence: the incumbent is everywhere, challengers follow density
lam = 0.6 + 1.6 * (cells.density / cells.density.quantile(0.9)).clip(0, 1.5)
cells["competitors"] = (1 + rng.poisson(lam)).clip(1, 5)

def z(s):
    return (s - s.mean()) / s.std()

# ---- TRUTH: take-up ceiling per cell (what the ML model will try to recover)
logit_cap = (-1.15 + 0.55 * z(np.log(cells.avg_bldg_m2)) - 0.32 * (cells.competitors - 2)
             - 0.035 * cells.dist_cbd_km - 0.9 * cells.mdu_share + 0.25 * z(np.log1p(cells.homepass_est))
             + rng.normal(0, 0.25, len(cells)))
cells["cap_true"] = 1 / (1 + np.exp(-logit_cap))
cells = cells.reset_index(drop=True)
print(f"cells {len(cells)}  homepass_est {cells.homepass_est.sum():,}  cap mean {cells.cap_true.mean():.3f}")

# ------------------------------------------------------------------ partners (fictional)
partners = [
    dict(id=1, code="NSF", name="Nusa Serat Fiber",       color="#1F7A8C", model="capex_share",   upfront_per_hp=420000, fee_per_sub=95000,  q=+0.20, home=["Kota Jakarta Selatan", "Kota Tangerang Selatan", "Kota Depok"]),
    dict(id=2, code="JOP", name="Jaya Optik Persada",     color="#7A4FB5", model="revenue_share", upfront_per_hp=0,      fee_per_sub=148000, q=-0.05, home=["Kota Jakarta Barat", "Kota Tangerang", "Kota Jakarta Utara"]),
    dict(id=3, code="LRN", name="Lintas Rumah Nusantara", color="#C27C0E", model="capex_share",   upfront_per_hp=380000, fee_per_sub=105000, q=0.00,  home=["Kota Jakarta Timur", "Kota Bekasi"]),
    dict(id=4, code="MKF", name="Metro Kabel Fiber",      color="#3D5A80", model="revenue_share", upfront_per_hp=0,      fee_per_sub=138000, q=-0.30, home=["Kota Jakarta Pusat", "Kota Jakarta Utara", "Kota Bekasi"]),
]
PQ = {p["id"]: p for p in partners}

# ------------------------------------------------------------------ RFS areas: clusters of adjacent cells
idx = {h: i for i, h in enumerate(cells.h3)}
owner = np.full(len(cells), -1)
weights = (cells.homepass_est.clip(50) ** 1.2).to_numpy(dtype=float)
months = pd.date_range("2023-03-01", "2026-06-01", freq="MS")
areas, area_cells = [], []
target_cover = 0.27 * len(cells)
while (owner >= 0).sum() < target_cover:
    free = np.where(owner < 0)[0]
    seed = rng.choice(free, p=weights[free] / weights[free].sum())
    size = int(rng.integers(2, 7))
    grp, frontier = [seed], [seed]
    while frontier and len(grp) < size:
        cur = frontier.pop(0)
        nb = [idx[n] for n in h3.grid_ring(cells.h3[cur], 1) if n in idx and owner[idx[n]] < 0 and idx[n] not in grp]
        rng.shuffle(nb)
        for n in nb[: size - len(grp)]:
            grp.append(n); frontier.append(n)
    if len(grp) < 2:
        owner[seed] = -2      # isolated cell: leave uncovered
        continue
    aid = len(areas) + 1
    owner[grp] = aid
    kota = cells.kota[seed]
    home = [p["id"] for p in partners if kota in p["home"]]
    pid = int(rng.choice(home)) if home and rng.random() < 0.8 else int(rng.integers(1, 5))
    rfs = months[int(rng.integers(0, len(months)))].date()
    areas.append(dict(id=aid, partner_id=pid, kota=kota, rfs_date=rfs, cells=[cells.h3[i] for i in grp]))
owner[owner == -2] = -1
cells["covered_area_id"] = [int(o) if o > 0 else None for o in owner]

seq_by_code = {}
for a in areas:
    p = PQ[a["partner_id"]]
    key = (p["code"], SHORT[a["kota"]])
    seq_by_code[key] = seq_by_code.get(key, 0) + 1
    a["code"] = f"{p['code']}-{SHORT[a['kota']]}-{seq_by_code[key]:03d}"
    a["name"] = f"{a['kota'].replace('Kota ', '')} cluster {seq_by_code[key]}"
    sub = cells[cells.h3.isin(a["cells"])]
    poly = unary_union([Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(h)]) for h in a["cells"]])
    a["geom"] = mapping(poly)
    a["homepass"] = int(round(sub.homepass_est.sum() * rng.uniform(0.78, 0.92)))   # not every building is passed
    a["bp_takeup_m12"] = 0.15
    a["cap_area"] = float(np.average(sub.cap_true, weights=sub.homepass_est.clip(1)))

# ------------------------------------------------------------------ monthly actuals (truth + noise)
monthly, train = [], []
for a in areas:
    p = PQ[a["partner_id"]]
    sub = cells[cells.h3.isin(a["cells"])]
    lc = math.log(a["cap_area"] / (1 - a["cap_area"])) + p["q"] + rng.normal(0, 0.3)
    cap = 1 / (1 + math.exp(-lc))
    arpu = 255000 * (1 + 0.08 * float(z(np.log(cells.avg_bldg_m2))[sub.index].mean())) * rng.uniform(0.95, 1.05)
    churn_rate = rng.uniform(0.012, 0.03)
    subs_prev = 0
    start = pd.Timestamp(a["rfs_date"])
    for age, m in enumerate(pd.date_range(start, pd.Timestamp(AS_OF), freq="MS")):
        target = a["homepass"] * cap * (1 - math.exp(-(age + 0.5) / TAU))
        churned = int(rng.binomial(subs_prev, churn_rate)) if subs_prev else 0
        gross = max(0, int(round(target - subs_prev + churned + rng.normal(0, max(2, target * 0.02)))))
        subs = max(0, subs_prev - churned + gross)
        cost = subs * p["fee_per_sub"] + (a["homepass"] * p["upfront_per_hp"] if age == 0 else 0)
        monthly.append(dict(area_id=a["id"], month=m.date().isoformat(), age_m=age, active_subs=subs, gross_adds=gross,
                            churned=churned, revenue=round(subs * arpu), partner_cost=round(cost)))
        subs_prev = subs
    # per-cell observation at month 12 (as if subscriber addresses were geocoded) for model training
    age_now = (AS_OF.year - a["rfs_date"].year) * 12 + AS_OF.month - a["rfs_date"].month
    if age_now >= 12:
        for i in sub.index:
            lci = math.log(cells.cap_true[i] / (1 - cells.cap_true[i])) + p["q"] + (lc - math.log(a["cap_area"] / (1 - a["cap_area"])) - p["q"])
            obs = (1 / (1 + math.exp(-lci))) * (1 - math.exp(-12.5 / TAU)) + rng.normal(0, 0.012)
            train.append(dict(h3=cells.h3[i], area_id=a["id"], partner_id=a["partner_id"], takeup_m12=max(0.0, obs)))

print(f"areas {len(areas)}  monthly rows {len(monthly)}  train rows {len(train)}")

# ------------------------------------------------------------------ write
cells_out = []
for r in cells.itertuples():
    ring = [[lng, lat] for lat, lng in h3.cell_to_boundary(r.h3)]
    ring.append(ring[0])
    cells_out.append(dict(h3=r.h3, kota=r.kota, geom={"type": "Polygon", "coordinates": [ring]},
                          lat=r.lat, lng=r.lng, buildings=r.buildings, homepass_est=r.homepass_est,
                          footprint_m2=round(r.footprint_m2, 1), mdu_share=round(r.mdu_share, 4),
                          dist_cbd_km=round(r.dist_cbd_km, 2), competitors=int(r.competitors),
                          covered_area_id=r.covered_area_id))
json.dump(cells_out, open(f"{OUT}/cells.json", "w"))
json.dump([{k: v for k, v in p.items() if k not in ("q", "home")} for p in partners], open(f"{OUT}/partners.json", "w"))
json.dump([{k: (v.isoformat() if k == "rfs_date" else v) for k, v in a.items() if k not in ("cells", "cap_area")} for a in areas],
          open(f"{OUT}/areas.json", "w"))
json.dump(monthly, open(f"{OUT}/monthly.json", "w"))
cells[["h3", "buildings", "homepass_est", "footprint_m2", "mdu_share", "dist_cbd_km", "competitors", "avg_bldg_m2",
       "density", "cap_true"]].to_parquet(f"{OUT}/features.parquet")
pd.DataFrame(train).to_parquet(f"{OUT}/train.parquet")
