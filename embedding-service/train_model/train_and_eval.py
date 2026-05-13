import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.tree import DecisionTreeClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.metrics import f1_score, roc_auc_score, classification_report
import joblib
import os


MODEL_DIR = os.path.join(os.path.dirname(__file__), 'models')
os.makedirs(MODEL_DIR, exist_ok=True)

FULL_FEATURES = [
    'jaccard',
    'cosine_graph',
    'adamic_adar',
    'pref_attach',
    'deg_u',
    'deg_v',
    'shortest_path',
    'wcc',
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


def load_dataset(csv_path='dataset.csv'):
    df = pd.read_csv(csv_path)
    return df


def prepare_Xy(df, feature_mode='safe'):
    drop_cols = ['u', 'v', 'label']
    X = df.drop(columns=[c for c in drop_cols if c in df.columns])
    y = df['label'].astype(int)
    feature_cols = SAFE_FEATURES if feature_mode == 'safe' else FULL_FEATURES
    feature_cols = [c for c in feature_cols if c in X.columns]
    X = X[feature_cols]
    # fill nans
    X = X.fillna(-1)
    return X, y


def print_dataset_diagnostics(df, X, y):
    print("Dataset diagnostics:")
    print(y.value_counts(dropna=False).sort_index().to_string())
    print(f"Rows: {len(df)}  Features: {X.shape[1]}")

    numeric = X.select_dtypes(include=[np.number]).copy()
    numeric['label'] = y.values
    means = numeric.groupby('label').mean(numeric_only=True)
    diffs = (means.loc[1] - means.loc[0]).abs().sort_values(ascending=False)
    print("Top feature mean gaps between positive and negative pairs:")
    print(diffs.head(10).to_string())


def extract_feature_importances(models_dict, X, feature_names, output_dir='.'):
    """Extract and save feature importances from tree-based models."""
    importances_dict = {}
    
    for name, m in models_dict.items():
        if hasattr(m, 'feature_importances_'):
            imp = m.feature_importances_
            # normalize to sum to 1
            imp_norm = imp / imp.sum()
            importances_dict[name] = pd.DataFrame({
                'feature': feature_names,
                'importance': imp,
                'importance_norm': imp_norm,
            }).sort_values('importance', ascending=False)
    
    # print top 10 for each model
    for name, df in importances_dict.items():
        print(f"\n{name.upper()} Feature Importances (top 10):")
        print(df.head(10).to_string(index=False))
    
    # save to CSV
    if importances_dict:
        combined = pd.concat(
            [df.assign(model=name) for name, df in importances_dict.items()],
            ignore_index=True
        )
        csv_path = os.path.join(output_dir, 'feature_importances.csv')
        combined.to_csv(csv_path, index=False)
        print(f"\nFeature importances saved to {csv_path}")
    
    return importances_dict


def compute_scores(model, X_train_s, y_train, X_test_s, y_test):
    train_probs = model.predict_proba(X_train_s)[:, 1]
    test_probs = model.predict_proba(X_test_s)[:, 1]

    train_preds = (train_probs >= 0.5).astype(int)
    test_preds = (test_probs >= 0.5).astype(int)

    train_f1 = f1_score(y_train, train_preds)
    test_f1 = f1_score(y_test, test_preds)
    try:
        train_auc = roc_auc_score(y_train, train_probs)
    except Exception:
        train_auc = float('nan')
    try:
        test_auc = roc_auc_score(y_test, test_probs)
    except Exception:
        test_auc = float('nan')

    return {
        'train_f1': train_f1,
        'test_f1': test_f1,
        'train_auc': train_auc,
        'test_auc': test_auc,
        'train_preds': train_preds,
        'test_preds': test_preds,
        'test_probs': test_probs,
    }


def train_and_report(csv_path='dataset.csv', feature_mode='safe'):
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
    train_and_report()
