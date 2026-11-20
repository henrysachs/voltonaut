# ADR-012 – `skipLibCheck: true` nur für `apps/server`

**Status:** Angenommen (2026-11-20, Henry per Chat freigegeben)

## Kontext

`drizzle-orm` liefert seit Version 0.29.0 `.d.ts`-Dateien, die mit `skipLibCheck: false` und TypeScript 6.0.3 nicht kompilieren. Getestet wurden:

- `drizzle-orm@0.30.0`
- `drizzle-orm@0.29.0`
- `drizzle-orm@0.45.4`
- `drizzle-orm@1.0.0-rc.5`

Alle scheitern unabhängig vom eigenen Anwendungscode an Deklarationsfehlern in `mysql-core`, `pg-core`, `sqlite-core` und `session.d.ts`. Der eigene Server-Code bleibt sauber.

## Entscheidung

1. `apps/server/tsconfig.json` setzt ab jetzt `skipLibCheck: true`.
2. Alle anderen Pakete und die Root-Konfiguration bleiben bei `skipLibCheck: false`.
3. Der Guard erlaubt `skipLibCheck` ausschließlich für `apps/server/tsconfig*.json`.
4. Der Guard verlangt für `apps/server` jetzt ausdrücklich `skipLibCheck: true`.
5. Die Ausnahme wird zurückgenommen, sobald Drizzle oder TypeScript eine Version liefern, die ohne sie kompiliert.

## Konsequenzen

- + Der Server-Code bleibt streng geprüft.
- + Drizzle-Updates bleiben möglich.
- − Bibliothekstypen werden in `apps/server` nicht geprüft.
- − Die Ausnahme ist bewusst eng begrenzt und im Guard kodiert.

## Alternativen

- ORM wechseln: größerer Umbau, verworfen.
- Auf ein Drizzle-Update warten: blockiert E5 unbestimmt, verworfen.
- `skipLibCheck` global aktivieren: verworfen, weil zu breit.
