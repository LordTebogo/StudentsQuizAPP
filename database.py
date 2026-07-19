from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from dotenv import load_dotenv
import os

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Add it to your .env file locally, or to "
        "the Environment Variables section of your Render service."
    )

# SQLAlchemy's default postgres driver name changed; some hosted Postgres
# providers (Supabase, Render, Heroku, etc.) hand out URLs starting with
# "postgres://", which older/newer SQLAlchemy versions may reject. Normalize
# it to the "postgresql://" scheme that SQLAlchemy expects.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,   # avoids "server closed the connection unexpectedly"
                          # errors after the DB drops idle connections
    pool_recycle=300,     # recycle connections every 5 min, safe for
                          # poolers (e.g. Supabase's pgbouncer/Supavisor)
                          # that close idle connections aggressively
)

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
