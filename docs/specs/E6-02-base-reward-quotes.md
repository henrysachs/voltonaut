# Spec E6-02 – Reine XP-, Level- und Volts-Angebote

- **Auftrag:** Hardwareunabhängiger Softwareausbau nach Henrys Klarstellung vom 23.11.2026.
- **Basis:** Main `5bcec675dbb4a200dccfdaa47e92f246fe8d2c57` mit Sprint-/KOM-Vorschau und genehmigter Prüfungsreihenfolge aus ADR-023.
- **Status:** Implementiert und nach Grenzkorrektur unabhängig geprüft. Reguläres Gate, Build und Mutation nach Integration von Main `5bcec67` grün. CI-Freigabe noch offen. Keine verbindlichen Kontobuchungen, Bereitstellung oder Hardwareabnahme.
- **Module:** Eigene Shared-Domänenschemas und reine Funktionen im bestehenden Rules-Paket.

## Ziel

Geprüfte aggregierte Fahrtfakten ergeben ein ausdrücklich unverbindliches Basisangebot für XP und Volts. Tagesrestbudget ist ein expliziter Eingang. Die Funktionen besitzen weder Zeitquelle noch Persistenz, Konto-, Quellen- oder Vergabeautorität.

[ADR-024](../decisions/ADR-024-reward-quote-contracts.md) erlaubt dafür eine direkte Workspaceabhängigkeit Rules nach Shared und den Registereintrag. Keine neue externe Bibliothek. Geschützte TS-Konfigurationen sind nicht freigegeben. Zuerst mit den bestehenden Referenzen prüfen und einen tatsächlich nötigen Referenzwechsel gesondert vorlegen.

## Gewählte Form

Shared besitzt eigene Schemas für effektive Rohwerte, aggregierte aktive Strecke, aktive Höhenmeter, aktive Zeit, gesamte Höhenmeter, mechanische Arbeit, Gesamt-XP, Level und Tagesrestbudget. Typen werden daraus abgeleitet und kontrolliert konstruiert. Keine indirekte Validierungsbibliothek über Health-Schemas oder Engine-Reexports.

Rules liefert `isXpActive`, `calculateBaseRewards`, `xpForLevel`, `levelForXp` und `applyDailyLimit`. Das bestehende `gearLabel` bleibt erhalten. Ein Tickakkumulator und tatsächliche Fensterfakten werden erst in einer getrennten Servereinheit implementiert.

## Rechenentscheidungen

- XP gelten bei effektiver Rohleistung strikt über 30 W und Kadenz strikt über 20 rpm.
- XP sind 20 je aktivem km, 2 je aktivem Höhenmeter und 1 je aktiver Minute. Jeder Bestandteil wird einmal nach Aggregation der Fahrt abgerundet, danach werden die ganzen Bestandteile summiert.
- Level 1 beginnt bei 0 XP. Für Level 2 bis 50 gilt unverändert `round(500 * level ** 1.6)`. Es gibt kein Level 0.
- Basis-Volts sind `floor(energyKj)` plus `floor(elevationGainM * 1.5)`. Es zählen hier die gesamten Höhenmeter, nicht automatisch die XP-gefilterten.
- Tagesgrenze ist 3000 über alle Angebote des Tages. `quoted = min(candidate, remaining)`, `withheld = candidate - quoted`, `remainingAfter = remaining - quoted`. Kein eigener Tageswechsel oder Reset.
- Pickups, PBs, Badges und Erstfahrtboni fehlen absichtlich in diesem Basisangebot. Keine nicht vorhandenen Tatsachen erfinden.

## Abnahmekriterien

