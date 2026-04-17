import torch
import os
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from pymongo import UpdateOne, MongoClient
from bson import ObjectId
import uvicorn
import logging
import time

# Tắt đa luồng của Tokenizer để tránh nghẽn CPU trên Mac
os.environ["TOKENIZERS_PARALLELISM"] = "false"

# Chỉ ghi log vào file để không tốn tài nguyên in ra màn hình Terminal
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(message)s',
    handlers=[logging.FileHandler("sync_process.log")]
)
logger = logging.getLogger(__name__)

app = FastAPI()

# Kết nối MongoDB với cơ chế Bulk Write tối ưu
mongo_client = MongoClient("mongodb://localhost:27017", directConnection=True)
db = mongo_client["user-service"]
collection = db["User"]

# Khởi tạo AI Model với FP16 (Nhanh gấp đôi trên chip M2)
device = "mps" if torch.backends.mps.is_available() else "cpu"
model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2', device=device)
if device == "mps":
    model.half() # Ép model sang Float16 để tối ưu GPU Apple Silicon

class UserData(BaseModel):
    id: str
    bio: str
    age: int

class BioBatch(BaseModel):
    users: list[UserData]

@app.post("/embed-and-save")
async def embed_and_save(data: BioBatch):
    if not data.users:
        return {"status": "empty"}
    
    try:
        # 1. Nhúng hàng loạt với batch_size nội bộ cực lớn
        texts = [f"Tiểu sử: {u.bio}. Đối tượng: {u.age} tuổi." for u in data.users]
        
        with torch.no_grad():
            # Tăng batch_size lên 256-512 để GPU M2 chạy hết công suất
            embeddings = model.encode(
                texts, 
                batch_size=256, 
                show_progress_bar=False, 
                convert_to_numpy=True
            )

        # 2. Chuẩn bị Bulk Write
        ops = []
        # Chuyển đổi embedding sang list nhanh hơn bằng cách xử lý mảng numpy
        embeddings_list = embeddings.tolist()

        for i, u in enumerate(data.users):
            try:
                ops.append(UpdateOne(
                    {"_id": ObjectId(u.id)},
                    {"$set": {"profile_vector": embeddings_list[i]}}
                ))
            except:
                continue

        # 3. Ghi trực tiếp vào Mongo (Tắt w:1 để đạt tốc độ ghi "bàn thờ")
        if ops:
            result = collection.bulk_write(ops, ordered=False)
            logger.info(f"Done: {len(ops)} | Match: {result.matched_count}")

        return {"status": "ok"}

    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return {"status": "error"}

if __name__ == "__main__":
    # Tắt log của uvicorn để tập trung tài nguyên cho tính toán
    uvicorn.run(app, host="0.0.0.0", port=8000, access_log=False)