import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
import os

# Đường dẫn lưu model
MODEL_DIR = "./models"
MODEL_NAME = os.getenv("BOOTSTRAP_MODEL_NAME", "bootstrap_model.pkl")
ALLOW_OVERWRITE_LATEST = os.getenv("BOOTSTRAP_OVERWRITE_LATEST", "0") == "1"

if not os.path.exists(MODEL_DIR):
    os.makedirs(MODEL_DIR)

def create_initial_model():
    # 1. Khởi tạo mô hình Logistic Regression
    model = LogisticRegression()

    # 2. Định nghĩa trọng số thủ công cho 4 đặc tính (Features)
    # Thứ tự: [mutualFriends, mutualGroups, interestSimilarity, distanceKm]
    # Trọng số dương (+) -> Càng lớn càng tốt
    # Trọng số âm (-)   -> Càng lớn càng tệ (ví dụ khoảng cách xa thì điểm thấp đi)
    weights = np.array([[0.5, 0.3, 0.8, -0.4]]) 
    
    # Bias (Hệ số tự do)
    intercept = np.array([-0.1])

    # 3. Áp đặt các thông số này vào model
    model.coef_ = weights
    model.intercept_ = intercept
    model.classes_ = np.array([0, 1]) # 0: Bỏ qua, 1: Tương tác

    # 4. Lưu thành file .pkl
    if MODEL_NAME == "latest_model.pkl" and not ALLOW_OVERWRITE_LATEST:
        print(
            "❌ Refuse to overwrite latest_model.pkl by default. "
            "Set BOOTSTRAP_OVERWRITE_LATEST=1 if you really want to overwrite."
        )
        return

    model_path = os.path.join(MODEL_DIR, MODEL_NAME)
    joblib.dump(model, model_path)
    
    print(f"✅ Đã tạo model thành công tại: {model_path}")
    print(f"📊 Trọng số ban đầu: {weights}")

if __name__ == "__main__":
    create_initial_model()