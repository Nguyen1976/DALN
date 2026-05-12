from neo4j import GraphDatabase
import pandas as pd
import os
import json

NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "password123")


def get_driver():
    return GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))


def fetch_friend_edges(driver):
    q = """
    MATCH (u:User)-[:FRIEND]->(v:User)
    RETURN u.id AS user1, v.id AS user2
    """
    with driver.session() as session:
        res = session.run(q)
        rows = [dict(r) for r in res]

    df = pd.DataFrame(rows)
    if not df.empty:
        df['user1'] = df['user1'].astype(int)
        df['user2'] = df['user2'].astype(int)

    return df


def fetch_users(driver):
    q = """
    MATCH (u:User)
    RETURN u.id AS user_id, u.lat AS lat, u.lon AS lon, u.cluster AS cluster, u.bio_embedding AS bio
    """
    with driver.session() as session:
        res = session.run(q)
        rows = [dict(r) for r in res]

    df = pd.DataFrame(rows)
    if 'user_id' in df:
        df['user_id'] = df['user_id'].astype(int)

    # try to parse bio if it's a JSON string or bracket list
    def _parse_bio(val):
        if val is None:
            return None
        if isinstance(val, (list, tuple)):
            return val
        if isinstance(val, str):
            s = val.strip()
            # try json
            try:
                parsed = json.loads(s)
                return parsed
            except Exception:
                pass
            # try simple bracket removal and comma split
            try:
                s2 = s.strip('[]()')
                parts = [p for p in s2.replace('\n', ' ').split(',') if p.strip()]
                return [float(p) for p in parts]
            except Exception:
                return None

    if 'bio' in df.columns:
        df['bio'] = df['bio'].apply(_parse_bio)

    return df


def fetch_user_groups(driver):
    q = """
    MATCH (u:User)-[:MEMBER_OF]->(g:Group)
    RETURN u.id AS user_id, collect(g.id) AS groups
    """
    with driver.session() as session:
        res = session.run(q)
        rows = [dict(r) for r in res]

    df = pd.DataFrame(rows)
    if 'user_id' in df:
        df['user_id'] = df['user_id'].astype(int)

    return df
