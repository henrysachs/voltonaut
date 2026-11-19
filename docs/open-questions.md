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
| P5 | VPS: Subdomain für API, vorhandener Reverse Proxy (nginx/Caddy/Docker), Node-Version, freie Ressourcen? | ❓ vor E5 |
| P6 | SMTP-Absender für Magic-Link-Mails (vorhandenes Postfach oder Dienst)? | ❓ vor E5 |
| P7 | Client weiter auf GitHub Pages (Bearer-Token) oder zusätzlich vom VPS unter eigener Domain (Cookie möglich)? | ❓ E5 |
| P8 | Volts-Verdienformel, Shop-Preise und Tageslimit nach Nutzung justieren | ❓ nach E6 |
| P9 | Aufbewahrungsdauer der 1-Hz-Samples auf dem Server (Vorschlag 90 Tage) und Datenschutzhinweis | ❓ E5 |

## Technik
| # | Frage | Status |
|---|---|---|
| T1 | Engine im Web Worker (läuft weiter bei Hintergrund-Tab, Timer-Throttling) oder Main Thread + Worker-Timer? | 🔬 E3 |
| T2 | Fahrer-/Radmodell: CC0-Basis (Quaternius/Kenney) anpassen vs. eigenes Blender-Modell | 🔬 E4 |
| T3 | Lizenz des Repos | ✅ MIT (Henry, 2026-11-19) |

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
