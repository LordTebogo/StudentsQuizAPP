import sqlite3

conn = sqlite3.connect("quiz_app.db")
cursor = conn.cursor()

cursor.execute("""
SELECT name, sql
FROM sqlite_master
WHERE type='table'
ORDER BY name;
""")

for table_name, create_sql in cursor.fetchall():
    print("=" * 80)
    print(f"TABLE: {table_name}")
    print("=" * 80)
    print(create_sql)
    print()

conn.close()
