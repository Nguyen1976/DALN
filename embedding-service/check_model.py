from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import numpy as np


def check_model_weights(model_path: Path) -> None:
    if not model_path.exists():
        print(f"Model file not found: {model_path}")
        return

    model = joblib.load(model_path)

    if not hasattr(model, "coef_") or not hasattr(model, "intercept_"):
        print(f"Model does not expose coef_/intercept_: {model_path}")
        return

    weights = np.array(model.coef_[0], dtype=float)
    intercept = float(model.intercept_[0])

    print(f"=== MODEL PARAMETERS: {model_path} ===")
    print(f"Intercept      : {intercept:.6f}")
    print("Weights:")
    print(f"  mutualFriends      : {weights[0]:.6f}")
    print(f"  mutualGroups       : {weights[1]:.6f}")
    print(f"  interestSimilarity : {weights[2]:.6f}")
    print(f"  distanceKm         : {weights[3]:.6f}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Read and print parameters from one sklearn logistic model file.",
    )
    parser.add_argument(
        "model_path",
        type=Path,
        nargs="?",
        default=Path("models/latest_model_version_3.pkl"),
        help="Path to model .pkl file (example: models/latest_model_version_3.pkl)",
    )
    args = parser.parse_args()

    check_model_weights(args.model_path)


if __name__ == "__main__":
    main()
