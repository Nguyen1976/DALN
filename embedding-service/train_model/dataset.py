import random

import networkx as nx
import numpy as np
import pandas as pd
from tqdm import tqdm

from .data_fetch import get_driver, fetch_friend_edges, fetch_users, fetch_user_groups
from .features import (
    adamic_adar,
    bio_cosine,
    bio_dot,
    bio_l2,
    cosine_graph,
    degree,
    distance_bucket,
    haversine,
    jaccard,
    preferential_attachment,
)


def build_neighbor_dict(edges_df):
    neigh = {}
    for u in pd.concat([edges_df['user1'], edges_df['user2']]).unique():
        neigh[u] = set()
    for _, r in edges_df.iterrows():
        neigh.setdefault(r.user1, set()).add(r.user2)
        neigh.setdefault(r.user2, set()).add(r.user1)
    return neigh


def build_component_map(graph):
    component_map = {}
    for component_id, nodes in enumerate(nx.connected_components(graph)):
        for node in nodes:
            component_map[node] = component_id
    return component_map


def candidate_negative_pairs(graph, positive_set, hop_targets=(2, 3)):
    candidates = set()
    for source in graph.nodes:
        if source not in graph:
            continue
        for target, path_length in nx.single_source_shortest_path_length(graph, source, cutoff=max(hop_targets)).items():
            if source >= target:
                continue
            if path_length in hop_targets:
                key = (min(source, target), max(source, target))
                if key not in positive_set:
                    candidates.add(key)
    return candidates


