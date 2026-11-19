# Offene Fragen & Risiken

Status: ❓ offen · 🔬 wird in Etappe geklärt · ✅ geklärt (mit Datum und Ergebnis stehen lassen)

## Hardware / Bluetooth
| # | Frage | Wann | Warum wichtig |
|---|---|---|---|
| H1 | Genaues Trainer-Modell (KICKR CORE „Zwift One" 2024 vs. KICKR CORE 2) und Firmware? | 🔬 E1 | Verhalten FTMS-Sim, Grade-Limit |
| H2 | Bleibt der Trainer nach Zwift-Nutzung in einem „Virtual-Shift"-Modus, der FTMS-Sim beeinflusst? | 🔬 E1/E2 | Kann Widerstand verfälschen; Test: stromlos machen, nur Voltonaut verbinden |
| H3 | Bietet der Trainer zusätzlich Zwifts proprietären Service an (Sniffer zeigt `00000001-19ca-…` / `fc82`)? | 🔬 E1 | Nur dokumentieren (ADR-001) |
| H4 | ✅ Controller = **Zwift Play** (Henry, 2026-11-19). Offen: Firmware 1.x oder 2.0.1? | 🔬 E1 | 1.x: 2 Verbindungen + `0x07`; 2.0.1: 1 Verbindung, Format ❓ (vermutlich `0x23`) |
| H5 | Antwortet Play auf Klartext-„RideOn" mit unverschlüsselten Frames (laut BikeControl/SwiftControl ja)? | 🔬 E1 | Sonst ECDH+AES-CCM nötig (WebCrypto kann P-256/HKDF, **kein AES-CCM** → JS-Lib) |
| H6 | Play `PlayKeyPadStatus`: Polarität von `RightPad`, ist die Seitentaste wirklich Feld 6 (`Button_Shift`)? Bitmap-Belegung bei FW 2.0.1 (Quellen widersprechen sich) | 🔬 E2 | ButtonMap |
| H7 | Hält der Laptop-Adapter **4** BLE-Verbindungen (Trainer, HR, Play L, Play R) per Web Bluetooth stabil? | 🔬 E1 | Sonst Play auf FW 2.0.1, USB-BLE-Dongle oder Tastatur |
| H8 | Henrys Laptop-OS und Chrome/Edge-Version (Linux braucht Flags; `getDevices()`-Verfügbarkeit) | ❓ | Reconnect ohne Dialog |
| H9 | Trainer-interne Masse-Annahme im Sim-Modus; Reaktionszeit auf `0x11` | 🔬 E2 | Kalibrierung Strategie A |
| H10 | Henrys Kettenblatt (Zähne) → physische Übersetzung mit 14er Cog | ❓ (im Rider-Profil eintragbar) | Gangmodell |
| H11 | Ist der Pulsgurt evtl. schon mit Zwift/Uhr verbunden (viele Gurte erlauben nur 1–2 BLE-Verbindungen)? | 🔬 E1 | |

## Produkt / Spiel
| # | Frage | Status |
|---|---|---|
| P1 | Rahmen/Laufräder mit Spielwerten (Gewicht/CdA) oder rein kosmetisch? Vorschlag: v1 kosmetisch | ❓ |
| P2 | Level-Kurve und XP-Raten – nach 2–3 Wochen Nutzung justieren | ❓ |
| P3 | Rider-Profil: Gewicht/Größe in-app konfigurierbar (Beispiel-Defaults 75 kg / 185 cm) ✅; FTP später | ✅ / ❓ FTP |
| P4 | Stil: stylized low-poly (Vorschlag) vs. realistischer | ❓ |
| P5 | VPS: Subdomain für API, vorhandener Reverse Proxy (nginx/Caddy/Docker), Node-Version, freie Ressourcen? SSH-Deploy-Key für CI? | ✅ 19.11.2026 (nur lesend geprüft): Henrys Hetzner-VPS, Ubuntu 24.04, 2 vCPU, 4 GB RAM, rund 18 GB frei, Login per SSH-Key. Bereits Financensor-Compose mit Traefik v3 (`financensor-traefik-1`) auf Ports 80/443 → Voltonaut als eigenes Compose-Projekt hinter diesem Traefik, nicht Caddy/systemd (ADR-004). API-Host `voltonaut-api.stammkneipe.dev`. SSH-Zugang da; DNS-A-Record und CI-Deploy-Secret stehen noch aus. Host-Node-Version entfällt, Node läuft im Image. |
| P6 | Login-Mails: Cloudflare Email Sending (Public Beta; beliebige Empfänger nur mit Workers Paid ≈ 5 $/Monat, 3 000/Monat inkl.; Free nur an verifizierte Adressen) oder Resend Free (3 000/Monat, 100/Tag)? Hat Henry Workers Paid? Absenderdomain bei Cloudflare onboarden. | ❓ vor E5 |
| P10 | Cloudflare: `CLOUDFLARE_API_TOKEN` (Pages: Edit) + `CLOUDFLARE_ACCOUNT_ID` als GitHub-Secrets; Projektname `voltonaut`; Custom Domain; liegt die Domain bei Cloudflare DNS? Pages vs. Workers Static Assets? | ✅ 19.11.2026 Domain: Zone `stammkneipe.dev` bei Cloudflare, Web-Custom-Domain `voltonaut.stammkneipe.dev`. ❓ weiter offen: `CLOUDFLARE_API_TOKEN` (Pages: Edit) + `CLOUDFLARE_ACCOUNT_ID` als GitHub-Secrets; Projektname `voltonaut`; Pages vs. Workers Static Assets? |
| P7 | Gleiche Domain für Web und API? Dann Same-Site → später httpOnly-Cookie statt Bearer möglich; v1 bleibt Bearer | ✅ 19.11.2026: Web `voltonaut.stammkneipe.dev`, API `voltonaut-api.stammkneipe.dev` (eine Ebene unter der Apex, wegen Cloudflare Universal SSL). Gleiche Site (`stammkneipe.dev`) → später httpOnly-Cookie möglich; v1 bleibt Bearer. |
| P8 | Volts-Verdienformel, Shop-Preise und Tageslimit nach Nutzung justieren | ❓ nach E6 |
| P9 | Aufbewahrungsdauer der 1-Hz-Samples auf dem Server (Vorschlag 90 Tage) und Datenschutzhinweis | ❓ E5 |

## Technik
| # | Frage | Status |
|---|---|---|
| T1 | Engine im Web Worker (läuft weiter bei Hintergrund-Tab, Timer-Throttling) oder Main Thread + Worker-Timer? | 🔬 E3 |
| T2 | Fahrer-/Radmodell: CC0-Basis (Quaternius/Kenney) anpassen vs. eigenes Blender-Modell | 🔬 E4 |
| T3 | Lizenz des Repos | ✅ MIT (Henry, 2026-11-19) |
| T4 | NestJS braucht `experimentalDecorators` + `emitDecoratorMetadata`: von der gepinnten TS-Version (6.x vs. nativ 7.x / tsgo) unterstützt? Sonst Server-Build via SWC + Typecheck mit kompatibler TS-Version | 🔬 E0 |
| T5 | Oxfmt ist Beta (v0.79, Nov 2026) – Formatierungsabweichungen beobachten; Fallback Prettier | 🔬 E0 |
| T6 | anti-slop vs. three.js/NestJS: `no-shape-in-symbol-names` (THREE.Shape), `no-unknown-parameters` (Exception-Filter), `require-safety-comment-for-type-assertion` (GLTF-Traversal) – Reibung messen; Regeln nur per ADR anpassen | 🔬 E0/E4 |
| T7 | Oxlint-Regelnamen der gewünschten Zusatzregeln in der gepinnten Version vorhanden? (`oxlint --rules`) | 🔬 E0 |
| T8 | Visuelle Tests: SwiftShader-Rendering in CI stabil genug (Shader-Precision, CSM)? Toleranz ggf. anpassen (per ADR) | 🔬 E4 |
| T9 | Stryker-Laufzeit auf engine/rules – reicht `incremental` für PR-Läufe < 10 min? | 🔬 E3 |
| T10 | WebGPU-Renderer statt WebGL2 (Chrome/Edge) – Zeitpunkt | ❓ E10 |

## Risiken
| Risiko | Wahrscheinlichkeit | Auswirkung | Gegenmaßnahme |
|---|---|---|---|
| Play verschlüsselt / FW-2.0.1-Format anders | mittel-niedrig | Schalten nur per Tastatur | Tastatur-Fallback ab E0; ECDH-Pfad dokumentiert; Sniffer klärt Format |
| Server-Betrieb (Ausfall, Datenverlust, Sicherheitslücke) | mittel | Fortschritt weg / Datenleck | Offline-first, Litestream-Backups, Rate-Limits, Token-Hashing, Updates |
| Cheating in der Ökonomie | niedrig (Freundeskreis) | Unfaire Vergleiche | Server-Nachrechnung + Grenzwerte; ehrlich begrenzt |
| DSGVO-Pflichten (E-Mail, Fahrtdaten) | sicher | Aufwand | Export/Löschung ab E5, Datensparsamkeit |
| Schaltgefühl schlecht (Latenz, Sättigung am Berg) | mittel | Spielspaß | Strategien A/B, Kalibrierung, Messung in E2 |
| Chrome-Updates an Web Bluetooth | niedrig | Verbindungsprobleme | Sniffer als Diagnosewerkzeug |
| 3D-Assets aufwendig / Lizenzprobleme | hoch | Optik | Low-Poly-Stil, nur CC0/CC-BY, `LICENSES.md` |
| Performance auf iGPU | mittel | Ruckeln | Budget + Qualitätsstufen ab E4 |
| Markenrecht (Zwift-Namen/Look) | niedrig | Repo-Ärger | eigene Welt/Namen, Disclaimer im README |
