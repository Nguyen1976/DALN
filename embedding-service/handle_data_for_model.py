import pandas as pd
import networkx as nx
from collections import Counter
from math import radians, sin, cos, sqrt, atan2

# =========================================================
# BRIGHTKITE DATASET PROCESSING
# =========================================================

# Files:
# - loc-brightkite_edges.txt
# - loc-brightkite_totalCheckins.txt

# =========================================================
# 1. LOAD DATA
# =========================================================

print("========== LOADING DATA ==========")

# Friendship graph
edges = pd.read_csv(
    "loc-brightkite_edges.txt",
    sep="\t",
    header=None,
    names=["user1", "user2"]
)

print("Edges loaded!")
print(edges.head())

# Checkins
checkins = pd.read_csv(
    "loc-brightkite_totalCheckins.txt",
    sep="\t",
    header=None,
    names=[
        "user",
        "time",
        "lat",
        "lon",
        "location_id"
    ]
)

print("\nCheckins loaded!")
print(checkins.head())

# =========================================================
# 2. PREPROCESSING
# =========================================================

print("\n========== PREPROCESSING ==========")

checkins["time"] = pd.to_datetime(checkins["time"])

checkins["location_id"] = (
    checkins["location_id"].astype(str)
)

print("Datetime converted!")

# =========================================================
# 3. BUILD SOCIAL GRAPH
# =========================================================

print("\n========== BUILDING GRAPH ==========")

G = nx.from_pandas_edgelist(
    edges,
    source="user1",
    target="user2"
)

print("Graph created!")

# =========================================================
# 4. GRAPH STATISTICS
# =========================================================

print("\n========== GRAPH STATS ==========")

print("Nodes:", G.number_of_nodes())
print("Edges:", G.number_of_edges())

avg_degree = sum(dict(G.degree()).values()) / G.number_of_nodes()

print("Average degree:", round(avg_degree, 2))

# Largest connected component
largest_cc = max(nx.connected_components(G), key=len)

print("Largest CC size:", len(largest_cc))

# =========================================================
# 5. TOP USERS
# =========================================================

print("\n========== TOP ACTIVE USERS ==========")

top_users = (
    checkins["user"]
    .value_counts()
    .head(10)
)

print(top_users)

# =========================================================
# 6. TOP LOCATIONS
# =========================================================

print("\n========== HOT LOCATIONS ==========")

top_locations = (
    checkins["location_id"]
    .value_counts()
    .head(10)
)

print(top_locations)

# =========================================================
# 7. USER CHECKINS
# =========================================================

def get_user_checkins(user_id, limit=10):

    user_data = checkins[
        checkins["user"] == user_id
    ]

    user_data = user_data.sort_values(
        "time",
        ascending=False
    )

    return user_data.head(limit)

print("\n========== USER CHECKINS ==========")

print(get_user_checkins(58186))

# =========================================================
# 8. GET USER FRIENDS
# =========================================================

def get_friends(user_id):

    if user_id not in G:
        return []

    return list(G.neighbors(user_id))

print("\n========== USER FRIENDS ==========")

friends = get_friends(58186)

print("Friend count:", len(friends))
print(friends[:20])

# =========================================================
# 9. USER SUMMARY
# =========================================================

def user_summary(user_id):

    if user_id not in G:
        return None

    friend_count = len(get_friends(user_id))

    user_checkins = checkins[
        checkins["user"] == user_id
    ]

    total_checkins = len(user_checkins)

    unique_locations = len(
        user_checkins["location_id"].unique()
    )

    return {
        "user_id": user_id,
        "friend_count": friend_count,
        "total_checkins": total_checkins,
        "unique_locations": unique_locations
    }

print("\n========== USER SUMMARY ==========")

print(user_summary(58186))

# =========================================================
# 10. LOCATION RECOMMENDATION
# =========================================================

def recommend_locations(user_id, topk=10):

    if user_id not in G:
        return []

    friends = list(G.neighbors(user_id))

    user_locations = set(
        checkins[
            checkins["user"] == user_id
        ]["location_id"]
    )

    friend_checkins = checkins[
        checkins["user"].isin(friends)
    ]

    location_scores = (
        friend_checkins["location_id"]
        .value_counts()
    )

    recommendations = []

    for loc_id, score in location_scores.items():

        if loc_id not in user_locations:

            recommendations.append({
                "location_id": loc_id,
                "score": int(score)
            })

        if len(recommendations) >= topk:
            break

    return recommendations

print("\n========== LOCATION RECOMMENDATIONS ==========")

