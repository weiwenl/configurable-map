from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .defaults import DEFAULT_CONFIGURATION_ID, SYSTEM_OWNER_ID
from .models import ConfigurationSummary, CreateConfiguration, SavedConfiguration, ShareConfiguration
from .repository import ConfigurationRepository, DuplicateNameError


DEMO_OWNER_ID = "demo-user"
DEFAULT_DATABASE_PATH = Path(__file__).resolve().parents[1] / "data" / "configurations.db"


def create_app(database_path: Path = DEFAULT_DATABASE_PATH) -> FastAPI:
    repository = ConfigurationRepository(database_path)

    @asynccontextmanager
    async def lifespan(app):
        repository.initialize()
        yield

    app = FastAPI(
        title="Configurable Trees API",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
        lifespan=lifespan,
    )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        # Invalid inputs can contain non-finite numbers, which cannot appear in a JSON response.
        return JSONResponse(status_code=422, content={"detail": [
            {key: entry[key] for key in ("loc", "msg", "type")}
            for entry in error.errors()
        ]})

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    # Future: Resolve ownership from login before allowing account-specific creation.
    @app.post("/api/configurations", response_model=SavedConfiguration, status_code=201)
    def create_configuration(draft: CreateConfiguration):
        try:
            return repository.create(DEMO_OWNER_ID, draft)
        except DuplicateNameError:
            raise HTTPException(status_code=409, detail="A configuration with this name already exists. Please use a different name and try again.") from None

    @app.get("/api/configurations", response_model=list[ConfigurationSummary])
    def list_configurations():
        return repository.list(DEMO_OWNER_ID)

    # Future: Resolve a signed-in user's preferred configuration before this system default.
    @app.get("/api/configurations/default", response_model=SavedConfiguration)
    def get_default_configuration():
        record = repository.get(SYSTEM_OWNER_ID, DEFAULT_CONFIGURATION_ID)
        if record is None:
            raise HTTPException(status_code=404, detail="Default configuration not found.")
        return record

    # Future: Use login ownership for publishing, and allow owners to revoke sharing links.
    @app.post("/api/configurations/{configuration_id}/share", response_model=ShareConfiguration)
    def share_configuration(configuration_id: str):
        token = repository.share(DEMO_OWNER_ID, configuration_id)
        if token is None:
            raise HTTPException(status_code=404, detail="Configuration not found.")
        return {"token": token}

    @app.get("/api/configurations/shared/{token}", response_model=SavedConfiguration)
    def get_shared_configuration(token: str):
        record = repository.get_shared(token)
        if record is None:
            raise HTTPException(status_code=404, detail="Shared configuration not found.")
        return record

    @app.get("/api/configurations/{configuration_id}", response_model=SavedConfiguration)
    def get_configuration(configuration_id: str):
        record = repository.get(DEMO_OWNER_ID, configuration_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Configuration not found.")
        return record

    return app


app = create_app()
