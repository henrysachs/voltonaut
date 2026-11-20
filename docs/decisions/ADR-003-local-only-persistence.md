# ADR-003 – Spielfortschritt nur lokal (IndexedDB)

**Status:** ⛔ Ersetzt durch [ADR-005](ADR-005-server-authoritative-accounts-economy.md) (2026-11-19). Henry möchte Accounts, Inventar und Währung auf dem Server. Lokale IndexedDB bleibt als Offline-Cache/Outbox erhalten.

## Kontext

Gamification (XP, Unlocks, PBs, Fahrten) muss ab Tag eins gespeichert werden. Es gibt einen Nutzer (Henry), einen Laptop.

## Entscheidung

Alle Fortschritts- und Fahrtdaten liegen in **IndexedDB** im Browser; kleine Flags in `localStorage`. Versioniertes Schema mit Migrationen. Backup per JSON-Export/-Import. `navigator.storage.persist()` wird angefragt.

## Konsequenzen

- - Kein Server, keine Accounts, keine Datenschutzfragen, offline-fähig.
- − Daten an Browser-Profil gebunden; Löschen der Website-Daten = Verlust → Export-Button prominent, Erinnerung nach jeder 10. Fahrt.
- − Kein Cheat-Schutz (irrelevant solo). Für spätere Leaderboards wäre serverseitige Validierung nötig.

## Alternativen

Supabase/Firebase (Accounts, Sync – unnötig für v1), Sync über den Hetzner-Server aus ADR-004 (möglich ab E8, optional), File System Access API (umständlich).
