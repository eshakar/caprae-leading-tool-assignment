import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from app.api.routes import icp, leads, outreach, stats
from app.core.config import get_settings
from app.db.seed import seed_if_empty
from app.db.session import SessionLocal

settings = get_settings()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("saasquatch")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if settings.seed_sample_data:
        try:
            with SessionLocal() as db:
                seed_if_empty(db)
        except SQLAlchemyError:
            log.exception("Seeding skipped - is the database migrated? Run `alembic upgrade head`.")
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Lead intelligence API: enrichment, verification, explainable Deal Signal scoring and AI outreach.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Duplicate-Of"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.exception_handler(OperationalError)
async def db_unavailable(_: Request, exc: OperationalError) -> JSONResponse:
    log.error("Database unavailable: %s", exc.orig)
    return JSONResponse(status_code=503, content={"detail": "Database temporarily unavailable"})


for router in (stats.router, leads.router, icp.router, outreach.router):
    app.include_router(router, prefix="/api")


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {"name": settings.app_name, "docs": "/docs", "health": "/api/health"}
