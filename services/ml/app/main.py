"""Furlong ML service.

Two responsibilities:
  1. Parse auction catalog PDFs into structured hip records.
  2. Produce price predictions + value estimates (LightGBM, Phase 1).

Numeric prediction is deterministic and auditable. No LLM in the pricing path.
"""
from fastapi import FastAPI, UploadFile, File
from pydantic import BaseModel

from app.parsing.keeneland import parse_keeneland_catalog
from app.valuation.model import predict, reload_comparables, MODEL_VERSION

app = FastAPI(title="furlong-ml")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "furlong-ml", "model_version": MODEL_VERSION}


@app.post("/parse-catalog")
async def parse_catalog(file: UploadFile = File(...)) -> dict:
    raw = await file.read()
    return parse_keeneland_catalog(raw, filename=file.filename or "catalog.pdf")


class FeatureRequest(BaseModel):
    hip_id: str
    features: dict


@app.post("/value")
def value(req: FeatureRequest) -> dict:
    return predict(req.features)


@app.post("/reload-comparables")
def reload_comps() -> dict:
    comps = reload_comparables()
    return {"comparables": len(comps)}