recs = recommend_locations(58186)

for r in recs:
    print(r)

# =========================================================
# 11. FRIEND RECOMMENDATION
# =========================================================

def recommend_friends(user_id, topk=10):

    if user_id not in G:
        return []

    direct_friends = set(G.neighbors(user_id))

    scores = Counter()

    for friend in direct_friends:

        second_degree = set(G.neighbors(friend))

        for candidate in second_degree:

            if (
                candidate != user_id and
                candidate not in direct_friends
            ):
                scores[candidate] += 1

    return scores.most_common(topk)

print("\n========== FRIEND RECOMMENDATIONS ==========")

friend_recs = recommend_friends(58186)

print(friend_recs)

# =========================================================
# 12. USER-LOCATION BIPARTITE GRAPH
# =========================================================

print("\n========== BUILD USER-LOCATION GRAPH ==========")

B = nx.Graph()

sample_checkins = checkins.head(100000)

for row in sample_checkins.itertuples():

    user_node = f"user_{row.user}"
    location_node = f"loc_{row.location_id}"

    B.add_node(user_node, type="user")
    B.add_node(location_node, type="location")

    B.add_edge(user_node, location_node)

print("Bipartite graph created!")

print("Nodes:", B.number_of_nodes())
print("Edges:", B.number_of_edges())

# =========================================================
# 13. DISTANCE BETWEEN TWO CHECKINS
# =========================================================

def haversine(lat1, lon1, lat2, lon2):

    R = 6371

    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)

    a = (
        sin(dlat / 2) ** 2 +
        cos(radians(lat1)) *
        cos(radians(lat2)) *
        sin(dlon / 2) ** 2
    )

    c = 2 * atan2(sqrt(a), sqrt(1 - a))

    return R * c

print("\n========== DISTANCE EXAMPLE ==========")

user_data = get_user_checkins(58186, 2)

if len(user_data) >= 2:

    row1 = user_data.iloc[0]
    row2 = user_data.iloc[1]

    dist = haversine(
        row1["lat"],
        row1["lon"],
        row2["lat"],
        row2["lon"]
    )

    print("Distance:", round(dist, 2), "km")

# =========================================================
# 14. MOST MOBILE USERS
# =========================================================

print("\n========== MOST MOBILE USERS ==========")

mobility = (
    checkins.groupby("user")["location_id"]
    .nunique()
    .sort_values(ascending=False)
    .head(10)
)

print(mobility)

# =========================================================
# 15. CHECKINS OVER TIME
# =========================================================

print("\n========== CHECKINS PER YEAR ==========")

checkins["year"] = checkins["time"].dt.year

year_stats = (
    checkins["year"]
    .value_counts()
    .sort_index()
)

print(year_stats)

# =========================================================
# 16. EXPORT CSV
# =========================================================

print("\n========== EXPORT CSV ==========")

edges.to_csv(
    "brightkite_edges.csv",
    index=False
)

checkins.to_csv(
    "brightkite_checkins.csv",
    index=False
)

print("CSV exported!")

# =========================================================
# 17. SAVE SAMPLE DATASET
# =========================================================

print("\n========== EXPORT SAMPLE ==========")

sample = checkins.sample(100000)

sample.to_csv(
    "brightkite_checkins_sample.csv",
    index=False
)

print("Sample exported!")

# =========================================================
# 18. NEO4J EXPORT FILES
# =========================================================

print("\n========== NEO4J EXPORT ==========")

neo4j_users = pd.DataFrame({
    "user_id": checkins["user"].unique()
})

neo4j_locations = pd.DataFrame({
    "location_id": checkins["location_id"].unique()
})

neo4j_users.to_csv(
    "neo4j_users.csv",
    index=False
)

neo4j_locations.to_csv(
    "neo4j_locations.csv",
    index=False
)

print("Neo4j files exported!")

# =========================================================
# 19. SIMPLE LOCATION POPULARITY SCORE
# =========================================================

print("\n========== LOCATION POPULARITY ==========")

location_popularity = (
    checkins.groupby("location_id")
    .agg({
        "user": "nunique",
        "time": "count"
    })
    .rename(columns={
        "user": "unique_visitors",
        "time": "total_checkins"
    })
)

location_popularity["score"] = (
    location_popularity["unique_visitors"] * 0.7 +
    location_popularity["total_checkins"] * 0.3
)

print(
    location_popularity
    .sort_values("score", ascending=False)
    .head(10)
)

# =========================================================
# 20. DONE
# =========================================================

print("\n========== PROCESSING COMPLETE ==========")