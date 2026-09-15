import sqlite3, os, json, sys

sys.stdout.reconfigure(encoding="utf-8")

db_path = os.path.join("backend", "data", "app.db")
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
c = conn.cursor()

c.execute("PRAGMA table_info(species_profiles)")
cols = [r[1] for r in c.fetchall()]
print("COLS:", cols)

c.execute("SELECT id, species, name_ar, name_en, category FROM species_profiles ORDER BY species")
rows = c.fetchall()
print("COUNT:", len(rows))
for r in rows:
    d = dict(r)
    print(d["id"], "|", d["species"], "|", d["name_ar"], "|", d["category"])

c.execute("SELECT species, ai_support FROM species_profiles WHERE species IN ('Rose','Apple','Tomato')")
for r in c.fetchall():
    print(r["species"], "->", r["ai_support"])

# Check a full row for Rose
c.execute("SELECT * FROM species_profiles WHERE species='Rose'")
rose = dict(c.fetchone())
print("\nROSE FULL:")
print(json.dumps({k: (v[:80] + "...") if isinstance(v, str) and len(v) > 80 else v for k, v in rose.items()}, ensure_ascii=False, indent=2))

conn.close()