def create_pairs_and_features(
    output_csv='dataset.csv',
    negative_ratio=1,
    random_seed=42,
    total_groups=200,
    negative_mode='hard',
    hard_negative_hops=(2, 3),
):
    driver = get_driver()

    edges = fetch_friend_edges(driver)
    users = fetch_users(driver)
    groups = fetch_user_groups(driver)

    if edges.empty:
        raise RuntimeError('No friend edges found in Neo4j')

    # build neighbor dict and degrees
    neigh = build_neighbor_dict(edges)
    degrees = {u: len(neigh[u]) for u in neigh}

    # build networkx graph for shortest path / WCC
    G = nx.Graph()
    G.add_nodes_from(list(neigh.keys()))
    for u, nbrs in neigh.items():
        for v in nbrs:
            G.add_edge(u, v)

    component_map = build_component_map(G)

    users_map = users.set_index('user_id').to_dict(orient='index') if not users.empty else {}

    # fallback: if groups missing from Neo4j, we'll create random groups per user
    groups_map = {}
    if not groups.empty:
        for r in groups.to_dict(orient='records'):
            groups_map[r['user_id']] = set(r.get('groups') or [])

    rng = random.Random(random_seed)
    np_rng = np.random.RandomState(random_seed)

    # ensure we have a list of all users to sample negatives from
    all_users = list(users_map.keys()) if users_map else list({*edges.user1.unique(), *edges.user2.unique()})

    # ensure every user has at least an entry in users_map (with possible empty fields)
    for u in all_users:
        if u not in users_map:
            users_map[u] = {}

    # make positive pairs unique unordered
    positive_pairs_set = set()
    for _, r in edges.iterrows():
        a = int(r.user1)
        b = int(r.user2)
        if a == b:
            continue
        key = (min(a, b), max(a, b))
        positive_pairs_set.add(key)
    positive_pairs = list(positive_pairs_set)

    # sample negatives
    negatives = set()
    positives_set = set((min(a, b), max(a, b)) for a, b in positive_pairs)
    target_negative_count = len(positive_pairs) * negative_ratio
    rng = random.Random(random_seed)

    if negative_mode == 'hard':
        hard_candidates = candidate_negative_pairs(G, positives_set, hop_targets=hard_negative_hops)
        if hard_candidates:
            negatives.update(rng.sample(list(hard_candidates), min(target_negative_count, len(hard_candidates))))

    attempts = 0
    max_attempts = max(target_negative_count * 200, 1000)
    while len(negatives) < target_negative_count and attempts < max_attempts:
        attempts += 1
        a, b = rng.sample(all_users, 2)
        key = (min(a, b), max(a, b))
        if key in positives_set or key in negatives:
            continue

        # prefer negatives from the same component when possible to avoid trivial WCC leakage
        if negative_mode == 'hard':
            if component_map.get(a) != component_map.get(b):
                continue

            # keep them non-adjacent and not direct friends
            if b in neigh.get(a, set()):
                continue

            # optionally keep them as 2-hop/3-hop pairs when the graph can support it
            try:
                hop = nx.shortest_path_length(G, source=a, target=b)
            except Exception:
                hop = -1
            if hop not in hard_negative_hops:
                continue

        negatives.add(key)

    if len(negatives) < target_negative_count:
        print(f"Warning: only sampled {len(negatives)} negatives out of {target_negative_count} requested")

    records = []

    def safe_get_user(u):
        return users_map.get(u, {})

    # helper to compute pair features
    def compute_features(u, v, label):
        # for positive pairs, remove direct edge to avoid leakage
        # (compute features as if they were not yet friends)
        neigh_u = set(neigh.get(u, set()))
        neigh_v = set(neigh.get(v, set()))
        
        if label == 1:  # positive pair
            neigh_u.discard(v)
            neigh_v.discard(u)
        
        # recompute degrees for current neighbor sets
        deg_u = degree(neigh_u)
        deg_v = degree(neigh_v)
        
        # for adamic-adar, use effective degrees from neighbor sets
        degrees_eff = degrees.copy()
        for node in set(list(neigh_u) + list(neigh_v)):
            degrees_eff[node] = len(neigh.get(node, set()))
            if label == 1:
                # if this node is connected to u or v, discount by 1
                if u in neigh.get(node, set()):
                    degrees_eff[node] = max(1, degrees_eff[node] - 1)
                if v in neigh.get(node, set()):
                    degrees_eff[node] = max(1, degrees_eff[node] - 1)
        
        j = jaccard(neigh_u, neigh_v)
        c = cosine_graph(neigh_u, neigh_v)
        aa = adamic_adar(neigh_u, neigh_v, degrees_eff)
        pa = preferential_attachment(neigh_u, neigh_v)

        # shortest path and connectivity: guard if nodes missing
        # for positive pairs, temporarily remove direct edge
        if label == 1 and (u in G.nodes) and (v in G.nodes):
            # create a copy and remove edge
            G_temp = G.copy()
            if G_temp.has_edge(u, v):
                G_temp.remove_edge(u, v)
            try:
                sp = nx.shortest_path_length(G_temp, source=u, target=v)
            except Exception:
                sp = -1
            try:
                wcc = 1 if nx.has_path(G_temp, u, v) else 0
            except Exception:
                wcc = 0
        elif (u in G.nodes) and (v in G.nodes):
            try:
                sp = nx.shortest_path_length(G, source=u, target=v)
            except Exception:
                sp = -1
            try:
                wcc = 1 if nx.has_path(G, u, v) else 0
            except Exception:
                wcc = 0
        else:
            sp = -1
            wcc = 0

        uinfo = safe_get_user(u)
        vinfo = safe_get_user(v)

        lat_u = uinfo.get('lat', np.nan)
        lon_u = uinfo.get('lon', np.nan)
        lat_v = vinfo.get('lat', np.nan)
        lon_v = vinfo.get('lon', np.nan)

        # safe numeric checks: use pandas isna to handle various types
        if not pd.isna(lat_u) and not pd.isna(lat_v) and not pd.isna(lon_u) and not pd.isna(lon_v):
            try:
                lat_u_f = float(lat_u)
                lon_u_f = float(lon_u)
                lat_v_f = float(lat_v)
                lon_v_f = float(lon_v)
                dist_km = haversine(lat_u_f, lon_u_f, lat_v_f, lon_v_f)
            except Exception:
                dist_km = np.nan
        else:
            dist_km = np.nan

        bucket = distance_bucket(dist_km) if not pd.isna(dist_km) else -1

        bio_u = uinfo.get('bio') if uinfo else None
        bio_v = vinfo.get('bio') if vinfo else None
        bio_cos = bio_dot_p = bio_l2_p = np.nan
        same_cluster = 0

        # fallback: generate random bio vector if missing
        if bio_u is None:
            bio_u = list(np_rng.normal(size=128))
            uinfo['bio'] = bio_u
        if bio_v is None:
            bio_v = list(np_rng.normal(size=128))
            vinfo['bio'] = bio_v

        try:
            bio_cos = bio_cosine(bio_u, bio_v)
            bio_dot_p = bio_dot(bio_u, bio_v)
            bio_l2_p = bio_l2(bio_u, bio_v)
        except Exception:
            bio_cos = bio_dot_p = bio_l2_p = np.nan

        # cluster fallback: random cluster if missing
        if 'cluster' not in uinfo or uinfo.get('cluster') is None:
            uinfo['cluster'] = int(np_rng.randint(0, 100))
        if 'cluster' not in vinfo or vinfo.get('cluster') is None:
            vinfo['cluster'] = int(np_rng.randint(0, 100))
        if uinfo['cluster'] == vinfo['cluster']:
            same_cluster = 1

        groups_u = groups_map.get(u, set())
        groups_v = groups_map.get(v, set())
        # fallback: if groups not present for users, create random small sets
        if not groups_u:
            k = rng.randint(0, 5)
            groups_u = set([f"g{rng.randint(0, total_groups-1)}" for _ in range(k)])
            groups_map[u] = groups_u
        if not groups_v:
            k = rng.randint(0, 5)
            groups_v = set([f"g{rng.randint(0, total_groups-1)}" for _ in range(k)])
            groups_map[v] = groups_v
        group_inter = len(groups_u & groups_v)
        group_jaccard = group_inter / len(groups_u | groups_v) if len(groups_u | groups_v) > 0 else 0
        same_group_flag = 1 if group_inter > 0 else 0

        return {
            'u': u,
            'v': v,
            'label': label,
            'jaccard': j,
            'cosine_graph': c,
            'adamic_adar': aa,
            'pref_attach': pa,
            'deg_u': deg_u,
            'deg_v': deg_v,
            'shortest_path': sp,
            'wcc': wcc,
            'dist_km': dist_km,
            'dist_bucket': bucket,
            'bio_cosine': bio_cos,
            'bio_dot': bio_dot_p,
            'bio_l2': bio_l2_p,
            'same_cluster': same_cluster,
            'group_inter': group_inter,
            'group_jaccard': group_jaccard,
            'same_group': same_group_flag
        }

    # positives
    for u, v in tqdm(positive_pairs, desc='positives'):
        records.append(compute_features(u, v, 1))

    # negatives
    for u, v in tqdm(list(negatives), desc='negatives'):
        records.append(compute_features(u, v, 0))

    df = pd.DataFrame(records)
    df.to_csv(output_csv, index=False)
    print(f"Saved dataset to {output_csv}")
    return df


if __name__ == '__main__':
    create_pairs_and_features()
