"""
Database Setup Script
Applies schema.sql to the Neon database. Run this once (or after schema changes)
to create missing tables like training_experiences.
"""
import os
import sys
from dotenv import load_dotenv
from model_manager import get_db_connection

# Load environment variables
_load_dirs = [
    os.path.join(os.path.dirname(__file__), ".."),
    os.path.dirname(__file__),
]
for _d in _load_dirs:
    _e = os.path.join(_d, ".env")
    if os.path.isfile(_e):
        load_dotenv(_e)
        break
else:
    load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("DATABASE_URL not set. Check .env.")
    sys.exit(1)


def main():
    schema_path = os.path.join(os.path.dirname(__file__), "..", "schema.sql")
    if not os.path.isfile(schema_path):
        print(f"Schema file not found: {schema_path}")
        sys.exit(1)

    with open(schema_path, "r") as f:
        schema_sql = f.read()

    # Split into statements (semicolon at end of line, skip comments)
    lines = schema_sql.split("\n")
    statements = []
    current = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("--"):
            continue
        current.append(line)
        if stripped.endswith(";"):
            stmt = "\n".join(current).strip()
            if stmt:
                statements.append(stmt)
            current = []
    if current:
        stmt = "\n".join(current).strip()
        if stmt:
            statements.append(stmt)

    print("Connecting to database...")
    conn = get_db_connection(DATABASE_URL)
    conn.autocommit = True

    success = 0
    errors = []
    for i, stmt in enumerate(statements):
        try:
            with conn.cursor() as cur:
                cur.execute(stmt)
            success += 1
        except Exception as e:
            # Some statements may fail if objects already exist - that's OK
            err_msg = str(e).split("\n")[0]
            if "already exists" in err_msg.lower():
                success += 1  # Ignore "already exists"
            else:
                errors.append((i + 1, stmt[:80], str(e)))

    conn.close()

    if errors:
        print(f"\nApplied {success} statements. {len(errors)} error(s):")
        for idx, stmt, err in errors:
            print(f"  [{idx}] {err}")
            print(f"      {stmt}...")
        sys.exit(1)

    print(f"✓ Schema applied successfully ({success} statements).")


if __name__ == "__main__":
    main()
