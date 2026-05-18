# DALN embedding-service

FastAPI service for **backend contract only**:

| Endpoint | Purpose |
|----------|---------|
| `POST /embed-and-save` | Bio → Mongo `profile_vector` + Qdrant `user_bios` |
| `POST /top-k` | Rank candidates with `train_model/models/gb.joblib` |

- **Contract & Nest callers:** [`CONTRACT.md`](./CONTRACT.md)  
- **Verify backend still references contract:** `python scripts/check_backend_contract.py` (from **repo root** `DALN/`)  
- **Training (F1, AUC, dataset, export `gb.joblib`):** [`train_model/README.md`](./train_model/README.md) — not imported by the HTTP app except the model file path.

```bash
cd embedding-service
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```
