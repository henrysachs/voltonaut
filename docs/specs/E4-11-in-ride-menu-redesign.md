# Spec E4-11 – Fahrtmenü-Layout und visuelles System

- **Auftrag:** [Issue #118](https://github.com/henrysachs/voltonaut/issues/118), Präzisierung vom 25.11.2026.
- **Roadmap-Bezug:** E4, Spiel-HUD und Ingame-Menü aus `docs/04-world-3d.md` §9.
- **Basis:** `ff6b011`.
- **Status:** Implementiert, am tatsächlich gebauten Artefakt softwaregeprüft, unabhängig reviewed und PR-CI grün. Merge und Bereitstellung stehen noch aus.
- **Betroffene Module:** `apps/web/index.html`, `src/styles.css`, neue `src/styles/tokens.css`, `src/ui/gameMenu.ts`, Button-Erzeuger in `src/ui`, Playwright- und Vitest-Prüfungen.

## Ziel

Fahrtmenü, Gerätedialog und Garage nutzen von 320 bis 1440 px ein gemeinsames visuelles System. Tabs und Inhalte bleiben vollständig erreichbar. Die Fußzeile überdeckt keinen Inhalt. Fahrt, Geräte und Aufnahme laufen bei geöffnetem Menü weiter.

## Gewählte Form

Zwei DOM-Formen wurden geprüft.

1. **Spielmodus im Kopfbereich.** Der Modus behält seine globale Position und teilt sich eine Rasterzeile mit Überschrift und Hinweis. Bei kleinen Höhen verbraucht er dauerhaft Innenraum.
2. **Spielmodus im Profil-Tab.** Der Modus wandert in den standardmäßig ausgewählten Profil-Tab. Kopf, Tabs, scrollender Inhalt und Fußzeile bilden vier Rasterzeilen. Variable Inhalte liegen vollständig im scrollenden Bereich.

Form 2 wird gewählt. Der native Dialog, der Fokus-Loop, `closedby="any"` und die vorhandenen Tab-IDs bleiben unverändert. `MenuTab` bleibt die einzige Navigationsdatenform. Das Scroll-Layout-Attribut `data-scrollable` ist abgeleiteter UI-Zustand und gehört weiterhin zu `ui/gameMenu.ts`.

Eigene CSS-Custom-Properties und Container-Queries ersetzen keine Abhängigkeit. Henry hat diese Empfehlung in Issue #118 bestätigt. Ein ADR ist nach AGENTS.md Regel 3 nicht nötig. Der Glas-Effekt bleibt auf Menü und Gerätedialog begrenzt. Das HUD nutzt die deckende Fläche, damit die WebGL-Fläche nicht mit mehreren Blur-Ebenen belastet wird.

## Abnahmekriterien

- [x] AK1 – Gemeinsame Tokens für Abstände, Typografie, Radien, Flächen, Text, Aktionen und Bewegung sind in `src/styles/tokens.css` definiert. Die vorhandenen `--cockpit-*`-Werte sind Aliase.
- [x] AK2 – Primäre, sekundäre und Gefahr-Buttons sind unterscheidbar. `:disabled` und `[aria-disabled="true"]` haben dieselbe Cursor- und Opacity-Darstellung. Hover verändert beide nicht. Der Fokusring bleibt sichtbar. `aria-busy="true"` ist dargestellt.
- [x] AK3 – Der Dialog nutzt `grid-template-rows: auto auto minmax(0, 1fr) auto`. Die Fußzeile liegt nie über dem Inhalt.
- [x] AK4 – Unter 480 px Dialogbreite brechen die sechs Tabs in zwei Zeilen um. Ab 480 px stehen sie in einer Zeile. Jeder Tab ist bei 320, 390, 768 und 1440 px vollständig sichtbar und erreichbar.
- [x] AK5 – Dialog und Inhaltsbereich haben keine horizontale Überläufe. Das Feld `Spielmodus` bleibt innerhalb seines Profil-Tabs.
- [x] AK6 – Bei Überlauf zeigt der Inhaltsbereich `data-scrollable="true"` und eine sichtbare Schattenkante. Tabwechsel beginnen am Inhaltsanfang.
- [x] AK7 – Glasflächen nutzen `backdrop-filter`. Ohne Unterstützung und bei reduzierter Transparenz greift eine deckende Fläche. Die Textpaare erreichen gegen Glas, deckende und erhöhte Fläche mindestens 4,5:1.
- [x] AK8 – Menü und Tabwechsel nutzen kurze Animationen. Bei `prefers-reduced-motion: reduce` entfallen sie.
- [x] AK9 – Gerätedialog und Garage verwenden dieselben Tokens und Button-Varianten. Native Geräteauswahl und bestehende Fokuswege bleiben unverändert.
- [x] AK10 – Der neue E2E-Test prüft alle sechs Tabs als Gast und angemeldet bei 320, 390, 768 und 1440 px. Screenshots aller Tabs bei 390 und 1440 px werden als Test-Anhänge erzeugt.
- [x] AK11 – Bestehende Menü-, Spielmodus-, Garage-, Konto-, WebGL- und Render-Worker-Tests bleiben unverändert grün. Distanz und Renderbudget laufen bei offenem Menü weiter.
- [x] AK12 – `mise run check` und Build sind grün. Ein zweiter Agent reviewt gegen diese Spec und `docs/specs/_review-checklist.md`.

## Testplan

| AK      | Ebene                       | Datei oder Prüfung                                                                                                                           |
| ------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, 2, 7 | Vitest                      | `apps/web/src/styles/tokens.test.ts`                                                                                                         |
| 2       | DOM-Test                    | Busy-Zustände in `apps/web/src/ui/accountDataPanel.test.ts`                                                                                  |
| 3–6, 10 | Playwright, echte Sim-App   | Neuer `apps/web/e2e/menu-layout.spec.ts` und `apps/web/e2e/menu-scroll.spec.ts`                                                              |
| 2, 8, 9 | Playwright, echte Sim-App   | Button-Zustände, reduzierte Bewegung und Gerätedialog                                                                                        |
| 11      | Bestehende Playwright-Suite | `game-menu.spec.ts`, `fun-mode.spec.ts`, `garage-shop.spec.ts`, `account-data.spec.ts`, `webgl-unavailable.spec.ts`, `render-worker.spec.ts` |
| 12      | Repository-Gate und Review  | `mise run check`, `mise run build`, zweiter Agent                                                                                            |

## Nicht-Ziele

Kein neues Framework, keine neue Bibliothek, keine neuen Menüinhalte und keine Umbenennung von Tabs oder Rollen. Keine Änderung an Physik, Trainersteuerung, BLE, Aufnahmeprotokoll, Aufnahme-State oder API. Die Aufnahme-Schaltflächen erhalten nur `aria-busy`. Keine visuellen Baselines und keine Produktionsbereitstellung.

## Offene Fragen und Risiken

Die Bildrate mit `backdrop-filter` muss auf echter Hardware gemessen werden. Bis dahin gilt der Glas-Look als softwaregeprüft, Hardwareabnahme offen. Screenshots dienen Henrys Sichtprüfung und ersetzen keine freigegebenen visuellen Baselines.

## Doku-Updates

- [x] `docs/04-world-3d.md` beschreibt Tokens, Glas-Look, Raster und Fallbacks.
- [x] `docs/07-roadmap.md` nennt den begrenzten Teilschritt.
- [x] Kein ADR, weil keine Abhängigkeit und keine Leitplankenänderung hinzukommt.

## Nachweisstatus

- Implementiert: ja. Menü, Gerätedialog und Garage nutzen gemeinsame Tokens und Button-Zustände. Navigation, Fokus, native Geräteauswahl und State-Ownership bleiben unverändert.
- Am tatsächlichen Artefakt softwaregeprüft: ja. 48 Layoutfälle, ein Scroll-Reset-Fall, fünf Overlay-Fälle, 138 E2E-Tests, 1936 Unit-Tests, Coverage, Typecheck, Lint, Dependency-Cruiser, Guard und Produktionsbuild bestehen. 24 Nachher-Screenshots wurden geprüft. Die früheren Arbeitsstandsbilder bleiben interne Artefakte und sind kein reproduzierbarer Base-Vergleich.
- Unabhängiges Review (26.11.2026): Der Hover-Test aus #117 prüfte wegen der 200-ms-Farbübergänge nichts und läuft jetzt mit reduzierter Bewegung; ohne die `aria-disabled`-Ausnahme wird er rot. Der Gerätedialog bekam die Glasfläche nie, weil die spätere solide Dialogregel sie überschrieb, zahlte aber den Blur; die Glasregeln stehen jetzt danach und haben einen eigenen E2E-Fall. Tabs trennen nicht mehr mitten im Wort. Nach #137 tragen Garage-, Ausrüsten- und Verwerfen-Knöpfe die gemeinsamen Button-Varianten.
- An echter Hardware geprüft: nein. Echte GPU-FPS mit Glas-Look und die gemeinsame Hardwareabnahme bleiben offen.
- Bereitgestellt: nein. PR, CI, Merge und Produktionsdeploy sind getrennte Schritte.
