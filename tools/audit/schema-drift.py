import re, subprocess, json
sql = open('Smartodl/database/education_platform.sql', encoding='utf-8', errors='replace').read()
# strip comments, then walk CREATE TABLE blocks
dump = {}
for m in re.finditer(r'CREATE TABLE\s+`([^`]+)`\s*\((.*?)\n\)\s*ENGINE', sql, re.S):
    table, body = m.group(1), m.group(2)
    cols = []
    for line in body.split('\n'):
        line = line.strip()
        cm = re.match(r'`([^`]+)`\s+\w', line)
        if cm:
            cols.append(cm.group(1))
    dump[table] = set(cols)

live = {}
rows = subprocess.run(['mysql','-h','127.0.0.1','-u','smart','-psmart','-N','-s','-e',
  "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='education_platform'"],
  capture_output=True, text=True).stdout.strip().split('\n')
for r in rows:
    t, c = r.split('\t')
    live.setdefault(t, set()).add(c)

print(f'dump tables: {len(dump)}   live tables: {len(live)}')
missing_tables = sorted(set(live) - set(dump))
print('\nLIVE tables missing from the dump:', missing_tables or 'none')
extra = sorted(set(dump) - set(live))
print('DUMP tables missing from live:', extra or 'none')
drift = 0
for t in sorted(set(dump) & set(live)):
    miss = sorted(live[t] - dump[t])
    if miss:
        drift += 1
        print(f'  {t}: live has columns the dump lacks -> {miss}')
print(f'\ntables with column drift: {drift}')

# --- foreign keys: the dump must enforce the same deletion rules as the live DB
def fks(schema):
    out = subprocess.run(['mysql','-h','127.0.0.1','-u','smart','-psmart','-N','-s','-e',
      "SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, DELETE_RULE "
      f"FROM information_schema.REFERENTIAL_CONSTRAINTS rc JOIN information_schema.KEY_COLUMN_USAGE k "
      f"USING (CONSTRAINT_SCHEMA, CONSTRAINT_NAME) WHERE rc.CONSTRAINT_SCHEMA='{schema}'"],
      capture_output=True, text=True).stdout.strip()
    return set(tuple(r.split('\t')) for r in out.split('\n') if r)

live_fk = fks('education_platform')
dump_fk = set()
for m in re.finditer(r'ADD CONSTRAINT `([^`]+)` FOREIGN KEY \(`([^`]+)`\) REFERENCES `([^`]+)` \(`[^`]+`\)( ON DELETE (\w+ ?\w+))?', sql):
    dump_fk.add(('<table?>', m.group(1), m.group(2), m.group(3), m.group(4) or 'RESTRICT'))
dump_fk = {(c, name, col, ref, rule) for (_, name, col, ref, rule) in dump_fk}
live_pairs = {(c, col, ref, rule) for (_t, c, col, ref, rule) in live_fk}
missing = sorted(live_pairs - dump_fk) if False else sorted(p for p in live_pairs if p not in dump_fk)
print('\nFKs in the live DB but not declared in the dump:', missing or 'none')
