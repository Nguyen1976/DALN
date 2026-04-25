from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np

MODEL_DIR = Path(__file__).resolve().parent / "models"
LATEST_MODEL = MODEL_DIR / "latest_model.pkl"


@dataclass
class ModelSnapshot:
    path: Path
    intercept: float
    weights: np.ndarray


def load_snapshot(path: Path) -> ModelSnapshot:
    model = joblib.load(path)
    weights = np.array(model.coef_[0], dtype=float)
    intercept = float(model.intercept_[0])
    return ModelSnapshot(path=path, intercept=intercept, weights=weights)


def print_snapshot(snapshot: ModelSnapshot) -> None:
    print(f"=== MODEL: {snapshot.path.name} ===")
    print(f"File path      : {snapshot.path}")
    print(f"Last modified  : {snapshot.path.stat().st_mtime}")
    print(f"Intercept      : {snapshot.intercept:.6f}")
    print("Weights:")
    print(f"  mutualFriends      : {snapshot.weights[0]:.6f}")
    print(f"  mutualGroups       : {snapshot.weights[1]:.6f}")
    print(f"  interestSimilarity : {snapshot.weights[2]:.6f}")
    print(f"  distanceKm         : {snapshot.weights[3]:.6f}")
    print("-")


def compare_models(reference: ModelSnapshot, target: ModelSnapshot) -> None:
    intercept_equal = np.isclose(reference.intercept, target.intercept)
    weights_equal = np.allclose(reference.weights, target.weights)

    print(f"Compare {reference.path.name} vs {target.path.name}")
    print(f"  Intercept equal: {intercept_equal}")
    print(f"  Weights equal  : {weights_equal}")

    if not intercept_equal:
        print(
            "  Intercept delta:",
            f"{(target.intercept - reference.intercept):.6f}",
        )

    if not weights_equal:
        deltas = target.weights - reference.weights
        print("  Weight deltas:")
        print(f"    mutualFriends      : {deltas[0]:.6f}")
        print(f"    mutualGroups       : {deltas[1]:.6f}")
        print(f"    interestSimilarity : {deltas[2]:.6f}")
        print(f"    distanceKm         : {deltas[3]:.6f}")

    if intercept_equal and weights_equal:
        print(
            "  => Parameters are identical. "
            "Either retraining produced same result or latest model was overwritten."
        )
    print("-")


def main() -> None:
    if not MODEL_DIR.exists():
        print(f"Model directory not found: {MODEL_DIR}")
        return

    versioned_models = sorted(MODEL_DIR.glob("latest_model_version_*.pkl"))

    model_paths: list[Path] = []
    if LATEST_MODEL.exists():
        model_paths.append(LATEST_MODEL)
    model_paths.extend(versioned_models)

    if not model_paths:
        print("No model files found")
        return

    snapshots = [load_snapshot(path) for path in model_paths]

    for snapshot in snapshots:
        print_snapshot(snapshot)

    latest_snapshot = next((s for s in snapshots if s.path.name == "latest_model.pkl"), None)
    newest_versioned = snapshots[-1] if snapshots else None

    if latest_snapshot and newest_versioned and latest_snapshot.path != newest_versioned.path:
        compare_models(newest_versioned, latest_snapshot)


if __name__ == "__main__":
    main()
