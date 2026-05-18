import pandas as pd
from importlib import import_module
from pathlib import Path
from typing import Any

# Must match Nest candidate strip + `RankingCandidate` / GB training `SAFE_FEATURES`.
SAFE_FEATURES = [
    'jaccard',
    'cosine_graph',
    'adamic_adar',
    'pref_attach',
    'deg_u',
    'deg_v',
    'dist_km',
    'dist_bucket',
    'bio_cosine',
    'bio_dot',
    'bio_l2',
    'same_cluster',
    'group_inter',
    'group_jaccard',
    'same_group',
]


class RecommendationRankService:
    """
    Gradient Boosting inference from `train_model/models/gb.joblib`.
    Contract: POST /recommend/rank — no DB; model bundle only.
    """

    def __init__(self) -> None:
        base_dir = Path(__file__).resolve().parents[2]
        self.gb_model_path = base_dir / 'train_model' / 'models' / 'gb.joblib'

    def _joblib(self):
        return import_module('joblib')

    def _load_model_bundle(self) -> tuple[Any, Any]:
        joblib = self._joblib()
        if not self.gb_model_path.exists():
            raise FileNotFoundError(
                f'GB model not found at {self.gb_model_path}. '
                'Train with train_model/ then call /recommend/rank.'
            )

        bundle = joblib.load(self.gb_model_path)
        if isinstance(bundle, dict):
            return bundle.get('model'), bundle.get('scaler')
        return bundle, None

    def rank_top_k(self, candidates_json: list[dict], k: int = 100) -> dict:
        if not candidates_json:
            return {'status': 'empty', 'data': []}

        model, scaler = self._load_model_bundle()

        rows = []
        for candidate in candidates_json:
            row = {
                feature: float(candidate.get(feature, 0) or 0)
                for feature in SAFE_FEATURES
            }
            row['candidateId'] = candidate.get('candidateId')
            rows.append(row)

        df = pd.DataFrame(rows)
        x = df[SAFE_FEATURES].fillna(-1)
        x_input = scaler.transform(x) if scaler is not None else x.values

        scores = model.predict_proba(x_input)[:, 1]
        df['score'] = scores
        top_k = df.sort_values('score', ascending=False).head(k)

        return {'status': 'ok', 'data': top_k.to_dict(orient='records')}
