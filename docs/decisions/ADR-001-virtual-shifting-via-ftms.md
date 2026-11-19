# ADR-001 – Virtuelles Schalten in der App über FTMS

**Status:** Angenommen (2026-11-19). Strategie-Detail (A Effective Grade vs. B ERG) wird nach E2-Messungen ergänzt.

## Kontext
Der KICKR CORE mit Zwift Cog hat physisch nur einen Gang. Zwift schaltet „virtuell", indem die Zwift-App über ein proprietäres Protokoll eine Übersetzung an die Trainer-Firmware sendet; laut Wahoo funktioniert dieses native Schalten nur in Zwift/Rouvy. Der Trainer spricht aber vollständig den offenen Standard FTMS (`0x1826`) und lässt sich von jeder App steuern (DC Rainmaker). Die Zwift-Controller senden ihre Tasten per BLE an die verbundene App.

## Entscheidung
Voltonaut liest die Controller-Tasten selbst, hält ein eigenes Gangmodell (24 Gänge) in `engine/` und übersetzt Gang + Streckensteigung in FTMS-Kommandos (primär `0x11` Simulation Parameters mit „effektiver Steigung", alternativ `0x05` Target Power). Zwifts proprietäres Trainer-Schaltprotokoll wird nicht verwendet.

## Konsequenzen
- + Nur ein proprietäres Teilproblem (Controller-Tasten), das öffentlich gut dokumentiert ist; Trainer-Seite komplett standardisiert.
- + Funktioniert mit jedem FTMS-Trainer, nicht nur Wahoo.
- + Gangmodell frei gestaltbar und testbar im Sim-Modus.
- − Schaltgefühl hängt von unserer Mapping-Qualität ab; Trainer-interne Annahmen (Fahrermasse, Grade-Limit ~16 %) müssen kalibriert werden.
- − Latenz Gangwechsel → Widerstand durch BLE-Roundtrip + Trainer-Regelung (Ziel < 300 ms, zu messen).

## Alternativen
- **Zwifts natives Trainer-Protokoll nachbauen** (Hub-artiger Service, Übersetzung direkt in Firmware): bestes Gefühl, aber undokumentiert, firmwareabhängig, rechtlich/technisch fragil. Abgelehnt, ggf. später als Experiment.
- **Nur ERG** (`0x05`): exakt, aber träge Regelschleife → bleibt als Strategie B verfügbar.
- **Resistance Level** (`0x04`): zu grob.
