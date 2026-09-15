import sqlite3, os, json

db_path = os.path.join("backend", "data", "app.db")
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
c = conn.cursor()

c.execute("PRAGMA table_info(species_profiles)")
print("COLS:", [r[1] for r in c.fetchall()])

c.execute("SELECT id, species, name_ar, name_en, category FROM species_profiles ORDER BY species")
rows = c.fetchall()
print("COUNT:", len(rows))
for r in rows:
    print(dict(r))

c.execute("SELECT species, ai_support FROM species_profiles WHERE species IN ('Rose','Apple','Tomato')")
for r in c.fetchall():
    print(r["species"], "->", r["ai_support"])

conn.close()