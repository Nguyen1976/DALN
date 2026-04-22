import pandas as pd
import numpy as np
from sklearn.linear_model import LogisticRegression
import joblib
import os
from datetime import datetime

MODEL_PATH = 'latest_model.pkl'
LOG_DIR = './logs/'
def get_model():
    if os.path.exists(MODEL_PATH):
        # Nếu đã có file từ lần chạy trước, load lên dùng tiếp
        return joblib.load(MODEL_PATH)
    else:
        # Nếu chưa có, tạo mới và set trọng số thủ công
        print("Chưa có model, đang khởi tạo với trọng số mặc định...")
        model = LogisticRegression()
        
        # Giả định 4 features: [mutualFriends, mutualGroups, interestSimilarity, distanceKm]
        # Chúng ta giả lập model đã được train bằng cách gán coef_ và intercept_
        # Trọng số dương: thích gần/nhiều điểm chung | Trọng số âm: ghét khoảng cách xa
        model.coef_ = np.array([[0.5, 0.4, 0.8, -0.3]]) 
        model.intercept_ = np.array([-0.1])
        model.classes_ = np.array([0, 1]) # 0: Ignore, 1: Action
        
        # Lưu lại để lần sau NestJS gọi là có sẵn file
        joblib.dump(model, MODEL_PATH)
        return model


# 2. TRAIN LẠI MODEL DỰA TRÊN LOG CSV
def retrain_model():
    # Đọc tất cả file log .csv trong thư mục
    all_files = [os.path.join(LOG_DIR, f) for f in os.listdir(LOG_DIR) if f.endswith('.csv')]
    if not all_files:
        return load_model()

    df_list = [pd.read_csv(f) for f in all_files]
    data = pd.concat(df_list, ignore_index=True)

    # Tiền xử lý: Chuyển Action thành nhãn 0 và 1
    # MESSAGE/FRIEND -> 1 (Positive), IGNORE -> 0 (Negative)
    data['label'] = data['action'].apply(lambda x: 1 if x in ['MESSAGE', 'FRIEND'] else 0)

    X = data[['mutualFriends', 'mutualGroups', 'interestSimilarity', 'distanceKm']]
    y = data['label']

    model = LogisticRegression()
    model.fit(X, y)
    
    # Lưu model mới nhất (Version control đơn giản)
    joblib.dump(model, MODEL_PATH)
    return model

def load_model():
    if os.path.exists(MODEL_PATH):
        return joblib.load(MODEL_PATH)
    return get_model()

# 3. DỰ ĐOÁN VÀ TRẢ VỀ TOP-K
def predict_top_k(candidates_json, k=100):
    model = load_model()
    
    # Chuyển dữ liệu từ NestJS (JSON) sang DataFrame
    df = pd.DataFrame(candidates_json)
    features = df[['mutualFriends', 'mutualGroups', 'interestSimilarity', 'distanceKm']]
    
    # Tính xác suất (probability) user sẽ thực hiện hành động
    # predict_proba trả về [prob_0, prob_1], ta lấy cột 1
    scores = model.predict_proba(features)[:, 1]
    
    df['score'] = scores
    # Sắp xếp và lấy Top K
    top_k = df.sort_values(by='score', ascending=False).head(k)
    
    return top_k.to_json(orient='records')

# Logic này bạn có thể gọi qua Flask/FastAPI hoặc chạy command line