- [x] AK1 – Öffentliche Rechner validieren Eingaben mit eigenen schemaabgeleiteten Verträgen und rechnen ausschließlich mit geparsten Kopien. Alle zulässigen Eingaben erzeugen sichere nichtnegative Ganzzahlergebnisse. Keine Typassertion, NaN, Infinity oder stilles Klemmen kaputter Eingaben.
- [x] AK2 – Handgerechnete Fälle und strikte Rohwertschwellen belegen alle Basisformeln, Aggregation und Rundungsentscheidung.
- [x] AK3 – Alle Levelgrenzen einschließlich 0 XP, exakter Schwelle, einem XP darunter und maximalem Level sind geprüft. Höhere Gesamt-XP senken das Level nicht.
- [x] AK4 – Wiederhergestelltes Restbudget, leeres Budget und mehrere aufeinanderfolgende Angebote erhalten Erhaltungs- und Tagesgrenzen. Kein `Date.now`, Speicherzugriff oder Prozessglobalzustand.
- [x] AK5 – Die Ausgabe heißt Angebot, nicht Grant oder bestätigte Belohnung. Sim, Replay oder BLE-Selbstauskunft erhalten hier keinerlei Autorisierung oder Kontobuchung. Mitgliedsstufe und VIP beeinflussen nichts.
- [x] AK6 – Vorhandene Verbraucher und `gearLabel` funktionieren unverändert. Neue Workspacekante und Registry entsprechen ADR-024, keine weitere Abhängigkeit oder geschützte Konfiguration geändert.
- [x] AK7 – Grenzfälle, Properties, vollständiges Gate, Build und `mise run check:mutation` bestehen ohne gelockerte Regeln oder geänderte Golden-Dateien. Unabhängiges Review bestätigt fachliche Mathematik und Scope.

## Softwarebelege

- Sechs fokussierte Testdateien bestehen mit 130 Fällen. Vorhandene Handrechnungen, Properties und alle Levelgrenzen bleiben erhalten.
- Das unabhängige Korrekturreview bestätigt 25 eigene Node-Gegenproben, 10.000 Fälle mit unverändertem BigInt-Orakel und strikte Quell- und Deklarationsverbraucher. Dieselben neun typisierten Fehlaufrufe scheitern gegen den alten Code und bestehen gegen die Korrektur.
- Objektmarken verhindern ungültige Spread-Kopien nicht. Deshalb prüfen öffentliche Rechner auch typisierte Kandidaten und arbeiten mit Parsergebnissen. Negative, nichtendliche, gebrochene oder inkonsistente Volts-Angebote sowie wechselnde Getter sind abgedeckt.
- Der eigenständige Korrekturlauf besteht mit 977 Unit-/Integrationstests, 49 Browserfällen und Build. Dieser Lauf verwendete `mise run --jobs 1 check` und ersetzt nicht das reguläre integrierte Abschlussgate.
- Die frische vollständige Mutation besteht mit 5143 Mutanten und 95,59 %. Alle 44 neuen Formelmutanten sind getötet. Geschützte Konfigurationen, Engine und Golden-Dateien bleiben unverändert.
- Nach Integration von Main `a001d16` besteht das reguläre `CI=1 E2E_PORT=5250 mise run check` mit 977 Unit-/Integrationstests und 49 Browserfällen. Normaler Build und `mise run check:mutation` bestehen. Der integrierte Mutationstest bestätigt unveränderte Quell- und Testdateien, verwendet 5142 vorhandene Ergebnisse erneut und behält 95,59 %. Das ist kein zweiter frischer Volllauf. Alle 14 reviewten Quell-, Manifest- und Lockfiledateien sowie die bisherigen 22 Browserdateien bleiben bytegleich.
- Nach Übernahme der Sprint-/KOM-Vorschau aus Main `5bcec67` bestehen dasselbe reguläre Gate mit 1008 Unit-/Integrationstests und 50 Browserfällen, normaler Build und Standardmutation erneut. Die 5143 Mutanten behalten 95,59 % bei unveränderten mutierten Quellen und Tests. Die zusätzlichen Browser- und Segmenttests ersetzen keinen bestehenden Fall.

## Grenzen

Keine Backendvergabe, kein Ledger, Shopkauf, Serverendpunkt oder künstlicher Browsermanager als Scheinverbraucher. Eine mathematisch gültige Faktenstruktur ist kein Nachweis realer Leistung. Akzeptanz und serverseitige idempotente Vergabe sind getrennte Folgeaufgaben. Trainer und Hardwarefahrt sind für diese Einheit nicht erforderlich.
