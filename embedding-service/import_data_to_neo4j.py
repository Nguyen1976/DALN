from neo4j import GraphDatabase
import pandas as pd
from tqdm import tqdm

# =========================================================
# CONFIG
# =========================================================

NEO4J_URI = "bolt://localhost:7687"
NEO4J_USER = "neo4j"
NEO4J_PASSWORD = "password123"

# CSV FILES
USERS_FILE = "neo4j_users.csv"
LOCATIONS_FILE = "neo4j_locations.csv"
EDGES_FILE = "brightkite_edges.csv"
CHECKINS_FILE = "brightkite_checkins_sample.csv"

# =========================================================
# CONNECT
# =========================================================

driver = GraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASSWORD)
)

print("Connected to Neo4j!")

# =========================================================
# CREATE CONSTRAINTS
# =========================================================

def create_constraints():

    queries = [

        """
        CREATE CONSTRAINT user_id_unique IF NOT EXISTS
        FOR (u:User)
        REQUIRE u.id IS UNIQUE
        """,

        """
        CREATE CONSTRAINT location_id_unique IF NOT EXISTS
        FOR (l:Location)
        REQUIRE l.id IS UNIQUE
        """
    ]

    with driver.session() as session:

        for q in queries:
            session.run(q)

    print("Constraints created!")

# =========================================================
# LOAD USERS
# =========================================================

def load_users():

    users = pd.read_csv(USERS_FILE)

    print(f"\nLoading {len(users)} users...")

    query = """
    MERGE (u:User {
        id: $user_id
    })
    """

    with driver.session() as session:

        for row in tqdm(users.itertuples(), total=len(users)):

            session.run(
                query,
                user_id=int(row.user_id)
            )

    print("Users loaded!")

# =========================================================
# LOAD LOCATIONS
# =========================================================

def load_locations():

    locations = pd.read_csv(LOCATIONS_FILE)

    print(f"\nLoading {len(locations)} locations...")

    query = """
    MERGE (l:Location {
        id: $location_id
    })
    """

    with driver.session() as session:

        for row in tqdm(
            locations.itertuples(),
            total=len(locations)
        ):

            session.run(
                query,
                location_id=str(row.location_id)
            )

    print("Locations loaded!")

# =========================================================
# LOAD FRIENDSHIPS
# =========================================================

def load_friendships():

    edges = pd.read_csv(EDGES_FILE)

    print(f"\nLoading {len(edges)} friendships...")

    query = """
    MATCH (u1:User {
        id: $user1
    })

    MATCH (u2:User {
        id: $user2
    })

    MERGE (u1)-[:FRIEND]->(u2)
    """

    with driver.session() as session:

        for row in tqdm(edges.itertuples(), total=len(edges)):

            session.run(
                query,
                user1=int(row.user1),
                user2=int(row.user2)
            )

    print("Friendships loaded!")

# =========================================================
# LOAD CHECKINS
# =========================================================

def load_checkins(batch_size=1000):

    checkins = pd.read_csv(CHECKINS_FILE)

    print(f"\nLoading {len(checkins)} checkins...")

    query = """
    MATCH (u:User {
        id: $user_id
    })

    MATCH (l:Location {
        id: $location_id
    })

    MERGE (u)-[:CHECKIN {
        time: $time,
        lat: $lat,
        lon: $lon
    }]->(l)
    """

    with driver.session() as session:

        batch = []

        for row in tqdm(
            checkins.itertuples(),
            total=len(checkins)
        ):

            batch.append({
                "user_id": int(row.user),
                "location_id": str(row.location_id),
                "time": str(row.time),
                "lat": float(row.lat),
                "lon": float(row.lon)
            })

            if len(batch) >= batch_size:

                session.execute_write(
                    insert_checkin_batch,
                    query,
                    batch
                )

                batch = []

        # remaining
        if batch:

            session.execute_write(
                insert_checkin_batch,
                query,
                batch
            )

    print("Checkins loaded!")

# =========================================================
# BATCH INSERT
# =========================================================

def insert_checkin_batch(tx, query, batch):

    for item in batch:

        tx.run(
            query,
            user_id=item["user_id"],
            location_id=item["location_id"],
            time=item["time"],
            lat=item["lat"],
            lon=item["lon"]
        )

# =========================================================
# GRAPH STATS
# =========================================================

def graph_stats():

    queries = {

        "Users": """
        MATCH (u:User)
        RETURN count(u) AS count
        """,

        "Locations": """
        MATCH (l:Location)
        RETURN count(l) AS count
        """,

        "Friendships": """
        MATCH ()-[r:FRIEND]->()
        RETURN count(r) AS count
        """,

        "Checkins": """
        MATCH ()-[r:CHECKIN]->()
        RETURN count(r) AS count
        """
    }

    with driver.session() as session:

        print("\n========== GRAPH STATS ==========")

        for name, query in queries.items():

            result = session.run(query)

            count = result.single()["count"]

            print(f"{name}: {count}")

# =========================================================
# FRIEND RECOMMENDATION
# =========================================================

def recommend_friends(user_id):

    query = """
    MATCH (u:User {id: $user_id})
        -[:FRIEND]->
        (f)-[:FRIEND]->
        (candidate)

    WHERE candidate <> u
    AND NOT (u)-[:FRIEND]->(candidate)

    RETURN candidate.id AS user_id,
           count(*) AS mutual_friends

    ORDER BY mutual_friends DESC
    LIMIT 10
    """

    with driver.session() as session:

        result = session.run(
            query,
            user_id=user_id
        )

        print("\n========== FRIEND RECOMMENDATIONS ==========")

        for row in result:

            print(dict(row))

# =========================================================
# LOCATION RECOMMENDATION
# =========================================================

def recommend_locations(user_id):

    query = """
    MATCH (u:User {id: $user_id})
        -[:FRIEND]->
        (f)

    MATCH (f)-[:CHECKIN]->(l:Location)

    WHERE NOT (u)-[:CHECKIN]->(l)

    RETURN l.id AS location_id,
           count(*) AS score

    ORDER BY score DESC
    LIMIT 10
    """

    with driver.session() as session:

        result = session.run(
            query,
            user_id=user_id
        )

        print("\n========== LOCATION RECOMMENDATIONS ==========")

        for row in result:

            print(dict(row))

# =========================================================
# USER SUMMARY
# =========================================================

def user_summary(user_id):

    query = """
    MATCH (u:User {id: $user_id})

    OPTIONAL MATCH (u)-[:FRIEND]->(f)
    WITH u, count(f) AS friend_count

    OPTIONAL MATCH (u)-[:CHECKIN]->(l)

    RETURN
        u.id AS user_id,
        friend_count,
        count(l) AS total_checkins,
        count(DISTINCT l) AS unique_locations
    """

    with driver.session() as session:

        result = session.run(
            query,
            user_id=user_id
        )

        print("\n========== USER SUMMARY ==========")

        print(result.single())

# =========================================================
# MAIN
# =========================================================

if __name__ == "__main__":

    create_constraints()

    load_users()

    load_locations()

    load_friendships()

    # dùng sample trước cho nhẹ
    load_checkins(batch_size=1000)

    graph_stats()

    user_summary(58186)

    recommend_friends(58186)

    recommend_locations(58186)

    driver.close()

    print("\n========== DONE ==========")