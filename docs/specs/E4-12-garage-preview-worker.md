# Spec E4-12 – Garage-Vorschau im Render-Worker

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E4 (Render-Isolation nach E4-04) und E7 (Garage). Korrektur, keine neue Funktion.
- **Status:** Review (PR #154). Unabhängiges Review ohne Codefehler; ADR-032 wartet auf Henrys Freigabe.
  - **Implementiert:** ja (Worker, Link, Port, Loop, Szene, Fehlerhinweis, Dispose).
  - **Am Artefakt softwaregeprüft:** ja. Gesamtgate in CI-Lauf 45832934400 (Head `c3c4f7e`) grün. Lokal nach Rebase auf `d964d6f`: `fmt:check`, `lint`, `typecheck`, `depcruise`, `guard`, Unit-Tests `ui/garage`, `garage-shop.spec.ts:38` einzeln mit Screenshot sowie eine Long-Task-Probe.
  - **An echter Hardware geprüft:** nein.
  - **Bereitgestellt:** nein.
- **Betroffene Module:** `apps/web/src/ui/garage`, Garage-E2E-Fehlerinjektion
- **Entscheidung:** [ADR-032](../decisions/ADR-032-garage-preview-worker.md)

## Ziel

Die Garage-Vorschau rendert in einem eigenen Worker. GL-Wartezeiten der Vorschau blockieren HUD, BLE und Eingaben auf Main nicht mehr. Aussehen und Bedienung der Vorschau bleiben gleich.

## Abnahmekriterien

- [x] AK1 – Main überträgt den Canvas genau einmal vor jedem Kontextzugriff. Nur der Worker besitzt WebGL, three, Avatar und rAF-Loop. (Code; Unit: kein zweiter Startversuch nach Fehler.)
- [x] AK2 – `GaragePreviewView` bleibt unverändert. `garage.ts` und `previewPanel.ts` ändern sich nur um den Fehler-Callback.
- [x] AK3 – Szene, Licht, Boden, Kamera, DPR-Grenze 1,5, Antialiasing, Alpha und Clear-Farbe sind aus dem alten Renderer übernommen. Sichtbarkeit belegt: Screenshot aus `garage-shop.spec.ts:38` (`--workers=1`) und ein Ausschnitt des Vorschau-Hosts zeigen Fahrer und Rad auf dem grünen Boden, nicht schwarz oder leer. Die im Test gewählte Trikotfarbe ist sichtbar, `preview.look` kommt also im Worker an. Kein Pixelvergleich mit dem alten Renderer; Bilder nicht committet.
- [x] AK4 – `AvatarConfig` wird im Worker mit `AvatarConfigSchema` geparst; ungültige Looks führen zum Fehlerzustand. (Unit)
- [x] AK5 – `data-preview-ready` und `aria-busy="false"` erst nach echtem Draw plus folgender Worker-Task. (Unit)
- [x] AK6 – Fehlende Unterstützung, Init-, Worker- und Kontextfehler zeigen „3D nicht verfügbar …“. Kein Main-WebGL-Fallback. (Unit für Link/Loop; E2E mit Fehler im echten Worker grün in CI)
- [x] AK7 – Dispose stoppt Observer sofort, Worker bestätigt, Main terminiert nach ACK oder nach 1 s, genau einmal. (Unit)
- [x] AK8 – `garage-shop.spec.ts`, `garage-purchase.spec.ts`, `garage-loadout.spec.ts`, `menu-layout.spec.ts` und `overlay-states.spec.ts` grün mit unveränderten Assertions (CI-Lauf 45832934400).
- [x] AK9 – Long-Task-Messung nach der Änderung zeigt keine Mehrsekunden-Tasks bei offener Garage. Eine kurze Probe ohne künstliche Last (siehe Nachweise). Die Messung unter Last bleibt in E0-16 offen.
- [x] AK10 – Gesamtgate `mise run check` grün (CI-Lauf 45832934400, Job `check`).

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
- **Nachher (Branch nach Rebase auf `d964d6f`):** dieselbe Probe, ein Lauf, `--workers=1`, ohne künstliche Last, Maschinenlast ~9–12: 0 Long Tasks in 5 s, 293 Frames. Ein Einzelpaar unter verschiedener Fremdlast (vorher ~34–58, nachher ~9–12) ist kein sauberer Vergleich. Belegt ist nur, dass nachher bei offener Garage keine Long Tasks auf Main auftraten.
- **Unter Last nachher:** nicht gemessen; in E0-16 offen.

## Nicht-Ziele

Keine Änderung an Auto-Rotation, Bildrate, Grafikqualität, Fahrtwelt-Worker, Physik, BLE oder Aufnahmen.

## Offene Fragen / Risiken

- Asynchrone Fehlererkennung: Die Garage wechselt erst nach Worker-Antwort in `unavailable3d`.
- Die Zahl der GL-Kontexte bleibt gleich (der Garage-Kontext wechselt von Main in den Worker). Zusätzlich kostet nur der Worker-Thread. Das Garage-Panel wird beim Start montiert und lebt die ganze Sitzung. Auf schwacher Hardware nicht gemessen.
- `dispose` wird in Produktion nicht aufgerufen, wie schon vor dieser Änderung. Ein Aufrufer ist ein Folgeschritt.
- Kontextverlust der Vorschau hat keinen eigenen E2E-Test.

## Doku-Updates

- [x] ADR-032 und ADR-Index
- [x] E0-16 Garage-Abschnitt verweist auf diese Spec
- [ ] Roadmap-Checkbox (erst nach CI und Review)
