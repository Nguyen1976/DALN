# Link-Prediction Training Pipeline (Neo4j)

Neo4j is used here as the **single source of the training data**. The application's
real friendship data lives in **MongoDB**; Neo4j only holds the offline training
graph + labels so the link-prediction models can be trained and evaluated.

## What lives in Neo4j after running this

| Element | Meaning |
|---|---|
| `(:User {userId})` | nodes of the social graph (from the Brightkite dataset) |
| `(:User)-[:FRIEND]->(:User)` | the base friendship graph (topology used to compute features) |
| `(:User)-[:LINK {label, split}]->(:User)` | **labeled training examples** |

`LINK` labels:
- `label = 1` → **good link** (a real friendship pair)
- `label = 0` → **bad link** (a non-friend pair: mix of 2–3 hop "hard" negatives + random negatives)
- `split = 'train' | 'test'` → the 80/20 stratified split, **stored in Neo4j**

The dataset is balanced 1:1 (equal good/bad links).

## Setup

```bash
python3 -m venv training/.venv
training/.venv/bin/pip install -r training/requirements.txt
```

Neo4j must be running at `bolt://localhost:7687` (auth `neo4j` / `password123`).
The graph dataset is read from `loc-brightkite_edges (1).txt` in the repo root.

## Run

```bash
cd training
# Step 1: clean Neo4j, load Brightkite graph, sample + label links (writes to Neo4j)
../training/.venv/bin/python 1_load_and_label.py
# Step 2: read graph + labels from Neo4j, train & evaluate 5 models
../training/.venv/bin/python 2_train_eval.py
```

Step 2 prints the comparison table and writes `training/results.csv`.

## Tunable parameters (env vars)

| Var | Default | Meaning |
|---|---|---|
| `MAX_PAIRS_PER_CLASS` | `40000` | good (and equal bad) links to sample |
| `HARD_NEG_RATIO` | `0.2` | fraction of negatives that are 2–3 hop "hard" negatives |
| `NEGATIVE_HOPS` | `2,3` | hop distances for hard negatives |
| `TEST_SIZE` | `0.2` | test fraction (80/20 split) |
| `RANDOM_SEED` | `42` | reproducibility |

## Inspect the labeled data in Neo4j Browser

```cypher
// label distribution + split
MATCH ()-[r:LINK]->()
RETURN r.label AS label, r.split AS split, count(*) AS c
ORDER BY label DESC, split;

// good links (label 1)
MATCH (a:User)-[r:LINK {label:1}]->(b:User) RETURN a, r, b LIMIT 25;

// bad links (label 0)
MATCH (a:User)-[r:LINK {label:0}]->(b:User) RETURN a, r, b LIMIT 25;
```

## Methodology (mirrors the original embedding-service `train_model`)

1. Positives = real friendship edges; negatives = non-friend pairs (balanced 1:1).
2. For positive pairs the direct edge is removed before computing features (anti-leakage).
3. Graph-topology features only (Brightkite has no bio/location/group attributes):
   common neighbors, Jaccard, Adamic–Adar, resource allocation, preferential
   attachment, cosine, degrees, total neighbors — heavy-tailed ones are `log1p`-scaled.
4. 80/20 stratified split (stored in Neo4j), `StandardScaler` fit on train only.
5. Models: Logistic Regression, Random Forest, Gradient Boosting, KNN, J45/C4.5
   (DecisionTree, entropy). Metrics: F1 + ROC-AUC on train and test.
