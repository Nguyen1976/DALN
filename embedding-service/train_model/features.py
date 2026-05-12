import math
import numpy as np
from collections import defaultdict


def jaccard(neigh_u, neigh_v):
    if not neigh_u and not neigh_v:
        return 0.0
    inter = len(neigh_u & neigh_v)
    union = len(neigh_u | neigh_v)
    return inter / union if union > 0 else 0.0


def cosine_graph(neigh_u, neigh_v):
    inter = len(neigh_u & neigh_v)
    denom = math.sqrt(len(neigh_u) * len(neigh_v))
    return inter / denom if denom > 0 else 0.0


def adamic_adar(neigh_u, neigh_v, degrees):
    common = neigh_u & neigh_v
    s = 0.0
    for z in common:
        deg = degrees.get(z, 1)
        if deg > 1:
            s += 1.0 / math.log(deg)
    return s


def preferential_attachment(neigh_u, neigh_v):
    return len(neigh_u) * len(neigh_v)


def degree(neigh):
    return len(neigh)


def haversine(lat1, lon1, lat2, lon2):
    # meters -> km
    R = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c


def distance_bucket(km):
    # buckets: 0-1, 1-5, 5-20, 20-100, 100+
    if km <= 1:
        return 0
    if km <= 5:
        return 1
    if km <= 20:
        return 2
    if km <= 100:
        return 3
    return 4


def bio_cosine(a, b):
    a = np.array(a, dtype=float)
    b = np.array(b, dtype=float)
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / denom) if denom > 0 else 0.0


def bio_dot(a, b):
    a = np.array(a, dtype=float)
    b = np.array(b, dtype=float)
    return float(np.dot(a, b))


def bio_l2(a, b):
    a = np.array(a, dtype=float)
    b = np.array(b, dtype=float)
    return float(np.linalg.norm(a - b))
