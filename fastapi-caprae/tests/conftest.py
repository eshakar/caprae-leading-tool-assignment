import os

# Point the app at an isolated test database before anything imports the settings.
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://caprae:caprae@localhost:5432/caprae_test"
)
os.environ["SEED_SAMPLE_DATA"] = "true"
# Empty values override any keys in a local .env, so tests never call a real AI provider.
for _key in ("ANTHROPIC_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY"):
    os.environ[_key] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db.session import Base, engine  # noqa: E402
import app.models  # noqa: E402,F401


@pytest.fixture(scope="session", autouse=True)
def _schema():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture(scope="session")
def client(_schema):
    from app.main import app

    with TestClient(app) as c:  # runs lifespan -> seeds sample data
        yield c
