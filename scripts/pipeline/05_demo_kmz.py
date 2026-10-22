"""Write two demo partner KMZ submissions (public/samples/) for the Boundary Hygiene module.
Mostly plausible new rollout polygons on uncovered cells, with planted defects so every class shows up:
registry overlap, in-file overlap, containment, duplicate, bow-tie (self-intersection), sliver, touch.
"""
import json, math, zipfile
from xml.sax.saxutils import escape
import h3, numpy as np
from shapely.affinity import scale, translate
from shapely.geometry import Polygon, shape, mapping
from shapely.ops import unary_union

rng = np.random.default_rng(42)
S = "scripts/data/seed"
cells = {c["h3"]: c for c in json.load(open(f"{S}/cells.json"))}
for c in cells.values():                       # NaN (pandas) => None
    if c["covered_area_id"] != c["covered_area_id"]:
        c["covered_area_id"] = None
areas = json.load(open(f"{S}/areas.json"))
SHORT = {"Kota Jakarta Pusat": "JKP", "Kota Jakarta Selatan": "JKS", "Kota Jakarta Barat": "JKB", "Kota Jakarta Timur": "JKT",
         "Kota Jakarta Utara": "JKU", "Kota Depok": "DPK", "Kota Tangerang": "TNG", "Kota Tangerang Selatan": "TSL", "Kota Bekasi": "BKS"}

def hexpoly(h):
    return Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(h)])

used = set()        # cells consumed or blocked (keeps planted defects from colliding by accident)
free = lambda h: h in cells and cells[h]["covered_area_id"] is None and h not in used

def block(group):
    for h in group:
        used.update(h3.grid_disk(h, 1))

def isolated(h):     # free, and no neighbour is covered or already used => polygon stays clean
    return free(h) and all(x not in cells or (cells[x]["covered_area_id"] is None and x not in used)
                           for x in h3.grid_ring(h, 1))

def grow(seed, n, ok):
    grp = [seed]
    while len(grp) < n:
        nb = [x for g in grp for x in h3.grid_ring(g, 1) if ok(x) and x not in grp]
        if not nb:
            break
        grp.append(nb[int(rng.integers(len(nb)))])
    return grp

def pick_group(n, kotas=None, near_registry=False):
    ok = free if near_registry else isolated
    seeds = [h for h in cells if ok(h) and (kotas is None or cells[h]["kota"] in kotas)]
    if near_registry:   # touches an existing RFS area
        seeds = [h for h in seeds if any(x in cells and cells[x]["covered_area_id"] for x in h3.grid_ring(h, 1))]
    rng.shuffle(seeds)
    for s in seeds:
        g = grow(s, n, ok)
        if len(g) == n:
            return g
    if kotas is not None:       # preferred kota is full: take room anywhere
        return pick_group(n, None, near_registry)
    raise RuntimeError("no room")

def union(group):
    return unary_union([hexpoly(h) for h in group])

def ring_coords(poly):
    if poly.geom_type == "MultiPolygon":       # non-contiguous half of a group: keep the largest piece
        poly = max(poly.geoms, key=lambda q: q.area)
    return [[round(x, 7), round(y, 7)] for x, y in poly.exterior.coords]

def feature(name, kota, coords_rings, homepass_claim):
    return dict(name=name, kota=kota, rings=coords_rings, claim=homepass_claim)

def hp(group):
    return int(sum(cells[h]["homepass_est"] for h in group) * rng.uniform(1.0, 1.25))   # partners round up

