import pandas as pd
import numpy as np
from pathlib import Path
from importlib import import_module
from typing import Any


class LogisticService:
    def __init__(self, db: Any) -> None:
        base_dir = Path(__file__).resolve().parents[2]
        self.model_path = base_dir / "models" / "latest_model.pkl"
        self.db = db
        self.impression_collection = self.db["impresstionLog"]
        self.action_collection = self.db["actionLog"]

    def _logistic_regression(self):
        sklearn_linear_model = import_module("sklearn.linear_model")
        return sklearn_linear_model.LogisticRegression

    def _joblib(self):
        return import_module("joblib")

    def get_model(self):
        joblib = self._joblib()
        LogisticRegression = self._logistic_regression()

        if self.model_path.exists():
            return joblib.load(self.model_path)

        model = LogisticRegression()
        model.coef_ = np.array([[0.5, 0.4, 0.8, -0.3]])
        model.intercept_ = np.array([-0.1])
        model.classes_ = np.array([0, 1])
        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(model, self.model_path)
        return model

    def load_model(self):
        joblib = self._joblib()
        if self.model_path.exists():
            return joblib.load(self.model_path)
        return self.get_model()

    def retrain_model(self) -> dict:
        joblib = self._joblib()
        LogisticRegression = self._logistic_regression()

        latest_log = self.impression_collection.find_one(
            {},
            projection={"version": 1},
            sort=[("version", -1), ("createdAt", -1), ("_id", -1)],
        )
        if not latest_log or latest_log.get("version") is None:
            return {
                "status": "empty",
                "trained": False,
                "version": None,
                "message": "No impression logs found",
            }

        latest_version = int(latest_log["version"])
        logs = list(
            self.impression_collection.find(
                {"version": latest_version},
                projection={"userId": 1, "candidateId": 1, "features": 1, "action": 1},
                sort=[("createdAt", 1), ("_id", 1)],
            )
        )
        if not logs:
            return {
                "status": "empty",
                "trained": False,
                "version": latest_version,
                "message": "No impression logs found for latest version",
            }

        action_docs = list(
            self.action_collection.find(
                {},
                projection={"userId": 1, "candidateId": 1, "action": 1},
                sort=[("createdAt", 1), ("_id", 1)],
            )
        )
        action_by_pair: dict[tuple[str, str], str] = {}
        for action_doc in action_docs:
            user_id = action_doc.get("userId")
            candidate_id = action_doc.get("candidateId")
            action = action_doc.get("action")
            if user_id is None or candidate_id is None or action is None:
                continue
            action_by_pair[(str(user_id), str(candidate_id))] = str(action)

        rows: list[dict] = []
        for log in logs:
            user_id = log.get("userId")
            candidate_id = log.get("candidateId")
            features = log.get("features") or {}
            action = str(log.get("action") or "IGNORE")
            if user_id is not None and candidate_id is not None:
                action = action_by_pair.get((str(user_id), str(candidate_id)), action)

            rows.append(
                {
                    "mutualFriends": features.get("mutualFriends", 0),
                    "mutualGroups": features.get("mutualGroups", 0),
                    "interestSimilarity": features.get("interestSimilarity", 0),
                    "distanceKm": features.get("distanceKm", 0),
                    "action": action,
                }
            )

        data = pd.DataFrame(rows)
        if data.empty:
            return {
                "status": "empty",
                "trained": False,
                "version": latest_version,
                "message": "No valid training rows",
            }

        data["label"] = data["action"].apply(
            lambda x: 1 if x in ["MESSAGE", "FRIEND"] else 0
        )

        X = data[["mutualFriends", "mutualGroups", "interestSimilarity", "distanceKm"]]
        y = data["label"]
        label_counts = y.value_counts().to_dict()

        if y.nunique() < 2:
            return {
                "status": "skipped",
                "trained": False,
                "version": latest_version,
                "labelCounts": {str(k): int(v) for k, v in label_counts.items()},
                "message": "Need at least 2 label classes to retrain",
            }

        model = LogisticRegression(max_iter=1000)
        model.fit(X, y)

        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        versioned_model_path = self.model_path.parent / f"latest_model_version_{latest_version}.pkl"
        joblib.dump(model, versioned_model_path)
        joblib.dump(model, self.model_path)
        return {
            "status": "ok",
            "trained": True,
            "version": latest_version,
            "modelFile": versioned_model_path.name,
            "latestModelFile": self.model_path.name,
            "labelCounts": {str(k): int(v) for k, v in label_counts.items()},
            "rows": int(len(data)),
        }

    def predict_top_k(self, candidates_json: list[dict], k: int = 100) -> dict:
        if not candidates_json:
            return {"status": "empty", "data": []}

        model = self.load_model()
        df = pd.DataFrame(candidates_json)
        features = df[[
            "mutualFriends",
            "mutualGroups",
            "interestSimilarity",
            "distanceKm",
        ]]

        scores = model.predict_proba(features)[:, 1]
        df["score"] = scores
        top_k = df.sort_values(by="score", ascending=False).head(k)

        return {"status": "ok", "data": top_k.to_dict(orient="records")}