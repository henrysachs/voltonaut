# ADR-008 – Szenenstruktur: three.js-Szenengraph + typisierter System-Scheduler (kein ECS-Framework)

**Status:** Angenommen (2026-11-19)

## Kontext

Der 3D-Teil soll ein umfangreiches Spiel werden (Tageszeit/Wetter, Bots, Zuschauer, Partikel, Pickups, mehrere Kameras, Post-Processing, Audio). Es braucht eine Struktur, die viele Agenten parallel erweitern können, ohne dass Render-Code Spiel-State verändert. Optionen: ECS-Bibliothek (bitECS, miniplex, becsy) vs. plain three.js-Szenengraph mit klaren Systemen.

## Entscheidung

- **Kein ECS-Framework.** Simulation (Physik, Bots, Drafting, Pickups, Segmente) ist bereits datenorientiert in `packages/engine` (reiner Tick über typisierte Arrays/Records).
- Rendering in `apps/web` als **Szenengraph + `RenderSystem`-Interface** mit fester Reihenfolge (`04-world-3d.md` §1). Jedes System besitzt seine three.js-Objekte, liest nur `FrameInput` (Snapshots), schreibt nie Engine-State.
- Massen-Objekte (Vegetation, Zuschauer, Partikel, Pickups) über `InstancedMesh`/`BatchedMesh`/GPU-Partikel statt pro-Objekt-Entities.

## Begründung

- Dynamische Entitäten sind wenige (≤ ~60 Fahrer, ein paar hundert Partikel-Emitter-Instanzen GPU-seitig) – ECS-Vorteile (Cache-Lokalität, Abfragen über Tausende Entities) greifen nicht.
- ECS-Bibliotheken setzen auf dynamische Komponenten-Registrierung, was mit `exactOptionalPropertyTypes`, anti-slop (`no-unsafe-dictionary-type`, `no-unknown-*`) und dependency-cruiser-Grenzen kollidiert und eine weitere Abhängigkeit wäre.
- Systeme mit festem Interface sind für Agenten leicht zu finden, einzeln testbar (visuell + Budget) und per depcruise begrenzbar (`three` nur in `world/avatar/garage`).

## Konsequenzen

- - Einfach, typsicher, keine Zusatzlib; klare Ownership.
- − Querschnitts-Abfragen („alle Objekte im Radius") selbst implementieren (räumlicher Index in `world/`).
- Revisit, falls > 300 dynamische, logiktragende Entities nötig werden (z. B. große Massenrennen) → dann miniplex prüfen (neues ADR).
