from sklearn.metrics import classification_report, roc_auc_score, confusion_matrix
from sklearn.model_selection import train_test_split
import pandas as pd


# --- Cách gọi hàm ---
# Giả sử bạn đã có DataFrame df_merged có chứa các features X và nhãn y
# X = df_merged[["mutualFriends", "mutualGroups", "interestSimilarity", "distanceKm"]]
# y = df_merged["label"]
# evaluate_model(X, y, model)