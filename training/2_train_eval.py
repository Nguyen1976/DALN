"""Step 2 - Read the labeled graph from Neo4j, train + evaluate 5 models.

Run:  training/.venv/bin/python training/2_train_eval.py

Reads the FRIEND base graph and the labeled LINK relationships (label + split)
straight out of Neo4j, computes graph-topology features for each labeled pair,
trains 5 classifiers on the 80% train split and evaluates on the 20% test split.

Models (mirroring the original embedding-service train_and_eval.py):
  - Logistic Regression (logreg)
  - Random Forest (rf)
  - Gradient Boosting (gb)
  - K-Nearest Neighbors (knn)
  - J45/C4.5  (DecisionTree, criterion='entropy')
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, roc_auc_score
from sklearn.neighbors import KNeighborsClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

import os

from pipeline_common import FEATURE_COLUMNS, RANDOM_SEED, get_driver

RESULTS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results.csv")


def read_graph(session) -> dict[int, set[int]]:
    print("Reading FRIEND base graph from Neo4j...")
    adj: dict[int, set[int]] = {}
    res = session.run("MATCH (a:User)-[:FRIEND]->(b:User) RETURN a.userId AS a, b.userId AS b")
    for rec in res:
        a, b = rec["a"], rec["b"]
        adj.setdefault(a, set()).add(b)
        adj.setdefault(b, set()).add(a)
    print(f"  nodes: {len(adj)}")
    return adj


def read_labeled_links(session):
    print("Reading labeled LINK examples from Neo4j...")
    res = session.run(
        "MATCH (a:User)-[r:LINK]->(b:User) "
        "RETURN a.userId AS a, b.userId AS b, r.label AS label, r.split AS split"
    )
    rows = [(rec["a"], rec["b"], int(rec["label"]), rec["split"]) for rec in res]
    print(f"  labeled pairs: {len(rows)}")
    return rows


def pair_features(u, v, adj, label):
    nu = set(adj.get(u, ()))
    nv = set(adj.get(v, ()))
    # anti-leakage: for real friendships drop the direct edge before computing
    if label == 1:
        nu.discard(v)
        nv.discard(u)

    common = nu & nv
    union = nu | nv
    deg_u = len(nu)
    deg_v = len(nv)

    cn = len(common)
    jaccard = cn / len(union) if union else 0.0
    cosine = cn / math.sqrt(deg_u * deg_v) if deg_u and deg_v else 0.0
    pref = deg_u * deg_v

    aa = 0.0
    ra = 0.0
    for z in common:
        dz = len(adj.get(z, ()))
        if dz > 1:
            aa += 1.0 / math.log(dz)
        if dz > 0:
            ra += 1.0 / dz

    # log1p the heavy-tailed magnitude features so linear/distance models
    # (LogReg, KNN) get a well-scaled, near-linear signal. Tree models are
    # invariant to monotonic transforms, so this never hurts them.
    log = math.log1p
    return [
        log(cn),
        jaccard,
        log(aa),
        log(ra),
        log(pref),
        cosine,
        log(deg_u),
        log(deg_v),
        log(deg_u + deg_v),
    ]


def build_matrices(rows, adj):
    print("Computing topology features for labeled pairs...")
    X_train, y_train, X_test, y_test = [], [], [], []
    for a, b, label, split in rows:
        feats = pair_features(a, b, adj, label)
        if split == "test":
            X_test.append(feats)
            y_test.append(label)
        else:
            X_train.append(feats)
            y_train.append(label)
    return (
        np.array(X_train, dtype=float),
        np.array(y_train, dtype=int),
        np.array(X_test, dtype=float),
        np.array(y_test, dtype=int),
    )


def scores(model, X, y):
    proba = model.predict_proba(X)[:, 1]
    preds = (proba >= 0.5).astype(int)
    f1 = f1_score(y, preds)
    try:
        auc = roc_auc_score(y, proba)
    except ValueError:
        auc = float("nan")
    return f1, auc


def main():
    driver = get_driver()
    with driver.session() as session:
        adj = read_graph(session)
        rows = read_labeled_links(session)
    driver.close()

    if not rows:
        raise SystemExit("No labeled LINK data in Neo4j. Run 1_load_and_label.py first.")

    X_train, y_train, X_test, y_test = build_matrices(rows, adj)
    print(
        f"  train: {len(y_train)} (pos={int(y_train.sum())}, neg={int((y_train==0).sum())})"
        f" | test: {len(y_test)} (pos={int(y_test.sum())}, neg={int((y_test==0).sum())})"
    )

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    models = {
        "Logistic Regression (logreg)": LogisticRegression(max_iter=1000),
        "Random Forest (rf)": RandomForestClassifier(
            n_estimators=100, max_depth=8, min_samples_leaf=20,
            n_jobs=-1, random_state=RANDOM_SEED,
        ),
        "Gradient Boosting (gb)": GradientBoostingClassifier(random_state=RANDOM_SEED),
        "K-Nearest Neighbors (knn)": KNeighborsClassifier(n_neighbors=5),
        "J45/C4.5": DecisionTreeClassifier(
            criterion="entropy", max_depth=8, min_samples_leaf=20,
            random_state=RANDOM_SEED,
        ),
    }

    results = []
    for name, model in models.items():
        print(f"\nTraining {name} ...")
        model.fit(X_train_s, y_train)
        tr_f1, tr_auc = scores(model, X_train_s, y_train)
        te_f1, te_auc = scores(model, X_test_s, y_test)
        results.append(
            {
                "Mô hình (Model)": name,
                "Train F1": round(tr_f1, 4),
                "Train AUC": round(tr_auc, 4),
                "Test F1": round(te_f1, 4),
                "Test AUC": round(te_auc, 4),
            }
        )

    df = pd.DataFrame(results)
    print("\n" + "=" * 78)
    print("KẾT QUẢ ĐÁNH GIÁ (80% train / 20% test)")
    print("=" * 78)
    print(df.to_string(index=False))

    df.to_csv(RESULTS_PATH, index=False)
    print(f"\nSaved -> {RESULTS_PATH}")


if __name__ == "__main__":
    main()
