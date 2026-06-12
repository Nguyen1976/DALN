"""Step 1 - Clean Neo4j, load the Brightkite graph, and label links (0/1) in Neo4j.

Run:  training/.venv/bin/python training/1_load_and_label.py

After this you can inspect the labeled data directly in Neo4j Browser, e.g.:
  MATCH ()-[r:LINK]->() RETURN r.label AS label, r.split AS split, count(*) ORDER BY label, split
  MATCH (a)-[r:LINK {label:1}]->(b) RETURN a,r,b LIMIT 25   // good links
  MATCH (a)-[r:LINK {label:0}]->(b) RETURN a,r,b LIMIT 25   // bad links
"""

from __future__ import annotations

import random
import sys

from pipeline_common import (
    DATASET_PATH,
    HARD_NEG_RATIO,
    MAX_PAIRS_PER_CLASS,
    NEGATIVE_HOPS,
    RANDOM_SEED,
    TEST_SIZE,
    build_adjacency,
    chunked,
    get_driver,
    load_edges_from_file,
)


def clean_database(session) -> None:
    print("Cleaning Neo4j (deleting all nodes/relationships)...")
    while True:
        deleted = session.run(
            "MATCH (n) WITH n LIMIT 20000 DETACH DELETE n RETURN count(n) AS c"
        ).single()["c"]
        if deleted == 0:
            break
    session.run("CREATE INDEX user_userId IF NOT EXISTS FOR (u:User) ON (u.userId)")
    print("  done.")


def load_friend_graph(session, edges: list[tuple[int, int]]) -> None:
    nodes = sorted({n for e in edges for n in e})
    print(f"Loading {len(nodes)} User nodes...")
    for batch in chunked(nodes, 20000):
        session.run(
            "UNWIND $ids AS id MERGE (:User {userId: id})",
            ids=batch,
        )
    print(f"Loading {len(edges)} FRIEND edges (base graph)...")
    rows = [{"a": a, "b": b} for a, b in edges]
    for i, batch in enumerate(chunked(rows, 10000)):
        session.run(
            """
            UNWIND $rows AS row
            MATCH (a:User {userId: row.a})
            MATCH (b:User {userId: row.b})
            MERGE (a)-[:FRIEND]->(b)
            """,
            rows=batch,
        )
        if (i + 1) % 5 == 0:
            print(f"  ...{(i + 1) * 10000} edges")
    print("  done.")


def sample_positives(edges, rng, n):
    pool = list(edges)
    rng.shuffle(pool)
    return pool[:n]


def _sample_one_hard(adj, nodes, rng, hops):
    """One hard negative via a short random walk (friend-of-friend, etc.)."""
    u = rng.choice(nodes)
    steps = rng.choice(hops)
    cur = u
    for _ in range(steps):
        nbrs = adj.get(cur)
        if not nbrs:
            return None
        cur = rng.choice(tuple(nbrs))
    if cur == u or cur in adj.get(u, ()):  # self / direct friend -> reject
        return None
    return (u, cur) if u < cur else (cur, u)


def _sample_one_random(adj, nodes, rng):
    """One easy negative: two random non-adjacent users."""
    u = rng.choice(nodes)
    v = rng.choice(nodes)
    if u == v or v in adj.get(u, ()):
        return None
    return (u, v) if u < v else (v, u)


def sample_negatives(adj, positive_set, rng, n, hops, hard_ratio):
    """Balanced negatives = mix of hard (2-3 hop) and random non-friend pairs."""
    nodes = [u for u in adj if adj[u]]
    n_hard = int(round(n * hard_ratio))
    negatives: set[tuple[int, int]] = set()
    attempts = 0
    max_attempts = n * 400 + 10000
    while len(negatives) < n and attempts < max_attempts:
        attempts += 1
        want_hard = len(negatives) < n_hard
        key = (
            _sample_one_hard(adj, nodes, rng, hops)
            if want_hard
            else _sample_one_random(adj, nodes, rng)
        )
        if key is None or key in positive_set or key in negatives:
            continue
        negatives.add(key)
    if len(negatives) < n:
        print(
            f"  WARNING: only sampled {len(negatives)}/{n} negatives",
            file=sys.stderr,
        )
    return list(negatives)


def assign_split(pairs, rng, test_size):
    """Stratified-by-construction: caller passes one class at a time."""
    shuffled = list(pairs)
    rng.shuffle(shuffled)
    n_test = int(round(len(shuffled) * test_size))
    test = shuffled[:n_test]
    train = shuffled[n_test:]
    return train, test


def write_links(session, rows):
    for batch in chunked(rows, 10000):
        session.run(
            """
            UNWIND $rows AS row
            MATCH (a:User {userId: row.a})
            MATCH (b:User {userId: row.b})
            CREATE (a)-[:LINK {label: row.label, split: row.split}]->(b)
            """,
            rows=batch,
        )


def main():
    rng = random.Random(RANDOM_SEED)

    print(f"Reading dataset: {DATASET_PATH}")
    edges = load_edges_from_file(DATASET_PATH)
    print(f"  unique undirected edges: {len(edges)}")
    adj = build_adjacency(edges)
    print(f"  nodes: {len(adj)}")

    positive_set = set(edges)

    n_per_class = min(MAX_PAIRS_PER_CLASS, len(edges))
    print(f"\nSampling {n_per_class} positive (good) links...")
    positives = sample_positives(edges, rng, n_per_class)

    print(
        f"Sampling {n_per_class} negative (bad) links "
        f"(hops={NEGATIVE_HOPS}, hard_ratio={HARD_NEG_RATIO})..."
    )
    negatives = sample_negatives(
        adj, positive_set, rng, n_per_class, NEGATIVE_HOPS, HARD_NEG_RATIO
    )

    # 80/20 split per class -> overall stratified
    pos_train, pos_test = assign_split(positives, rng, TEST_SIZE)
    neg_train, neg_test = assign_split(negatives, rng, TEST_SIZE)

    link_rows = []
    for (a, b) in pos_train:
        link_rows.append({"a": a, "b": b, "label": 1, "split": "train"})
    for (a, b) in pos_test:
        link_rows.append({"a": a, "b": b, "label": 1, "split": "test"})
    for (a, b) in neg_train:
        link_rows.append({"a": a, "b": b, "label": 0, "split": "train"})
    for (a, b) in neg_test:
        link_rows.append({"a": a, "b": b, "label": 0, "split": "test"})

    driver = get_driver()
    with driver.session() as session:
        clean_database(session)
        load_friend_graph(session, edges)
        print(f"\nWriting {len(link_rows)} labeled LINK relationships to Neo4j...")
        write_links(session, link_rows)

        print("\n=== Neo4j label summary (as stored) ===")
        res = session.run(
            """
            MATCH ()-[r:LINK]->()
            RETURN r.label AS label, r.split AS split, count(*) AS c
            ORDER BY label DESC, split
            """
        )
        for rec in res:
            tag = "good link (1)" if rec["label"] == 1 else "bad link  (0)"
            print(f"  {tag} | split={rec['split']:5s} | count={rec['c']}")
        totals = session.run(
            "MATCH (n:User) RETURN count(n) AS users"
        ).single()["users"]
        friends = session.run(
            "MATCH ()-[r:FRIEND]->() RETURN count(r) AS c"
        ).single()["c"]
        print(f"  base graph: {totals} users, {friends} FRIEND edges")
    driver.close()
    print("\nStep 1 complete. Labeled training data is now in Neo4j.")


if __name__ == "__main__":
    main()
