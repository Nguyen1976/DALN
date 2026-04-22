import pandas as pd
import numpy as np
from pathlib import Path
from importlib import import_module


class LogisticService:
    def __init__(self) -> None:
        base_dir = Path(__file__).resolve().parents[2]
        self.model_path = base_dir / "models" / "latest_model.pkl"
        self.log_dir = base_dir / "logs"

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

    def retrain_model(self):
        joblib = self._joblib()
        LogisticRegression = self._logistic_regression()

        all_files = [p for p in self.log_dir.glob("*.csv")]
        if not all_files:
            return self.load_model()

        df_list = [pd.read_csv(path) for path in all_files]
        data = pd.concat(df_list, ignore_index=True)
        data["label"] = data["action"].apply(
            lambda x: 1 if x in ["MESSAGE", "FRIEND"] else 0
        )

        X = data[["mutualFriends", "mutualGroups", "interestSimilarity", "distanceKm"]]
        y = data["label"]

        model = LogisticRegression()
        model.fit(X, y)

        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(model, self.model_path)
        return model

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