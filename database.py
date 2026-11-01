from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from dotenv import load_dotenv
import os

load_dotenv()

# ---------------------------------------------------------------------------
# Database URL resolution
# ---------------------------------------------------------------------------
# Production expects DATABASE_URL (Postgres). For local development and for
# anyone cloning the project to try it out, fall back to a file-backed SQLite
# database instead of crashing at import time. This keeps the app bootable with
# zero configuration while still honouring a real DATABASE_URL when present.
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    DATABASE_URL = "sqlite:///./local_dev.db"
    print(
        "[database] DATABASE_URL is not set - falling back to local SQLite "
        "database at ./local_dev.db. Set DATABASE_URL to use Postgres.",
    )

# SQLAlchemy's default postgres driver name changed; some hosted Postgres
# providers (Supabase, Render, Heroku, etc.) hand out URLs starting with
# "postgres://", which older/newer SQLAlchemy versions may reject. Normalize
# it to the "postgresql://" scheme that SQLAlchemy expects.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

_is_sqlite = DATABASE_URL.startswith("sqlite")

_engine_kwargs = {}
if _is_sqlite:
    # SQLite needs to be told to allow use across FastAPI's worker threads.
    _engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    _engine_kwargs.update(
        pool_pre_ping=True,   # avoids "server closed the connection unexpectedly"
                              # errors after the DB drops idle connections
        pool_recycle=300,     # recycle connections every 5 min, safe for
                              # poolers (e.g. Supabase's pgbouncer/Supavisor)
                              # that close idle connections aggressively
    )

engine = create_engine(DATABASE_URL, **_engine_kwargs)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()


def get_db():
    """FastAPI dependency: yields a DB session for the request, always
    closing it afterward even if the request raises."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
