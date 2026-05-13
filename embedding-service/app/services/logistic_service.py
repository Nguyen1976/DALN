import pandas as pd
import numpy as np
from pathlib import Path
from importlib import import_module
from typing import Any


class LogisticService:
    def __init__(self, db: Any) -> None:
        base_dir = Path(__file__).resolve().parents[2]
        self.model_path = base_dir / "models" / "latest_model.pkl"
        self.gb_model_path = base_dir / "train_model" / "models" / "gb.joblib"
        self.db = db
        self.impression_collection = self.db["impresstionLog"]
        self.action_collection = self.db["actionLog"]

    def _random_forest(self):
        sklearn_ensemble = import_module("sklearn.ensemble")
        return sklearn_ensemble.RandomForestClassifier

    def _xgb_classifier(self):
        xgb_module = import_module("xgboost")
        return xgb_module.XGBClassifier

    def _smote(self):
        imblearn_over_sampling = import_module("imblearn.over_sampling")
        return imblearn_over_sampling.SMOTE

    def _smote_tomek(self):
        imblearn_combine = import_module("imblearn.combine")
        return imblearn_combine.SMOTETomek

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
            "average_precision_score": sklearn_metrics.average_precision_score,
            "precision_recall_curve": sklearn_metrics.precision_recall_curve,
            "confusion_matrix": sklearn_metrics.confusion_matrix,
            "classification_report": sklearn_metrics.classification_report,
            "accuracy_score": sklearn_metrics.accuracy_score,
        }

    def _build_model(self, model_name: str, y_train):
        """Build a model based on the model_name parameter"""
        n_neg = int((y_train == 0).sum())
        n_pos = int((y_train == 1).sum())
        scale_pos_weight = float(n_neg / max(1, n_pos))

        if model_name == "logistic_regression":
            LogisticRegression = self._logistic_regression()
            return LogisticRegression(
                max_iter=1000,
                random_state=42,
                class_weight="balanced",
            )
        elif model_name == "random_forest":
            RandomForestClassifier = self._random_forest()
            return RandomForestClassifier(
                n_estimators=500,
                max_depth=10,
                min_samples_split=5,
                min_samples_leaf=2,
                random_state=42,
                n_jobs=-1,
                class_weight="balanced",
            )
        elif model_name == "xgboost":
            XGB = self._xgb_classifier()
            return XGB(
                scale_pos_weight=scale_pos_weight,
                n_estimators=500,
                max_depth=5,
                learning_rate=0.05,
                subsample=0.8,
                colsample_bytree=0.8,
                min_child_weight=5,
                gamma=1,
                eval_metric="aucpr",
                random_state=42,
                n_jobs=-1,
            )
        else:
            raise ValueError(f"Unknown model name: {model_name}")

    def _resample_training_data(self, X_train, y_train):
        if y_train.nunique() < 2:
            return X_train, y_train

        try:
            SMOTE = self._smote()
            SMOTETomek = self._smote_tomek()
            smote_tomek = SMOTETomek(
                smote=SMOTE(sampling_strategy=0.3),
                random_state=42,
            )
            return smote_tomek.fit_resample(X_train, y_train)
        except Exception:
            return X_train, y_train

    def _best_threshold_from_scores(self, y_true, y_scores):
        metrics = self._metrics()
        precisions, recalls, thresholds = metrics["precision_recall_curve"](
            y_true,
            y_scores,
        )

        if len(thresholds) == 0:
            return 0.5

        f1_scores = (2 * precisions[:-1] * recalls[:-1]) / (
            precisions[:-1] + recalls[:-1] + 1e-8
        )
        best_index = int(np.nanargmax(f1_scores))
        return float(thresholds[min(best_index, len(thresholds) - 1)])

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
        # Priority 1: Load GB model from train_model (newest)
        if self.gb_model_path.exists():
            try:
                model_data = joblib.load(self.gb_model_path)
                # gb.joblib contains {'model': model, 'scaler': scaler}
                if isinstance(model_data, dict) and 'model' in model_data:
                    return model_data['model']
                return model_data
            except Exception as e:
                print(f"Error loading GB model from {self.gb_model_path}: {e}")
        
        # Priority 2: Fall back to latest model if exists
        if self.model_path.exists():
            return joblib.load(self.model_path)
        
        # Priority 3: Return default model
        return self.get_model()

    def retrain_model(self) -> dict:
        joblib = self._joblib()
        # LogisticRegression = self._logistic_regression()
        RandomForestClassifier = self._random_forest()

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

        # Train XGBoost with an internal validation split and scale_pos_weight
        X_train_full, X_val, y_train_full, y_val = self._train_test_split()(X, y, test_size=0.2, random_state=42, stratify=y)

        n_neg = int((y_train_full == 0).sum())
        n_pos = int((y_train_full == 1).sum())
        scale_pos_weight = float(n_neg / max(1, n_pos))

        XGB = self._xgb_classifier()
        model = XGB(
            scale_pos_weight=scale_pos_weight,
            n_estimators=500,
            max_depth=5,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_weight=5,
            gamma=1,
            eval_metric="aucpr",
            random_state=42,
            n_jobs=-1,
        )

        model.fit(
            X_train_full,
            y_train_full,
            eval_set=[(X_val, y_val)],
            verbose=False,
        )

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
            "trainedOnRows": int(len(X_train_full) + len(X_val)),
        }

    def evaluate_model(self, version: int, model_name: str = "xgboost") -> dict:
        joblib = self._joblib()
        train_test_split = self._train_test_split()
        metrics = self._metrics()

        rows = self._rows_from_version(version)
        if not rows:
            return {
                "status": "empty",
                "trained": False,
                "version": version,
                "model": model_name,
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
                "model": model_name,
                "labelCounts": {str(k): int(v) for k, v in label_counts.items()},
                "message": "Not enough data points for 80/20 evaluation",
            }

        if y.nunique() < 2:
            return {
                "status": "skipped",
                "trained": False,
                "version": version,
                "model": model_name,
                "labelCounts": {str(k): int(v) for k, v in label_counts.items()},
                "message": "Need at least 2 label classes to evaluate",
            }

        if min(label_counts.values()) < 2:
            return {
                "status": "skipped",
                "trained": False,
                "version": version,
                "model": model_name,
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

        # Build model based on model_name parameter
        model = self._build_model(model_name, y_train)
        
        if model_name == "xgboost":
            model.fit(
                X_train,
                y_train,
                eval_set=[(X_test, y_test)],
                verbose=False,
            )
        else:
            model.fit(X_train, y_train)

        y_scores = model.predict_proba(X_test)[:, 1]

        # Find threshold that maximizes F1 on PR curve
        precisions, recalls, thresholds = metrics["precision_recall_curve"](y_test, y_scores)
        if len(thresholds) > 0:
            f1s = 2 * precisions[:-1] * recalls[:-1] / (precisions[:-1] + recalls[:-1] + 1e-8)
            best_idx = int(np.nanargmax(f1s))
            best_threshold = float(thresholds[min(best_idx, len(thresholds) - 1)])
        else:
            best_threshold = 0.5
        y_pred = (y_scores >= best_threshold).astype(int)

        precision = metrics["precision_score"](y_test, y_pred, zero_division=0)
        recall = metrics["recall_score"](y_test, y_pred, zero_division=0)
        f1_score = metrics["f1_score"](y_test, y_pred, zero_division=0)
        accuracy = metrics["accuracy_score"](y_test, y_pred)
        roc_auc = metrics["roc_auc_score"](y_test, y_scores)
        pr_auc = metrics["average_precision_score"](y_test, y_scores)
        tn, fp, fn, tp = metrics["confusion_matrix"](y_test, y_pred).ravel()

        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        versioned_model_path = self.model_path.parent / f"latest_model_version_{version}_{model_name}.pkl"
        joblib.dump(model, versioned_model_path)

        return {
            "status": "ok",
            "trained": True,
            "version": version,
            "model": model_name,
            "modelFile": versioned_model_path.name,
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
                "prAuc": float(pr_auc),
                "bestThreshold": float(best_threshold),
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

        # Map incoming candidate keys (camelCase) to the snake_case features expected by the trained model (safe feature set)
        feature_columns = [
            'jaccard', 'cosine_graph', 'adamic_adar', 'pref_attach', 'deg_u', 'deg_v',
            'dist_km', 'dist_bucket', 'bio_cosine', 'bio_dot', 'bio_l2',
            'same_cluster', 'group_inter', 'group_jaccard', 'same_group'
        ]

        mapped_rows = []
        for cand in candidates_json:
            mapped = {
                'jaccard': cand.get('jaccard', 0),
                'cosine_graph': cand.get('cosineGraph', 0),
                'adamic_adar': cand.get('adamicAdar', 0),
                'pref_attach': cand.get('prefAttach', 0),
                'deg_u': cand.get('degreeU', cand.get('deg_u', 0)),
                'deg_v': cand.get('degreeV', cand.get('deg_v', 0)),
                'dist_km': cand.get('distanceKm', cand.get('dist_km', 0)),
                'dist_bucket': cand.get('distanceBucket', cand.get('dist_bucket', 0)),
                'bio_cosine': cand.get('bioCosine', cand.get('bio_cosine', 0)),
                'bio_dot': cand.get('bioDot', cand.get('bio_dot', 0)),
                'bio_l2': cand.get('bioL2', cand.get('bio_l2', 0)),
                'same_cluster': cand.get('sameCluster', cand.get('same_cluster', 0)),
                'group_inter': cand.get('groupInter', cand.get('group_inter', 0)),
                'group_jaccard': cand.get('groupJaccard', cand.get('group_jaccard', 0)),
                'same_group': cand.get('sameGroup', cand.get('same_group', 0)),
            }
            mapped_rows.append(mapped)

        df_features = pd.DataFrame(mapped_rows)

        # Ensure all columns present
        for col in feature_columns:
            if col not in df_features.columns:
                df_features[col] = 0

        X = df_features[feature_columns].fillna(0)

        # Predict scores
        scores = model.predict_proba(X)[:, 1]

        # Merge scores back into original candidate objects to preserve keys
        results = []
        for i, cand in enumerate(candidates_json):
            out = dict(cand)
            out['score'] = float(scores[i])
            results.append(out)

        # Return top-k sorted by score
        results_sorted = sorted(results, key=lambda r: r.get('score', 0), reverse=True)[:k]
        return {"status": "ok", "data": results_sorted}
    
