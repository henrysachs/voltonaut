# Spec E10-09 – Voltonaut als installierbare PWA

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E10, Checkbox „Installierbare PWA" ([Issue #88](https://github.com/henrysachs/voltonaut/issues/88)).
- **Status:** Implementiert und softwaregeprüft am gebauten Artefakt. Installation und Standalone-Start auf Desktop und Android, Hardware und Bereitstellung offen.
- **Betroffene Module:** `apps/web` (`public/manifest.webmanifest`, `public/icons/`, `src/pwa/`, `vite.config.ts`, `index.html`, Menü-Tab „App"). Keine neue Abhängigkeit, keine geschützte Datei geändert.

## Ziel

Voltonaut lässt sich auf unterstützten Geräten installieren und startet im eigenen Fenster. Die App-Oberfläche lädt offline aus einem versionierten Cache. Fahrt-, Konto- und Gerätedaten werden nie zwischengespeichert.

## Entwurf

- **Manifest:** `id`/`start_url`/`scope` `/`, `display: standalone`, Theme-/Hintergrundfarbe `#0c201e`, PNG-Icons 192/512 (`any`) und 512 (`maskable`), SVG-Icon, Apple-Touch-Icon.
- **Service Worker** (`src/pwa/serviceWorker.ts`, vom Build als `/sw.js` ausgeliefert): Der Vite-Build-Plugin trägt Release-Version (Hash aus `index.html`, den Namen der Build-Dateien und den Bytes aller Dateien in `public/`, also Manifest, Icons und Modelle) und die Precache-Liste ein. Cache heißt `voltonaut-shell-<version>`; beim Aktivieren werden ältere Shell-Caches gelöscht.
- **Allowlist statt Blocklist** (`src/pwa/cachePolicy.ts`): Nur gleiche Herkunft, nur GET. Navigation zu `/` und `/index.html` (auch mit Query wie `?sim=1`) liefert die gecachte Shell. `/assets/*`, `/icons/*` und das Manifest ohne Query kommen aus dem Cache, später geladene Dateien (z. B. `.glb`) werden zur Laufzeit in denselben versionierten Cache gelegt. **Alles andere** geht unverändert ans Netz: API-Herkunft, Authentifizierungs- und Strava-Seiten, Debug-Seiten, POST, Anfragen mit Query.
- **Kontrolliertes Update:** Kein `skipWaiting` und kein automatisches Neuladen. Eine neue Version wartet; im Menü „App" erscheint „Jetzt aktualisieren". Erst der Klick aktiviert sie und lädt neu. Der Hinweis nennt, dass das eine laufende Aufnahme verwirft.
- **Hard Reload** (Menü „App", `src/pwa/hardReload.ts`): Auch ohne wartendes Update verfügbar. Ausdrückliche Bestätigung („Ja, jetzt neu laden" / „Abbrechen") vor dem Unterbrechen von Fahrt und Aufnahme; Abbrechen ändert nichts. Danach werden nur die eigene Service-Worker-Registrierung (Scope `/` und Skript `/sw.js`; Registrierungen anderer Anwendungen derselben Herkunft bleiben) und Caches mit Präfix `voltonaut-shell-` entfernt, das Dokument per `fetch(..., {cache: "reload"})` frisch geholt und neu geladen. localStorage, IndexedDB (Aufnahmen, Kontodaten) und fremde Caches bleiben unberührt. Ergänzende Pflichtanforderung aus dem PR-Kommentar von Henry.
- **Registrierung** nur in Produktionsbuilds (`import.meta.env.PROD`). Dev-Server und E2E im Sim-Modus bleiben ohne Service Worker.
- **Menü „App"** (`src/pwa/pwaPanel.ts`): Installationsschaltfläche bei `beforeinstallprompt`, Hinweise für Desktop, Android und iOS, Offline-Verhalten, Web-Bluetooth-Grenzen.

## Abnahmekriterien

- [x] AK1 – Manifest und Icons erfüllen die Installierbarkeitsanforderungen (Name, Start-URL, Standalone, 192/512-PNG, maskable). Die Dateien liegen im Build, jede Icon-Datei existiert.
- [ ] AK2 – Installation und Standalone-Start auf Desktop und Android sind geprüft. **Offen**, braucht echte Geräte.
- [x] AK3 – Offline-Reload lädt die App-Shell (HUD, Menü) aus dem Cache. Fremde Herkunft (API) wird nie aus dem Cache beantwortet.
- [x] AK4 – Sessions, Tokens, Fahrten, Puls und Checkpoints liegen nicht im Cache. Ein echter Chromium-Lauf gegen den Build prüft, dass Cache Storage nach einer Anfrage mit `Authorization` an eine andere Herkunft ausschließlich Dateien der eigenen Herkunft enthält.
- [x] AK5 – Updates warten auf ausdrückliche Bestätigung. Alte Shell-Caches werden beim Aktivieren gelöscht.
- [x] AK6 – Dokumentation der Web-Bluetooth-Plattformgrenzen (`docs/02-bluetooth.md` §1, Menü „App").
- [x] AK8 – Hard Reload im App-Menü mit Bestätigung; Abbrechen verändert nichts; lädt neue Version trotz aktivem Service Worker und altem Cache; gespeicherte Daten (localStorage, IndexedDB, fremde Caches) bleiben. Belegt am gebauten Client in `pwa.build.test.ts` (alte Shell, neue Release-Marke, Daten vorher/nachher).
- [x] AK7 – Format, Lint, Typecheck, depcruise, guard, 1201 Unit-Tests und alle 67 E2E-Tests lokal grün (einzeln ausgeführt, nicht über `mise`). Exakte Head-CI bleibt bindend.

## Testplan (`docs/10-testing.md`)

| AK       | Ebene                  | Datei                                                                                |
| -------- | ---------------------- | ------------------------------------------------------------------------------------ |
| AK1, AK3 | Build + Chromium       | `apps/web/src/pwa/pwa.build.test.ts` (Build, Registrierung, Offline-Reload)          |
| AK3, AK4 | Unit mit Fake-Cache    | `apps/web/src/pwa/cachePolicy.test.ts`, `shellWorker.test.ts` (ohne `vi.mock`)       |
| AK4      | Build + Chromium       | `pwa.build.test.ts` (Cache-Inhalt nach Anfrage mit Token an fremde Herkunft)         |
| AK5      | Build (zwei Versionen) | `pwa.version.build.test.ts` (nur Icon bzw. Manifest geändert ⇒ anderes `sw.js`)      |
| AK8      | Build + Chromium       | `pwa.build.test.ts`, `hardReload.test.ts` (Reihenfolge, nur eigene Caches)           |
| AK6      | Unit                   | `installHints.test.ts` (Plattformerkennung, Bluetooth-Hinweise für alle Plattformen) |
| AK7      | Gesamtgate             | `mise run check`                                                                     |

## Nachweisstand

| Aussage                                         | Stand                           |
| ----------------------------------------------- | ------------------------------- |
| Manifest, Service Worker, Menü implementiert    | ja                              |
| Am gebauten Artefakt softwaregeprüft (Chromium) | ja, `pwa.build.test.ts`         |
| Installation/Standalone an echtem Gerät geprüft | **nein**, Hardwareabnahme offen |
| Bereitgestellt                                  | nein                            |

## Nicht-Ziele

Keine native App, keine Push- oder Hintergrundsynchronisation, keine Umgehung von Web-Bluetooth-Limits, kein Offline-Fahrbetrieb mit Kontodaten. Keine Workbox oder `vite-plugin-pwa` (ADR-026).

## Offene Fragen / Risiken

- ⚠️ Web Bluetooth in der installierten PWA (Chrome Desktop/Android) ist laut Plattformdokumentation verfügbar, aber an Henrys Trainer **nicht** verifiziert.
- Cloudflare Pages liefert `index.html` und `sw.js` mit Revalidierung; ob die Installation dort identisch funktioniert, zeigt erst der Deploy.
- Bei Releases ohne Änderung an `index.html` und Build-Dateinamen bleibt die Version gleich; Hash-Namen ändern sich mit jedem Inhalt, daher unkritisch.

## Doku-Updates

- [x] Roadmap-Checkbox · [x] `docs/02-bluetooth.md` · [x] ADR-026
