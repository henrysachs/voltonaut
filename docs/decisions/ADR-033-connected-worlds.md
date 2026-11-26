# ADR-033 – Zusammenhängende Welten aus Straßennetz, Höhenraster und Regionen

- **Status:** Vorgeschlagen. Henrys Freigabe steht aus.
- **Bezug:** Issue [#150](https://github.com/henrysachs/voltonaut/issues/150), #151 (Nachtstadt-Optik), Issue #75 und PR #138 (Biome als Einzelstrecken), #145 (weitere Biome), #85 (Mini-Map), #68 (Terrain-Chunks), ADR-016 (Server-Nachrechnung), `docs/01-architecture.md` (`Route`), `docs/04-world-3d.md` §4.

## Kontext

Heute ist jede Strecke eine eigene, geschlossene Welt. `Route` enthält eine Mittellinie, ein Höhenprofil, Segmente und eine Szenerie-ID. Das Gelände ist ein Streifen entlang dieser Mittellinie. PR #138 ergänzt Küste, Alpenpass und Nachtstadt nach demselben Muster.

Henry möchte die bisherigen Biome als Gebiete **einer großen, zusammenhängenden Welt** sehen. Es soll trotzdem mehrere Welten geben können. Ein Fahrer fährt vom Wald an den See, weiter an die Küste und hinauf zum Pass, ohne die Fahrt zu wechseln.

Das Modell „eine Strecke = eine Welt“ trägt das nicht:

- Eine Welt braucht Straßen, die sich treffen. Eine einzelne Mittellinie kann das nicht ausdrücken.
- Der Geländestreifen folgt nur einer Linie. Kommt die Straße sich selbst nahe, etwa an Kehren, überdeckt der Streifen die Straße. Das zeigt das Review von PR #138: vor jeder Alpenpass-Kehre liegt Boden bis zu etwa 13 m über der Fahrbahn. Eine Welt mit Kreuzungen hätte dieses Problem überall.
- Aufnahmen, Bestzeiten, Segmente und die Server-Nachrechnung hängen an `routeId` und `routeRevision`. Eine Fahrt durch eine Welt hat keine feste Strecke, solange der Fahrer abbiegen kann.

Kreuzungen und das Abbiegen während der Fahrt behandelt ein eigenes Issue. Diese Entscheidung legt nur die Datenform fest, auf der beides aufsetzt.

## Entscheidung

1. **Welt als eigener Datentyp.** Eine `World` besteht aus einem Straßennetz, einem Höhenraster und Regionen. Sie hat eine stabile `worldId` und eine `worldRevision`. Mehrere Welten sind erlaubt. Die bisherigen Biome werden Regionen der ersten Welt (`voltonaut`).
2. **Straßennetz als Graph.** Knoten sind Kreuzungen und Endpunkte, Kanten sind Straßenabschnitte. Jeder Abschnitt hat eine 2D-Mittellinie mit Bögen (keine Knicke) und ein eigenes Höhenprofil. Die Höhe an einem Knoten ist für alle anschließenden Abschnitte gleich. Ein Abschnitt kennt seine Region. Schritt 1 umhüllt bestehende Einzelstrecken bit-identisch; nur diese Legacy-Wrapper sind vom Glättungstest ausgenommen. Neue Netze ab Schritt 3 müssen glatt sein.
3. **Die Engine bleibt eindimensional.** Die Physik rechnet weiter entlang eines gefahrenen Wegs mit Distanz und Steigung. Ein Weg ist eine Folge von Abschnitten mit Fahrtrichtung. Der Tick bekommt den Weg und die Position darauf, nicht den Graphen. Das Abbiegen ändert nur den nächsten Abschnitt des Wegs, nie die bereits gefahrene Distanz.
4. **Die Strecke wird eine Ansicht auf die Welt.** Eine `Route` ist ein benannter Weg durch das Netz, mit Segmenten, Länge, Schleifenangabe und Startpunkt. Der Streckenkatalog im Menü listet Routen, nicht Welten. Die bisherigen Strecken bleiben als Routen erhalten.
5. **Ein Höhenraster für die ganze Welt.** Das Gelände wird ein Raster in Kacheln (256 m, wie `docs/04-world-3d.md` §4) statt eines Streifens je Strecke. Jede Straße ebnet das Raster in ihrem Korridor ein. Wo sich Korridore überlappen, gewinnt die tiefere Straße. Ein Abstandstest prüft für jede Route: Kein Geländepunkt liegt über der Fahrbahn.
6. **Regionen tragen das Biom.** Eine Region ist eine Fläche auf der Welt mit Biom-ID, Atmosphäre (Licht, Wetter-Standard, Farbkorrektur) und Render-Budget. Zwischen Regionen blenden Atmosphäre und Szenerie über eine Übergangszone. Kein Ladebildschirm während der Fahrt.
7. **Aufnahmen verweisen auf Welt und Weg.** Neue Aufnahmen speichern `worldId`, `worldRevision` und die gefahrene Abschnittsfolge. Die Server-Nachrechnung (ADR-016) löst Welt und Revision intern auf, rechnet den Weg nach und bekommt dafür eine neue explizite Revision. Bestehende Aufnahmen mit `routeId`/`routeRevision` bleiben lesbar und werden nicht neu bewertet.
8. **Strecken-IDs bleiben stabil.** `test-loop` und die Routen aus PR #138 behalten ihre IDs. Ihre bisherige Revision bleibt als Einzelstrecke nachrechenbar. Die Welt-Fassung derselben Strecke bekommt eine neue Revision.
9. **Determinismus und Grenzen bleiben.** Welt, Raster und Szenerie entstehen aus Daten und Seed, ohne Zufall zur Laufzeit. Weltdaten liegen in `packages/engine` (Netz, Profile, Wege) und `apps/web/src/world` (Raster, Szenerie, Regionen-Atmosphäre). `three` bleibt in den erlaubten Ordnern. Keine neue Abhängigkeit.

## Umsetzung in Schritten

Jeder Schritt ist einzeln prüfbar und lässt die Fahrt lauffähig:

1. Datentypen `World`, Abschnitt, Knoten, Weg und Region in `packages/engine`, mit Tests für Höhenstetigkeit an Knoten und Krümmungsgrenze je Sehne. Die bestehenden Strecken werden je eine Welt mit einem Weg. Das Verhalten bleibt bit-identisch, gesichert durch die Golden-Dateien.
2. Höhenraster mit Korridor-Einebnung ersetzt den Geländestreifen, mit Abstandstest für alle Routen.
3. Erste Welt `voltonaut`: Testrunde, Küste, Alpenpass und Nachtstadt als Regionen, verbunden durch Übergangsstraßen. Zunächst feste Wege, noch ohne Abbiegen.
4. Aufnahme- und Replay-Vertrag mit `worldId`, `worldRevision` und Weg, inklusive Server-Nachrechnung.
5. Abbiegen während der Fahrt (eigenes Issue), Mini-Map (#85).

## Folgen

- Biome aus #145 werden Regionen statt eigener Strecken. Neue Regionen brauchen eine Anbindung an das Netz.
- Der Geländestreifen und seine Sonderfälle an Kehren entfallen mit Schritt 2. Bis dahin bleibt die kleine Korrektur aus PR #138 (Boden an Innenkurven begrenzen und unter nahe Straßen absenken) bestehen.
- Segmente, Bestzeiten und Bots beziehen sich auf Abschnitte oder Routen. Wie Segmente über mehrere Abschnitte laufen, klärt Schritt 1.
- Das Render-Budget gilt je Region. Übergangszonen müssen beide Budgets einhalten.
- Der Server braucht für jede neue Welt-Revision Tests der Nachrechnung.

## Alternativen

- **Einzelstrecken weiterführen und nur per Menü wechseln.** Einfach, aber keine zusammenhängende Welt. Kehren und nahe Straßen bleiben ein Sonderfall je Strecke.
- **Lange Einzelstrecke durch alle Biome.** Eine 40-km-Schleife wirkt zusammenhängend, kennt aber keine Kreuzungen. Abbiegen und mehrere Wege bräuchten später doch ein Netz.
- **Freie 2D-Bewegung mit Lenken.** Widerspricht dem Bedienkonzept ohne Lenken und der eindimensionalen Physik. Verworfen.
- **Kachelweise nachgeladene Welt von einem Server.** Für die Größe der ersten Welt nicht nötig. Die Kacheln aus Schritt 2 lassen das später zu.
