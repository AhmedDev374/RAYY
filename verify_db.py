import sqlite3, os, json

db_path = os.path.join("backend", "data", "app.db")
conn = sqlite3.connect(db_path)
c = conn.cursor()

c.execute("PRAGMA table_info(species_profiles)")
print("COLS:", [r[1] for r in c.fetchall()])

c.execute("SELECT id, species, name_ar, category FROM species_profiles ORDER BY species")
rows = c.fetchall()
print("COUNT:", len(rows))
for r in rows:
    print(r)

conn.close()