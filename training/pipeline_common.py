"""Shared config + helpers for the Neo4j link-prediction training pipeline.

Neo4j is used as the single source of the *training data*:
  - (:User {userId})                         -> nodes of the social graph
  - (:User)-[:FRIEND]->(:User)               -> the base friendship graph (topology)
  - (:User)-[:LINK {label, split}]->(:User)  -> labeled examples used for training
        label = 1 -> "good link"  (a real friendship pair)
        label = 0 -> "bad link"   (a hard-negative non-friend pair, 2-3 hops away)
        split = 'train' | 'test'   (80/20 stratified split, stored in Neo4j)

The application's real friendship data lives in MongoDB; Neo4j here only holds
the offline training graph + labels so the models can be trained/evaluated.
"""

from __future__ import annotations

import os
from pathlib import Path

from neo4j import GraphDatabase

# --- Neo4j connection (auth: neo4j / password123) ---------------------------
NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "password123")

# --- Pipeline parameters (override via env) ---------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
DATASET_PATH = os.environ.get(
    "DATASET_PATH", str(REPO_ROOT / "loc-brightkite_edges (1).txt")
)
# How many positive (and equal negative) labeled links to sample.
MAX_PAIRS_PER_CLASS = int(os.environ.get("MAX_PAIRS_PER_CLASS", "40000"))
RANDOM_SEED = int(os.environ.get("RANDOM_SEED", "42"))
TEST_SIZE = float(os.environ.get("TEST_SIZE", "0.2"))
# Hard-negative hop distances (friend-of-friend = 2, etc.)
NEGATIVE_HOPS = [int(h) for h in os.environ.get("NEGATIVE_HOPS", "2,3").split(",")]
# Fraction of negatives that are "hard" (2-3 hop). The rest are random
# non-friend pairs ("easy" negatives). A mix keeps the task balanced and
# realistic instead of trivially easy or impossibly hard.
HARD_NEG_RATIO = float(os.environ.get("HARD_NEG_RATIO", "0.2"))

# Feature columns used by every model (pure graph topology, since the
# Brightkite dataset only has edges -- no bio/location/group attributes).
FEATURE_COLUMNS = [
    "common_neighbors",
    "jaccard",
    "adamic_adar",
    "resource_alloc",
    "pref_attach",
    "cosine_graph",
    "deg_u",
    "deg_v",
    "total_neighbors",
]


def get_driver():
    return GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))


def load_edges_from_file(path: str) -> list[tuple[int, int]]:
    """Read a tab/space separated edge list; return unique undirected edges (u < v)."""
    seen: set[tuple[int, int]] = set()
    with open(path, "r") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.replace("\t", " ").split()
            if len(parts) < 2:
                continue
            try:
                a, b = int(parts[0]), int(parts[1])
            except ValueError:
                continue
            if a == b:
                continue
            key = (a, b) if a < b else (b, a)
            seen.add(key)
    return list(seen)


def build_adjacency(edges: list[tuple[int, int]]) -> dict[int, set[int]]:
    adj: dict[int, set[int]] = {}
    for a, b in edges:
        adj.setdefault(a, set()).add(b)
        adj.setdefault(b, set()).add(a)
    return adj


def chunked(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i : i + size]
