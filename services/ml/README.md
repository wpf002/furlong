# furlong-ml

Python FastAPI service: catalog parsing + valuation model.

```bash
cd services/ml
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
