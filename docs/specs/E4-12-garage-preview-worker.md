# Spec E4-12 – Garage-Vorschau im Render-Worker

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E4 (Render-Isolation nach E4-04) und E7 (Garage). Korrektur, keine neue Funktion.
- **Status:** In Arbeit (Draft-PR).
  - **Implementiert:** ja, Mindestfassung (Worker, Link, Port, Loop, Szene, Fehlerhinweis, Dispose).
  - **Am Artefakt softwaregeprüft:** teilweise. Lokal nur `fmt:check`, `lint`, `typecheck`, `depcruise` und gezielte Unit-Tests. Playwright und Gesamtgate laufen erst in der CI des PRs.
  - **An echter Hardware geprüft:** nein.
  - **Bereitgestellt:** nein.
- **Betroffene Module:** `apps/web/src/ui/garage`, Garage-E2E-Fehlerinjektion
- **Entscheidung:** [ADR-032](../decisions/ADR-032-garage-preview-worker.md)

## Ziel

Die Garage-Vorschau rendert in einem eigenen Worker. GL-Wartezeiten der Vorschau blockieren HUD, BLE und Eingaben auf Main nicht mehr. Aussehen und Bedienung der Vorschau bleiben gleich.

## Abnahmekriterien

- [x] AK1 – Main überträgt den Canvas genau einmal vor jedem Kontextzugriff. Nur der Worker besitzt WebGL, three, Avatar und rAF-Loop. (Code; Unit: kein zweiter Startversuch nach Fehler.)
- [x] AK2 – `GaragePreviewView` bleibt unverändert. `garage.ts` und `previewPanel.ts` ändern sich nur um den Fehler-Callback.
- [x] AK3 – Szene, Licht, Boden, Kamera, DPR-Grenze 1,5, Antialiasing, Alpha und Clear-Farbe sind aus dem alten Renderer übernommen. (Code-Review; visueller Vergleich offen.)
- [x] AK4 – `AvatarConfig` wird im Worker mit `AvatarConfigSchema` geparst; ungültige Looks führen zum Fehlerzustand. (Unit)
- [x] AK5 – `data-preview-ready` und `aria-busy="false"` erst nach echtem Draw plus folgender Worker-Task. (Unit)
- [x] AK6 – Fehlende Unterstützung, Init-, Worker- und Kontextfehler zeigen „3D nicht verfügbar …“. Kein Main-WebGL-Fallback. (Unit für Link/Loop; E2E offen in CI)
- [x] AK7 – Dispose stoppt Observer sofort, Worker bestätigt, Main terminiert nach ACK oder nach 1 s, genau einmal. (Unit)
- [ ] AK8 – `garage-shop.spec.ts`, `garage-purchase.spec.ts`, `garage-loadout.spec.ts`, `menu-layout.spec.ts` und `overlay-states.spec.ts` grün mit unveränderten Assertions. Offen: nur in CI.
- [ ] AK9 – Long-Task-Messung nach der Änderung zeigt keine Mehrsekunden-Tasks bei offener Garage. Offen.
- [ ] AK10 – Gesamtgate `mise run check` grün. Offen: CI.

## Testplan

| AK            | Ebene | Datei                                                                                  |
| ------------- | ----- | -------------------------------------------------------------------------------------- |
| AK1, AK6, AK7 | Unit  | `apps/web/src/ui/garage/previewLink.test.ts`                                           |
| AK4–AK7       | Unit  | `apps/web/src/ui/garage/previewLoop.test.ts`                                           |
| AK6, AK8      | E2E   | `e2e/garage-shop.spec.ts`, `e2e/garage-loadout.spec.ts` (Fehler im echten Worker)      |
| AK8           | E2E   | `e2e/garage-purchase.spec.ts`, `e2e/menu-layout.spec.ts`, `e2e/overlay-states.spec.ts` |
| AK9           | E2E   | temporäre `longtask`-Probe, nicht committet                                            |

Die beiden Fehler-E2Es injizierten bisher `getContext → null` auf Main. Main erzeugt keinen GL-Kontext mehr, deshalb trifft die Injektion jetzt den echten Preview-Worker (`previewWorkerPrelude`). Die Assertions bleiben unverändert.

## Nachweise

- **Vorher (origin/main `e8818a2`):** eine einzelne Long-Task-Probe ohne künstliche Last, Maschine bei Load ~34–58, `--workers=1`: 22 Long Tasks in 5 s, längste 459 ms, Summe 3115 ms, 120 Frames, keine über 1 s.
- **Unter Last (PR #144):** main 10/10 rot; WebGL auf Main abgeschaltet 10/10 grün. Nicht erneut lokal reproduziert (Henrys Anweisung: Rechner ausgelastet).
- **Nachher:** offen. Keine lokale Playwright-Messung nach der Änderung.

## Nicht-Ziele

Keine Änderung an Auto-Rotation, Bildrate, Grafikqualität, Fahrtwelt-Worker, Physik, BLE oder Aufnahmen.

## Offene Fragen / Risiken

- Asynchrone Fehlererkennung: Die Garage wechselt erst nach Worker-Antwort in `unavailable3d`.
- Ein zweiter Worker mit eigenem GL-Kontext neben dem Fahrtwelt-Worker. Auf schwacher Hardware nicht gemessen.
- Kontextverlust der Vorschau hat keinen eigenen E2E-Test.

## Doku-Updates

- [x] ADR-032 und ADR-Index
- [x] E0-16 Garage-Abschnitt verweist auf diese Spec
- [ ] Roadmap-Checkbox (erst nach CI und Review)
