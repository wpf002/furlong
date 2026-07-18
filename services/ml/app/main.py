"""Furlong ML service.

Two responsibilities:
  1. Parse auction catalog PDFs into structured hip records.
  2. Produce price predictions + value estimates (LightGBM, Phase 1).

Numeric prediction is deterministic and auditable. No LLM in the pricing path.
"""
from fastapi import FastAPI, UploadFile, File
from pydantic import BaseModel

from app.parsing.keeneland import parse_keeneland_catalog
from app.valuation.model import (
    predict, reload_comparables, current_model_version, current_metrics,
)

app = FastAPI(title="furlong-ml")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "furlong-ml", "model_version": current_model_version()}


@app.post("/parse-catalog")
async def parse_catalog(file: UploadFile = File(...)) -> dict:
    raw = await file.read()
    return parse_keeneland_catalog(raw, filename=file.filename or "catalog.pdf")


class CatalogPagesRequest(BaseModel):
    saleId: str
    pdfUrl: str
    dryRun: bool = False


@app.post("/catalog-pages")
def catalog_pages(req: CatalogPagesRequest) -> dict:
    """Download a sale's catalog PDF, extract each hip's black-type page, and
    write it to Hip.catalogPageText — so pedigree grades compute for the sale.
    Called by the ingest pipeline for FT sales; also usable for backfill."""
    from app.parsing.catalog_pages import load_for_sale

    return load_for_sale(req.saleId, req.pdfUrl, dry_run=req.dryRun)


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


@app.get("/metrics")
def metrics() -> dict:
    """Eval metrics for the active model (recursive-loop transparency)."""
    return {"modelVersion": current_model_version(), "metrics": current_metrics()}


@app.post("/train")
def train() -> dict:
    """Retrain on all current results, version + register the model, reload it.
    Synchronous (~40s) — this is the retrain job; schedule via cron/queue."""
    from app.training.train import main as train_main
    train_main()
    reload_comparables()  # also reloads the freshly trained model
    return {"modelVersion": current_model_version(), "metrics": current_metrics()}
