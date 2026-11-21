# Gebauter Aufnahme-Nachweis

```sh
mise run install
mise exec -- node scripts/verify-ride-delivery.mjs
```

Der Treiber baut die echte Webanwendung einschließlich Engine-Worker mit der
vorhandenen Vite-Konfiguration. Build, Cache und frisches Chromium-Profil liegen
im ausgegebenen `$TMPDIR/opencode/delivery-capture-harness-*`-Verzeichnis.
Ein eigener statischer SPA-Server bindet ausschließlich `127.0.0.1` mit einem
OS-zugewiesenen Port und `Referrer-Policy: no-referrer`. Kein Vite-Devserver.

Chromium öffnet ausschließlich `/?sim=1`, wartet auf echte HUD-Messwerte und
bedient die vorhandenen Aufnahmebuttons. Nach mindestens einer echten Sekunde
liest der Treiber die tatsächliche IndexedDB ausschließlich lesend. Ein Reload
muss denselben Datensatz liefern. Native Bluetooth-Zugriffe werden vor jedem
nativen Aufruf abgebrochen; Netzwerk außerhalb des eigenen Servers ist gesperrt.
Es gibt keine Injektion von Fahrt-, Journal-, Worker- oder Serverzustand.

Erwartung: genau ein roher `RecordingV2`-Datensatz mit `schemaVersion: 2`,
vollständigem geordnetem Präfix und genau einem ausgewählten Aufnahmefenster.
Die Journalprüfungen sind Plausibilitätsprüfungen, keine Servernachrechnung und
kein Hardwareherkunftsnachweis. Die unveränderte V1-Anwendung muss ausdrücklich
mit `expected 2, received 1` und Exitcode 1 scheitern, nicht grün markiert werden.

Belege: `build.log`, `build-manifest.json` mit SHA-256 aller Builddateien und des
Workers, `browser-diagnostics.json`, `static-requests.json`, `capture.json`,
`actual-sanitized-archive-shape.json`, Screenshots vor/nach Reload und `result.log`.
Profilwerte und Fahrt-ID werden nicht in die Archivform übernommen.

`browser.mjs` besitzt den UI-/Browserablauf; `archive.mjs` prüft die gelesene
Archivgrenze. Ein späterer nativer GATT-Fake-Fluss kann den UI-Ablauf ergänzen,
ohne einen zweiten Aufnahmeproduzenten einzuführen. API, Konto, Strava und
native Adapter sind durch diesen ersten Sim-Nachweis noch nicht verifiziert.
