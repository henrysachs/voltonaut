# Spec <Etappe>-<Nr> – <Titel>

- **Roadmap-Bezug:** `docs/07-roadmap.md` → <Etappe>, Checkbox „…"
- **Status:** Entwurf | In Arbeit | Review | Erledigt
- **Betroffene Module:** z. B. `packages/ble`, `apps/web/src/ui` (modulübergreifend erlaubt; Grenzen prüft dependency-cruiser)

## Ziel

Ein bis drei Sätze: Was kann der Nutzer danach, was vorher nicht ging?

## Abnahmekriterien (aus der Roadmap übernommen und präzisiert)

- [ ] AK1 – messbar, z. B. „100 RS-Drücke aus Fixture `play-fw1.3.1-…json` ⇒ genau 100 `shiftUp`"
- [ ] AK2 – …

## Testplan (`docs/10-testing.md`)

| AK  | Ebene      | Datei / Fixture                                      |
| --- | ---------- | ---------------------------------------------------- |
| AK1 | BLE-Replay | `packages/ble/src/zwift-play/adapter.replay.test.ts` |

## Nicht-Ziele

## Offene Fragen / Risiken

## Doku-Updates (Pflicht beim Abschluss)

- [ ] Roadmap-Checkbox · [ ] betroffene `docs/*.md` · [ ] ADR (falls Entscheidung/Leitplanke/Abhängigkeit)
