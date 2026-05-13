"""Fast training without SVM (which is slow)."""
from .train_and_eval import train_and_report, load_dataset, prepare_Xy, print_dataset_diagnostics
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.tree import DecisionTreeClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.metrics import f1_score, roc_auc_score, classification_report
from .train_and_eval import compute_scores, extract_feature_importances, SAFE_FEATURES
import joblib
import os

MODEL_DIR = os.path.join(os.path.dirname(__file__), 'models')
os.makedirs(MODEL_DIR, exist_ok=True)


def train_and_report_fast(csv_path='dataset.csv', feature_mode='safe'):
    df = load_dataset(csv_path)
    X, y = prepare_Xy(df, feature_mode=feature_mode)

    print(f"Feature mode: {feature_mode}")
    print_dataset_diagnostics(df, X, y)

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    models = {
        'logreg': LogisticRegression(max_iter=1000),
        'rf': RandomForestClassifier(n_estimators=100, max_depth=5, min_samples_leaf=30, n_jobs=-1),
        'j45': DecisionTreeClassifier(criterion='entropy', max_depth=5, min_samples_leaf=30, random_state=42),
        'gb': GradientBoostingClassifier(random_state=42),
        'knn': KNeighborsClassifier(n_neighbors=5),
    }

    results = {}

    for name, m in models.items():
        print(f"Training {name}...")
        m.fit(X_train_s, y_train)
        scores = compute_scores(m, X_train_s, y_train, X_test_s, y_test)
        f1 = scores['test_f1']
        auc = scores['test_auc']

        print(name)
        print("Train report:")
        print(classification_report(y_train, scores['train_preds']))
        print("Test report:")
        print(classification_report(y_test, scores['test_preds']))
        print(f"Train F1: {scores['train_f1']:.4f}  Train AUC: {scores['train_auc']:.4f}")
        print(f"Test  F1: {f1:.4f}  Test  AUC: {auc:.4f}\n")

        # save model + scaler
        joblib.dump({'model': m, 'scaler': scaler}, os.path.join(MODEL_DIR, f'{name}.joblib'))
        results[name] = {'train_f1': scores['train_f1'], 'train_auc': scores['train_auc'], 'test_f1': f1, 'test_auc': auc}

    # summary
    print("Summary:")
    for name, r in results.items():
        print(f"{name}: train_F1={r['train_f1']:.4f}, train_AUC={r['train_auc']:.4f}, test_F1={r['test_f1']:.4f}, test_AUC={r['test_auc']:.4f}")

    # extract and print feature importances
    print("\n" + "="*80)
    print("FEATURE IMPORTANCES ANALYSIS")
    print("="*80)
    extract_feature_importances(
        {'rf': models['rf'], 'j45': models['j45'], 'gb': models['gb']},
        X,
        X.columns.tolist(),
        output_dir=os.path.dirname(csv_path) if csv_path else '.'
    )

    return results


if __name__ == '__main__':
    train_and_report_fast()
