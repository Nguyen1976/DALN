from sklearn.metrics import classification_report, roc_auc_score, confusion_matrix
from sklearn.model_selection import train_test_split
import pandas as pd

def evaluate_model(X, y, model):
    """
    Hàm đánh giá mô hình phân loại nhị phân cho Recommendation
    """
    # 1. Chia tập Train/Test (Ví dụ: 80% train, 20% test)
    # Trong thực tế với file retrain_model, bạn nên chia tập này trước khi gọi model.fit()
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    
    # Train model trên tập train
    model.fit(X_train, y_train)
    
    # 2. Dự đoán trên tập test
    y_pred = model.predict(X_test)         # Dự đoán nhãn (0 hoặc 1)
    y_scores = model.predict_proba(X_test)[:, 1] # Dự đoán xác suất (từ 0.0 đến 1.0) để tính AUC
    
    # 3. In ra các chỉ số
    print("=== BÁO CÁO ĐÁNH GIÁ MÔ HÌNH (EVALUATION METRICS) ===")
    
    # ROC-AUC Score
    auc = roc_auc_score(y_test, y_scores)
    print(f"🌟 ROC-AUC Score: {auc:.4f} " + ("(Rất tốt 🔥)" if auc >= 0.8 else "(Cần cải thiện ⚠️)" if auc < 0.6 else "(Ổn định 👍)"))
    print("-" * 50)
    
    # Confusion Matrix (Ma trận nhầm lẫn)
    tn, fp, fn, tp = confusion_matrix(y_test, y_pred).ravel()
    print("📊 Ma trận nhầm lẫn (Confusion Matrix):")
    print(f"   - Đúng là Bỏ qua (TN) : {tn}")
    print(f"   - Đoán sai thành Tương tác (FP - Gợi ý rác) : {fp}")
    print(f"   - Bỏ sót người tiềm năng (FN) : {fn}")
    print(f"   - Đúng là Tương tác (TP - Khớp thành công) : {tp}")
    print("-" * 50)
    
    # Precision, Recall, F1-Score
    print("📈 Báo cáo phân loại chi tiết (Classification Report):")
    print(classification_report(y_test, y_pred, target_names=["IGNORE (0)", "MESSAGE/FRIEND (1)"]))

# --- Cách gọi hàm ---
# Giả sử bạn đã có DataFrame df_merged có chứa các features X và nhãn y
# X = df_merged[["mutualFriends", "mutualGroups", "interestSimilarity", "distanceKm"]]
# y = df_merged["label"]
# evaluate_model(X, y, model)