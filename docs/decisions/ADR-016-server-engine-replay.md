# ADR-016 – Öffentliche Engine für reine Server-Nachrechnung

- **Status:** Für E10-02 gewählt. Unabhängiges Review und grüne CI vor Integration.
- **Datum:** 2026-11-20

## Kontext

E10-02 benötigt dieselbe Physik und dieselben Routendaten wie der Worker. Der Server darf weder Webcode noch private Enginezustände importieren.

## Entscheidung

`apps/server` erhält `@voltonaut/engine` als direkte `workspace:*`-Abhängigkeit. Eine neue reine Funktion unter `rides` verwendet ausschließlich öffentliche Exporte. Sie löst unterstützte Physik- und Routenrevisionen intern auf. Das vollständige Journal beginnt bei der Initialisierung. Öffentliche Snapshots ersetzen keinen versteckten Enginezustand.

## Folgen

Es gibt keine neue externe Abhängigkeit. Die bestehende V1-API bleibt unverändert ungeprüft. Das Replayergebnis beschreibt ausschließlich numerische Konsistenz. Belohnung, HTTP-Annahme und Strava bleiben getrennte Aufgaben. Eine neue Engine- oder Routensemantik benötigt eine neue explizite Revision, keine stillschweigende Zuordnung zum neuesten Code.
