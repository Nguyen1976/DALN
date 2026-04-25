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

    def _train_test_split(self):
        sklearn_model_selection = import_module("sklearn.model_selection")
        return sklearn_model_selection.train_test_split

    def _metrics(self):
        sklearn_metrics = import_module("sklearn.metrics")
        return {
            "precision_score": sklearn_metrics.precision_score,
            "recall_score": sklearn_metrics.recall_score,
            "f1_score": sklearn_metrics.f1_score,
            "roc_auc_score": sklearn_metrics.roc_auc_score,
            "confusion_matrix": sklearn_metrics.confusion_matrix,
            "classification_report": sklearn_metrics.classification_report,
            "accuracy_score": sklearn_metrics.accuracy_score,
        }

    def _latest_version(self) -> int | None:
        latest_log = self.impression_collection.find_one(
            {},
            projection={"version": 1},
            sort=[("version", -1), ("createdAt", -1), ("_id", -1)],
        )
        if not latest_log or latest_log.get("version") is None:
            return None
        return int(latest_log["version"])

    def _rows_from_version(self, version: int) -> list[dict]:
        logs = list(
            self.impression_collection.find(
                {"version": version},
                projection={"userId": 1, "candidateId": 1, "features": 1, "action": 1},
                sort=[("createdAt", 1), ("_id", 1)],
            )
        )
        if not logs:
            return []

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
                    "mutualFriends": float(features.get("mutualFriends", 0)),
                    "mutualGroups": float(features.get("mutualGroups", 0)),
                    "interestSimilarity": float(features.get("interestSimilarity", 0)),
                    "distanceKm": float(features.get("distanceKm", 0)),
                    "action": action,
                }
            )
        return rows

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

        latest_version = self._latest_version()
        if latest_version is None:
            return {
                "status": "empty",
                "trained": False,
                "version": None,
                "message": "No impression logs found",
            }

        rows = self._rows_from_version(latest_version)
        if not rows:
            return {
                "status": "empty",
                "trained": False,
                "version": latest_version,
                "message": "No impression logs found for latest version",
            }

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

        model = LogisticRegression(class_weight='balanced', max_iter=1000)
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

    def evaluate_model(self, version: int) -> dict:
        joblib = self._joblib()
        LogisticRegression = self._logistic_regression()
        train_test_split = self._train_test_split()
        metrics = self._metrics()

        rows = self._rows_from_version(version)
        if not rows:
            return {
                "status": "empty",
                "trained": False,
                "version": version,
                "message": "No impression logs found for this version",
            }

        data = pd.DataFrame(rows)
        data["label"] = data["action"].apply(
            lambda x: 1 if x in ["MESSAGE", "FRIEND"] else 0
        )

        X = data[["mutualFriends", "mutualGroups", "interestSimilarity", "distanceKm"]]
        y = data["label"]
        label_counts = y.value_counts().to_dict()

        if len(data) < 5:
            return {
                "status": "skipped",
                "trained": False,
                "version": version,
                "labelCounts": {str(k): int(v) for k, v in label_counts.items()},
                "message": "Not enough data points for 80/20 evaluation",
            }

        if y.nunique() < 2:
            return {
                "status": "skipped",
                "trained": False,
                "version": version,
                "labelCounts": {str(k): int(v) for k, v in label_counts.items()},
                "message": "Need at least 2 label classes to evaluate",
            }

        if min(label_counts.values()) < 2:
            return {
                "status": "skipped",
                "trained": False,
                "version": version,
                "labelCounts": {str(k): int(v) for k, v in label_counts.items()},
                "message": "Need at least 2 samples in each label for stratified 80/20 split",
            }

        X_train, X_test, y_train, y_test = train_test_split(
            X,
            y,
            test_size=0.2,
            random_state=42,
            stratify=y,
        )

        model = LogisticRegression(class_weight='balanced', max_iter=1000)
        model.fit(X_train, y_train)

        y_pred = model.predict(X_test)
        y_scores = model.predict_proba(X_test)[:, 1]

        precision = metrics["precision_score"](y_test, y_pred, zero_division=0)
        recall = metrics["recall_score"](y_test, y_pred, zero_division=0)
        f1_score = metrics["f1_score"](y_test, y_pred, zero_division=0)
        accuracy = metrics["accuracy_score"](y_test, y_pred)
        roc_auc = metrics["roc_auc_score"](y_test, y_scores)
        tn, fp, fn, tp = metrics["confusion_matrix"](y_test, y_pred).ravel()

        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        versioned_model_path = self.model_path.parent / f"latest_model_version_{version}.pkl"
        joblib.dump(model, versioned_model_path)
        joblib.dump(model, self.model_path)

        return {
            "status": "ok",
            "trained": True,
            "version": version,
            "modelFile": versioned_model_path.name,
            "latestModelFile": self.model_path.name,
            "rows": int(len(data)),
            "trainRows": int(len(X_train)),
            "testRows": int(len(X_test)),
            "labelCounts": {str(k): int(v) for k, v in label_counts.items()},
            "metrics": {
                "precision": float(precision),
                "recall": float(recall),
                "f1": float(f1_score),
                "accuracy": float(accuracy),
                "rocAuc": float(roc_auc),
                "confusionMatrix": {
                    "tn": int(tn),
                    "fp": int(fp),
                    "fn": int(fn),
                    "tp": int(tp),
                },
                "classificationReport": metrics["classification_report"](
                    y_test,
                    y_pred,
                    target_names=["IGNORE (0)", "MESSAGE/FRIEND (1)"],
                    output_dict=True,
                    zero_division=0,
                ),
            },
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
    
