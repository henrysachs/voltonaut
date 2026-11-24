# ADR-025 – Handgeschriebener Service Worker für die installierbare PWA

**Status:** Angenommen für E10-09 ([Issue #88](https://github.com/henrysachs/voltonaut/issues/88)).

## Kontext

Voltonaut soll installierbar sein und die App-Oberfläche offline laden. Gleichzeitig dürfen Sessions, Tokens, Fahrten, Puls und Checkpoints nie im Cache landen, und ein Update darf eine laufende Aufnahme nicht durch ein Neuladen verwerfen. Neue Build-Abhängigkeiten benötigen eine ADR.

## Entscheidung

Der Service Worker ist ein kleines, eigenes TypeScript-Modul (`apps/web/src/pwa/`). Ein ~40-zeiliges Vite-Plugin in `vite.config.ts` trägt Release-Version und Precache-Liste ein. Es gibt **keine** neue Abhängigkeit, weder `vite-plugin-pwa` noch Workbox.

Die Cache-Regeln sind eine Allowlist: gleiche Herkunft, GET, Shell-Navigation und unveränderliche Dateien unter `/assets/` und `/icons/`. Alles andere läuft unverändert ans Netz. Updates warten (`skipWaiting` nur auf Nachricht der Seite nach Nutzerklick).

## Folgen

- Die Cache-Grenze ist in einer reinen Funktion (`classifyRequest`) testbar und lesbar; neue Pfade sind standardmäßig **nicht** gecacht.
- Das Plugin ist unser Code und muss mit Vite-Updates mitgepflegt werden.
- Funktionen wie Hintergrundsynchronisation, Push oder Runtime-Caching beliebiger Routen gibt es nicht.

## Verworfene Alternativen

`vite-plugin-pwa`/Workbox: viele transitive Abhängigkeiten und eine Blocklist-Denkweise (Routen explizit ausschließen), für eine App-Shell mit einer Handvoll Regeln überdimensioniert. Automatisches `skipWaiting` mit Neuladen: würde laufende Aufnahmen verwerfen.