def build(code, kotas, plan):
    feats, n = [], 0
    def nm(kota, suffix=""):
        nonlocal n
        n += 1
        return f"{code}-{SHORT[kota]}-Q4-{n:02d}{suffix}"
    for kind, count in plan:
        for _ in range(count):
            if kind == "clean":
                g = pick_group(int(rng.integers(2, 5)), kotas); block(g); k = cells[g[0]]["kota"]
                feats.append(feature(nm(k), k, [ring_coords(union(g).simplify(0))], hp(g)))
            elif kind == "registry":      # new polygon spills ~90 m into an existing RFS area
                g = pick_group(2, kotas, near_registry=True); block(g); k = cells[g[0]]["kota"]
                p = union(g).buffer(0.0008, join_style=2).simplify(0.00003)
                feats.append(feature(nm(k), k, [ring_coords(p)], hp(g)))
            elif kind == "overlap":       # two polygons in the same file overlapping each other
                g = pick_group(4, kotas); block(g); k = cells[g[0]]["kota"]
                a, b = union(g[:2]), union(g[2:]).buffer(0.0009, join_style=2).simplify(0.00003)
                feats.append(feature(nm(k), k, [ring_coords(a)], hp(g[:2])))
                feats.append(feature(nm(k), k, [ring_coords(b)], hp(g[2:])))
            elif kind == "contains":      # a small polygon fully inside a bigger one
                g = pick_group(3, kotas); block(g); k = cells[g[0]]["kota"]
                big = union(g); small = scale(hexpoly(g[1]), 0.45, 0.45)
                feats.append(feature(nm(k), k, [ring_coords(big)], hp(g)))
                feats.append(feature(nm(k, " (phase 2)"), k, [ring_coords(small)], int(hp([g[1]]) * 0.3)))
            elif kind == "duplicate":     # same polygon submitted twice under two names
                g = pick_group(2, kotas); block(g); k = cells[g[0]]["kota"]
                p = ring_coords(union(g)); name = nm(k)
                feats.append(feature(name, k, [p], hp(g)))
                feats.append(feature(name + " rev", k, [p], hp(g)))
            elif kind == "bowtie":        # vertex order crossed: self-intersecting ring
                g = pick_group(1, kotas); block(g); k = cells[g[0]]["kota"]
                c = ring_coords(hexpoly(g[0]))[:-1]
                c[2], c[3] = c[3], c[2]
                feats.append(feature(nm(k), k, [c + [c[0]]], hp(g)))
            elif kind == "sliver":        # neighbours meant to touch, digitised ~0.4 m into each other
                g = pick_group(4, kotas); block(g); k = cells[g[0]]["kota"]
                a, b = union(g[:2]), union(g[2:])
                if not a.touches(b):
                    a, b = hexpoly(g[0]), hexpoly(g[1])
                dx, dy = a.centroid.x - b.centroid.x, a.centroid.y - b.centroid.y
                d = math.hypot(dx, dy)
                b = translate(b, dx / d * 0.0000036, dy / d * 0.0000036)
                feats.append(feature(nm(k), k, [ring_coords(a)], hp(g[:2])))
                feats.append(feature(nm(k), k, [ring_coords(b)], hp(g[2:])))
            elif kind == "touch":         # clean neighbours sharing an edge exactly
                g = pick_group(4, kotas); block(g); k = cells[g[0]]["kota"]
                a, b = union(g[:2]), union(g[2:])
                feats.append(feature(nm(k), k, [ring_coords(a)], hp(g[:2])))
                feats.append(feature(nm(k), k, [ring_coords(b)], hp(g[2:])))
    order = rng.permutation(len(feats))
    return [feats[i] for i in order]

def kml(title, partner, feats):
    by_kota = {}
    for f in feats:
        by_kota.setdefault(f["kota"], []).append(f)
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
           f"<name>{escape(title)}</name>",
           '<Style id="hp"><LineStyle><color>ff8c0aec</color><width>2</width></LineStyle>'
           '<PolyStyle><color>408c0aec</color></PolyStyle></Style>']
    for kota, fs in by_kota.items():
        out.append(f"<Folder><name>{escape(kota)}</name>")
        for f in fs:
            coords = " ".join(f"{x},{y},0" for x, y in f["rings"][0])
            out.append(f"<Placemark><name>{escape(f['name'])}</name><styleUrl>#hp</styleUrl>"
                       f'<ExtendedData><Data name="partner"><value>{partner}</value></Data>'
                       f'<Data name="homepass_claimed"><value>{f["claim"]}</value></Data></ExtendedData>'
                       f"<Polygon><outerBoundaryIs><LinearRing><coordinates>{coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>")
        out.append("</Folder>")
    out.append("</Document></kml>")
    return "\n".join(out)

def write(path, title, partner, feats):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("doc.kml", kml(title, partner, feats))
    print(path, len(feats), "placemarks")

south = ["Kota Jakarta Selatan", "Kota Tangerang Selatan", "Kota Depok"]
west = ["Kota Jakarta Barat", "Kota Tangerang", "Kota Jakarta Utara"]
write("public/samples/NSF_Q4-2026_rollout.kmz", "Nusa Serat Fiber - Q4 2026 rollout", "NSF",
      build("NSF", south, [("clean", 14), ("registry", 4), ("overlap", 2), ("contains", 1), ("duplicate", 1),
                           ("bowtie", 2), ("sliver", 2), ("touch", 2)]))
write("public/samples/JOP_Q4-2026_rollout.kmz", "Jaya Optik Persada - Q4 2026 rollout", "JOP",
      build("JOP", west, [("clean", 12), ("registry", 3), ("duplicate", 1), ("touch", 1), ("bowtie", 1)]))
