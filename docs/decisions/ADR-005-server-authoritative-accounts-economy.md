# ADR-005 – Server-autoritative Accounts & Ökonomie, offline-first Client

**Status:** Angenommen (2026-11-19). Ersetzt ADR-003.

## Kontext
Henry will Accounts auf dem eigenen Server, auf denen freigeschaltete Räder, Laufräder und Kleidung, XP/Level und eine Ingame-Währung (**Volts**, ⚡) hinterlegt sind – geräteübergreifend und mit Freunden vergleichbar. Gleichzeitig soll Solo-Fahren ohne Server (Sim-Modus, Offline, frühe Etappen) immer funktionieren.

## Entscheidung
1. **Server ist autoritativ** für: Account, Rider-Profil, Inventar, Volts-Ledger, XP/Level, Badges, PBs, Fahrt-Zusammenfassungen.
2. **Client ist offline-first:** IndexedDB-Cache dieser Daten + **Outbox** für abgeschlossene Fahrten (idempotent per `rideId`-UUID). Fahren geht immer; Vergabe von XP/Volts wird erst nach Server-Bestätigung „echt".
3. **Vergabe nur serverseitig:** Der Server berechnet XP, Volts, Badges und PBs aus den hochgeladenen 1-Hz-Samples neu (gemeinsamer Code in `shared/`) und führt **Plausibilitätsprüfungen** durch (`08-backend.md`). Client-Angaben sind nur Vorschau.
4. **Käufe nur online** als atomare DB-Transaktion; Volts als Ledger (nie überschreiben).
5. **Gastmodus:** ohne Account fahrbar; lokale Fahrten können innerhalb 30 Tagen nach Registrierung nachgereicht werden.
6. Auth v1: E-Mail-Magic-Link + Bearer-Session-Token; Passkeys als v2.

## Konsequenzen
- + Fortschritt geht nicht mit Browserdaten verloren; mehrere Geräte möglich; Grundlage für Gruppenfahrten und Vergleiche.
- + Ökonomie ist manipulationsresistenter als rein lokal (Gelegenheits-Cheats werden erkannt).
- − Betrieb eines Servers mit personenbezogenen Daten (E-Mail, Fahrtdaten): DSGVO-Pflichten (Export, Löschung, Datenschutzhinweis), Backups, Sicherheit.
- − Mehr Komplexität: Sync, Outbox, vorläufige vs. bestätigte Werte, API-Versionierung.
- − Anti-Cheat bleibt begrenzt: ohne signierte Hardware-Daten sind plausible Fake-Daten nicht erkennbar.

## Alternativen
- Lokal-only (ADR-003): einfach, aber kein Inventar/Account über Geräte, keine soziale Ebene. Ersetzt.
- Client-autoritativ mit Server-Sync: einfacher, aber Währung trivial manipulierbar.
- BaaS (Supabase/Firebase): schnell, aber zweite Plattform neben dem vorhandenen VPS und weniger Kontrolle.
- Cloudflare Durable Objects/D1: siehe ADR-004, nicht gewählt.
