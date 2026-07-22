"""
One-time fix for a schema-drift problem: if `create_tables.py` was ever run
against an older/incomplete version of models.py, Postgres will have
tables (e.g. "quizzes", "questions") with the WRONG shape — missing
columns, wrong column names, etc. `Base.metadata.create_all()` does NOT
fix this: it only creates tables that don't exist yet, it never alters an
existing table to match a changed model.

This script drops the quiz-related tables (in FK-safe order: children
before parents) so that create_all() will recreate them correctly on the
next app start. Lesson tables are untouched since they were never broken.

Run this ONCE against your database:
    python fix_quiz_schema.py

This is destructive to any data in those 4 tables — safe to run now since
anything uploaded against the broken schema wasn't usable anyway. Do NOT
run this once you have real quiz data you care about; use a migration
tool (e.g. Alembic) instead at that point.
"""

from sqlalchemy import text
from database import engine

TABLES_TO_DROP = ["answers", "submissions", "questions", "quizzes"]

with engine.begin() as conn:
    for table in TABLES_TO_DROP:
        print(f"Dropping table if exists: {table}")
        conn.execute(text(f"DROP TABLE IF EXISTS {table} CASCADE"))

print("\nDone. Now run:")
print("    python create_tables.py")
print("to recreate them with the current, correct schema.")
