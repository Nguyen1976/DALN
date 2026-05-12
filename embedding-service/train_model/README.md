# train_model

This folder contains utilities to extract features from Neo4j and train simple classifiers for friend recommendation.

Quick commands:

1. Build dataset (requires Neo4j running and credentials set via env vars):

```bash
python -m train_model.dataset
```

2. Train and evaluate models:

```bash
python -m train_model.train_and_eval
```

Environment variables:

- `NEO4J_URI` (default `bolt://localhost:7687`)
- `NEO4J_USER` (default `neo4j`)
- `NEO4J_PASSWORD` (default `password123`)

Dependencies: see `requirements.txt`.
