"""Train the take-up model and score every uncovered H3 cell for RFS.

Model: LightGBM regression of month-12 take-up on market features only (no partner: a candidate cell
has no partner yet). Validation uses GroupKFold by RFS area, because cells of one area share the same
partner/launch shock and would leak across a random split. SHAP values come from LightGBM's own
TreeSHAP (pred_contrib=True).

Economics per candidate cell (typical capex-share partner): pay upfront per home-pass, earn ARPU minus
the partner fee per active subscriber, with take-up ramping like the observed curve.
Outputs: scripts/data/seed/scores.json, scripts/data/seed/model_run.json
"""
import json, math
import lightgbm as lgb, numpy as np, pandas as pd
from sklearn.model_selection import GroupKFold
from sklearn.metrics import mean_absolute_error, r2_score

S = "scripts/data/seed"
FEATURES = {
    "homepass_log": "Home-passes (log)",
    "avg_bldg_m2": "Avg building size",
    "density": "Building density",
    "mdu_share": "MDU / high-rise share",
    "dist_cbd_km": "Distance to CBD",
    "competitors": "Competing fiber brands",
}
TAU = 7.0          # ramp constant fitted from the cohort curves (see profitability module)
ARPU, FEE, UPFRONT, SAC = 255000, 100000, 400000, 650000   # SAC: modem + install + commission per new sub

f = pd.read_parquet(f"{S}/features.parquet")
f["homepass_log"] = np.log1p(f.homepass_est)
t = pd.read_parquet(f"{S}/train.parquet").merge(f, on="h3")
X, y, groups = t[list(FEATURES)], t.takeup_m12, t.area_id

params = dict(objective="regression", learning_rate=0.05, num_leaves=15, min_data_in_leaf=20,
              feature_fraction=0.9, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, seed=7)
oof = np.zeros(len(t))
for tr, va in GroupKFold(n_splits=5).split(X, y, groups):
    m = lgb.train(params, lgb.Dataset(X.iloc[tr], y.iloc[tr]), num_boost_round=400)
    oof[va] = m.predict(X.iloc[va])
metrics = dict(
    n_train=int(len(t)), n_areas=int(groups.nunique()), cv="GroupKFold(5) by RFS area",
    mae=round(float(mean_absolute_error(y, oof)), 4), r2=round(float(r2_score(y, oof)), 3),
    mae_baseline=round(float(mean_absolute_error(y, np.full(len(y), y.mean()))), 4),
)
metrics["mae_lift_vs_mean"] = round(1 - metrics["mae"] / metrics["mae_baseline"], 3)
print(metrics)

model = lgb.train(params, lgb.Dataset(X, y), num_boost_round=400)
imp = model.feature_importance("gain")
importance = sorted(({"feature": k, "label": FEATURES[k], "gain": round(float(g) / imp.sum(), 4)}
                     for k, g in zip(FEATURES, imp)), key=lambda d: -d["gain"])

Xa = f[list(FEATURES)]
pred = model.predict(Xa).clip(0.005, 0.6)
contrib = model.predict(Xa, pred_contrib=True)      # last column = expected value
ramp = lambda m: 1 - math.exp(-(m + 0.5) / TAU)
k24 = ramp(23) / ramp(11.5)

def payback(hp, takeup12):
    cap = takeup12 / ramp(11.5)
    cum, prev = -hp * UPFRONT, 0.0
    for m in range(120):
        subs = hp * cap * ramp(m)
        cum += subs * (ARPU - FEE) - max(0.0, subs - prev) * SAC
        prev = subs
        if cum >= 0:
            return m + 1
    return None

out = []
for i, r in f.iterrows():
    pb = payback(r.homepass_est, pred[i])
    m24 = float(min(pred[i] * k24, 0.75))
    drivers = sorted(({"f": k, "label": FEATURES[k], "v": round(float(contrib[i][j]), 4), "x": round(float(Xa.iloc[i][k]), 3)}
                      for j, k in enumerate(FEATURES)), key=lambda d: -abs(d["v"]))
    # 5-year margin per cell, IDR millions -> score
    subs60 = [r.homepass_est * (pred[i] / ramp(11.5)) * ramp(m) for m in range(60)]
    five_y = sum(s * (ARPU - FEE) for s in subs60) - subs60[-1] * SAC - r.homepass_est * UPFRONT
    out.append(dict(h3=r.h3, pred_takeup_m12=round(float(pred[i]), 4), pred_takeup_m24=round(m24, 4),
                    payback_months=pb, value_5y_m=round(five_y / 1e6, 1), drivers=drivers[:6],
                    base=round(float(contrib[i][-1]), 4), homepass=int(r.homepass_est)))

# recommendation: fiber where it pays back within 30 months at scale; HiFi Air (FWA, no fiber capex)
# where demand exists but the build does not pay; otherwise hold
for o in out:
    if o["payback_months"] is not None and o["payback_months"] <= 30 and o["homepass"] >= 250:
        o["rfs_reco"] = "build"
    elif o["pred_takeup_m12"] >= 0.07:
        o["rfs_reco"] = "fwa"
    else:
        o["rfs_reco"] = "hold"
vals = pd.Series([o["value_5y_m"] for o in out])
ranks = vals.rank(pct=True)
for o, rk in zip(out, ranks):
    o["rfs_score"] = round(float(rk) * 100, 1)

truth_corr = float(np.corrcoef(pred, f.cap_true)[0, 1])
metrics["corr_with_true_ceiling"] = round(truth_corr, 3)
json.dump(out, open(f"{S}/scores.json", "w"))
json.dump(dict(model="LightGBM 4 (gbdt, 400 rounds, 15 leaves)", target="take-up at month 12",
               metrics=metrics, importance=importance,
               notes="Trained on synthetic subscriber outcomes generated over real building data. "
                     "corr_with_true_ceiling compares predictions to the hidden generating ceiling."),
          open(f"{S}/model_run.json", "w"), indent=1)
print("scored", len(out), "reco", pd.Series([o["rfs_reco"] for o in out]).value_counts().to_dict())
