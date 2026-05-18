# train_model

This folder contains utilities to extract features from Neo4j and train simple classifiers for friend recommendation.

Quick commands:

1. Build dataset (requires Neo4j running and credentials set via env vars):

```bash
python -m train_model.dataset
```

2. Train and evaluate models (default uses safe features):

```bash
python -m train_model.train_and_eval  # safe mode (logreg, rf, gb, knn, svm)

# full mode (all 17 features + shortest_path + wcc):
# python -c "from train_model.train_and_eval import train_and_report; train_and_report(feature_mode='full')"
```

Current model set in `train_and_eval` / `train_fast`:

- `logreg`
- `rf` (Random Forest)
- `j45` (DecisionTreeClassifier with `criterion='entropy'`, used as a J45/C4.5-style tree)
- `gb` (Gradient Boosting)
- `knn`

Environment variables:

- `NEO4J_URI` (default `bolt://localhost:7687`)
- `NEO4J_USER` (default `neo4j`)
- `NEO4J_PASSWORD` (default `password123`)

Dependencies: see `train_model/requirements.txt` (training). Runtime API deps: `../requirements.txt` in repo root of `embedding-service/`.

## HTTP runtime (backend contract)

Production FastAPI only exposes **`POST /embed-and-save`** and **`POST /recommend/rank`** (GB ranker).  
See **[`../CONTRACT.md`](../CONTRACT.md)** and run `python embedding-service/scripts/check_backend_contract.py` from repo root.

Inference uses **`train_model/models/gb.joblib`** — train with this package so that file exists before calling `/recommend/rank`.

## Feature Modes

- **safe** (default, 15 features): removes `shortest_path` and `wcc` to reduce leakage
- **full** (17 features): includes all graph features, may overfit

## Output

- `dataset.csv`: 394k pairs with 20 feature columns
- `feature_importances.csv`: RF and GB feature weights (after training)
- `train_model/models/`: saved joblib files for each trained model
