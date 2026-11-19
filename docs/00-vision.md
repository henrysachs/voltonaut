# 00 – Vision

## Ziel

Voltonaut ersetzt für Henry Zwift im Alltag: **eine Stunde frei über eine schöne 3D-Strecke fahren**, mit einem sichtbaren, mittretenden Fahrer, virtuellem Schalten über die vorhandenen Zwift-Controller und einem Spielgefühl (XP, Freischaltbares, Bestzeiten), das motiviert wiederzukommen.

## Kernnutzungsszenario

1. Laptop neben der Rolle, Chrome/Edge öffnet die Voltonaut-Seite (Cloudflare Pages oder `localhost`).
2. „Geräte verbinden": Trainer, Pulsgurt, Controller (je ein Browser-Auswahldialog; danach automatische Wiederverbindung, soweit Chrome es erlaubt).
3. Strecke wählen, losfahren. Der Fahrer tritt im Takt der echten Trittfrequenz, die Steigung der Strecke wird am Trainer spürbar, Schalten mit den Controllern.
4. Nach der Fahrt: Zusammenfassung (Distanz, Höhenmeter, Ø-Watt, Ø-Puls), XP, neue Freischaltungen, Segment-Bestzeiten.

## Muss (MVP = Ende E6)

- FTMS-Trainer lesen (Watt, Kadenz) und steuern (Simulationsmodus mit Steigung).
- Virtuelles Schalten (24 Gänge) mit den Zwift-Play-Griffen, Tastatur als Fallback.
- Pulsgurt.
- 3D-Welt mit einer gebauten Strecke inkl. Höhenprofil; animierter Fahrer, Kadenz-synchron.
- Rider-Profil in der App (Gewicht, Größe, Rad/Kettenblatt; später FTP).
- Account auf eigenem Server; XP/Level, Volts ⚡, mindestens 1 Segment mit Bestzeit, erste Unlocks – serverseitig gespeichert, offline-first.
- Sim-Modus ohne Hardware.

## Soll (E7–E10) – das „richtige Spiel"

- Garage: Fahrer und Rad anpassen (Trikot, Helm, Haut, Rahmen, Laufräder, Farben), Shop mit Volts.
- Lebendige Welt: Tageszeit und Wetter, PBR/Schatten/Post-Processing, Zuschauer, AI-Bots mit spürbarem Windschatten, Cinematic-Kameras, Sound und Musik (`04-world-3d.md`).
- Gruppenfahrten mit Freunden (E9), Power-ups, weitere Biome.
- Mehrere Strecken, GPX-Import, Ghost der eigenen Bestzeit, FIT-Export.
- Optionale strukturierte Workouts (ERG).

## Nicht-Ziele (vorerst)

- Server-Abhängigkeit für Solo-Fahren: Fahren muss immer offline/als Gast gehen (Belohnungen werden nachgereicht).
- Öffentliche Rennen/Leaderboards mit Fremden, E-Sport-Anti-Cheat (Gruppenfahrten unter Freunden kommen in E9).
- Safari/iOS/Firefox, Mobile-Layout.
- Nachbau von Zwift-Inhalten/Welten/Marken. Eigene Welt, eigene Optik.
- Nutzung von Zwifts proprietärem Trainer-Schaltprotokoll (siehe ADR-001).

## Qualitätsziele

| Ziel              | Messgröße                                                                            |
| ----------------- | ------------------------------------------------------------------------------------ |
| Flüssig           | ≥ 60 fps auf Henrys Laptop bei 1080p (Budget in `04-world-3d.md`)                    |
| Reaktiv           | Schalten → spürbare Widerstandsänderung < 300 ms; Tastendruck → HUD < 50 ms          |
| Robust            | BLE-Abbruch → automatischer Reconnect-Versuch, Fahrt läuft mit letzten Werten weiter |
| Offen für Agenten | Jede Etappe im Sim-Modus testbar; klare Modulgrenzen                                 |
