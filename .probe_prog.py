import sqlite3, time
c = sqlite3.connect("saring.db")
c.row_factory = sqlite3.Row
rows = c.execute("""
    select created_at, kind, message from workflow_events
    where kind like 'analysis%' and message like '%requirement%'
    order by created_at desc limit 12
""").fetchall()
now = time.time()
for r in reversed(rows):
    print("%6.1f s ago  %-20s %s" % (now - r["created_at"], r["kind"], r["message"][:100]))
latest = c.execute("""
    select created_at, kind, message from workflow_events order by created_at desc limit 5
""").fetchall()
print("--- latest events ---")
for r in reversed(latest):
    print("%6.1f s ago  %-22s %s" % (now - r["created_at"], r["kind"], r["message"][:90]))
