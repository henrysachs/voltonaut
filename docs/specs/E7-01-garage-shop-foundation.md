# Spec E7-01: Garage- und Shop-Fundament

- **Roadmap-Bezug:** `docs/07-roadmap.md`, E7, Teil der Checkbox „Garage-Showroom … Shop mit Preisen in ⚡, gesperrte Items mit Bedingung"
- **Status:** Review
- **Betroffene Module:** `packages/shared`, `packages/rules`, `apps/web/src/avatar`, `apps/web/src/ui/garage`, `apps/web/src/ui/gameMenu.ts`

## Ziel

Der Nutzer kann im bestehenden Fahrtmenü Garage- und Shop-Items nach Slot durchsehen, eine provisorische Fahrer- und Radvorschau ändern und Freischaltbedingung sowie Preis lesen. Käufe bleiben ausdrücklich deaktiviert, weil Server-Inventar und Volts-Buchung fehlen.

## Abnahmekriterien (aus der Roadmap übernommen und präzisiert)

- [x] AK1: Strikte Shared-Schemas für `AvatarSlot`, `UnlockRule`, `ItemDef`, `AvatarConfig` und `GarageSelection` legen gültige Slots, Farben, Farbanzahl, Preise und Auswahlzustände fest. Unbekannte Felder und Kontoangaben werden verworfen.
- [x] AK2: Der Start-Katalog in `packages/rules` nutzt diese Typen, enthält die dokumentierten Slots und Item-Zahlen, hat eindeutige IDs und eine gültige Standardkonfiguration.
- [x] AK3: Der neue Menü-Tab „Garage / Shop" ist per Tastatur und Lichtdismiss erreichbar. Slot-, Rotations- und Farbziele haben mindestens 44 px Trefferfläche. Fahrt, Geräte, Profil, Aufnahmen, Konto und Strava behalten ihre bisherigen Zuständigkeiten.
- [x] AK4: Slot- und Item-Auswahl aktualisiert die provisorische 3D-Vorschau. Beide Trikotfarben und die Designvariation sind sichtbar. Farbwahl, Seltenheit, Freischaltbedingung und optionaler Volts-Preis sind sichtbar. Gesperrte Items lassen sich als Vorschau ansehen.
- [x] AK5: Jeder Kauf ist deaktiviert und als nicht verfügbar bezeichnet. Die Oberfläche zeigt keinen Kontostand und schreibt keine Volts, keinen Besitz und keine Konfiguration dauerhaft.
- [x] AK6: Fehlt WebGL, bleibt die Oberfläche bedienbar und zeigt den getrennten Zustand „3D nicht verfügbar". Die Vorschau respektiert reduzierte Bewegung.
- [x] AK7: Shared-, Rules- und Web-Unit-Tests sowie gezielte Playwright-Menütests belegen die Kriterien. Screenshots dokumentieren die tatsächlich gebaute Oberfläche.

## Testplan (`docs/10-testing.md`)

| AK  | Ebene           | Datei / Fixture                                                            |
| --- | --------------- | -------------------------------------------------------------------------- |
| AK1 | Contract / Unit | `packages/shared/src/avatarCatalog.test.ts`                                |
| AK2 | Unit            | `packages/rules/src/avatarCatalog.test.ts`                                 |
| AK3 | E2E             | `apps/web/e2e/garage-shop.spec.ts`, `apps/web/e2e/game-menu.spec.ts`       |
| AK4 | Unit / E2E      | `apps/web/src/ui/garage/state.test.ts`, `apps/web/e2e/garage-shop.spec.ts` |
| AK5 | Unit / E2E      | `apps/web/src/ui/garage/state.test.ts`, `apps/web/e2e/garage-shop.spec.ts` |
| AK6 | Unit / E2E      | `apps/web/src/ui/garage/state.test.ts`, `apps/web/e2e/garage-shop.spec.ts` |
| AK7 | Dokumentation   | Screenshots aus dem Playwright-Test                                        |

## Nicht-Ziele

Keine Server-Endpunkte, Datenbank, Kontosynchronisierung, echte Käufe, Belohnungsbuchung, Strava-Änderung oder finale Blender-Assets. Keine neue Abhängigkeit und keine Änderung an Leitplanken.

## Offene Fragen / Risiken

Die provisorische Geometrie zeigt nicht jedes Detail der späteren Slot-Assets. Sie ist als Vorschau gekennzeichnet. Server-Besitz, Preistransaktionen und dauerhaftes Ausrüsten folgen erst mit Inventar und Economy.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Roadmap-Text aktualisiert. Die vollständigen E7-Checkboxen bleiben offen.
- [x] `docs/05-avatar-customization.md` aktualisiert.
- [x] Keine ADR nötig.

## Nachweis

- Implementiert: strikter Katalog, Startdaten, UI-Zustand, provisorische 3D-Vorschau und Menüintegration.
- Am tatsächlichen Artefakt softwaregeprüft: 50 Unit-Tests und 12 Garage- und Menü-E2E-Tests grün. Oxfmt, typbewusster Oxlint, `tsc -b`, die direkte Shared-Test-Typprüfung und dependency-cruiser grün.
- An echter Hardware geprüft: nein, keine Hardwarefunktion betroffen.
- Bereitgestellt: nein, kein Commit, Merge oder Deploy in diesem Auftrag.

Erfolgreiche Befehle:

```sh
mise run install
pnpm exec oxfmt --check .
mise run lint
pnpm exec tsc -b --pretty false
mise run depcruise
pnpm --filter @voltonaut/shared exec vitest run src/avatarCatalog.test.ts
pnpm exec tsc --ignoreConfig --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --noImplicitReturns --noFallthroughCasesInSwitch --noPropertyAccessFromIndexSignature --noUnusedLocals --noUnusedParameters --verbatimModuleSyntax --isolatedModules --types node packages/shared/src/avatarCatalog.test.ts
pnpm --filter @voltonaut/rules exec vitest run src/avatarCatalog.test.ts
pnpm --filter @voltonaut/web exec vitest run src/ui/garage/state.test.ts src/ui/garage/garageText.test.ts src/avatar/customize.test.ts src/avatar/look.test.ts src/avatar/motion.test.ts
CI=1 E2E_PORT=5196 pnpm --filter @voltonaut/web exec playwright test e2e/garage-shop.spec.ts e2e/game-menu.spec.ts --workers=1
```

Screenshots:

- [Desktop-Vorschau](E7-01/garage-shop.png)
- [Vorschau ohne WebGL](E7-01/garage-shop-no-webgl.png)
- [Mobile Trefferflächen](E7-01/garage-shop-small.png)

Das vollständige E2E-Gate und Mutation liefen nicht. Der Auftrag überlässt diese Integrationprüfungen der übergeordneten Session.
