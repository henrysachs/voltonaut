# Voltonaut

## Sprache

**Voltonaut-Konto**:
Die dauerhafte Zuordnung der eigenen Fahrten, des Inventars und der Progression, unabhängig von der verwendeten Login-Methode.
_Vermeiden_: Cloudflare-Konto als Bezeichnung für das Voltonaut-Konto.

**Fahrtjournal**:
Die vollständige geordnete Historie der physikwirksamen Vorgänge einer Spielsession ab ihrem wirklichen Anfang.
_Vermeiden_: öffentlicher Startsnapshot als Ersatz für die Historie.

**Aufnahmefenster**:
Der vom Nutzer gewählte Abschnitt einer Spielsession, dessen Zeit und Strecke zu einer abgeschlossenen Aufnahme zählen. Die davor gefahrene Historie bleibt Vorlauf.
_Vermeiden_: Journalanfang als Synonym für Aufnahmestart.

**Replay-Konsistenz**:
Die Übereinstimmung einer Aufnahme mit der Nachrechnung ihrer vollständigen Vorgangshistorie. Sie beweist weder echte Sensoren noch eine reale Trainingsleistung.
_Vermeiden_: hardwareverifiziert, echte Fahrt bewiesen.

**BLE-Selbstauskunft**:
Die Aussage einer Aufnahme, dass ihre Messwerte aus Bluetooth-Geräten stammen. Diese Aussage kann ohne unabhängiges Hardwareattest nicht bewiesen werden.
_Vermeiden_: bestätigte Hardwareherkunft.

**Strava-Fahrtfreigabe**:
Die ausdrückliche Zustimmung zur Übertragung genau einer gespeicherten Fahrt an das angezeigte Strava-Zielkonto. Eine Kontoverbindung allein ist keine Fahrtfreigabe.
_Vermeiden_: TCX-Download oder Kontozuordnung als Uploadzustimmung.

**Unklare Strava-Auslieferung**:
Ein Versand, dessen Annahme durch Strava nicht sicher bekannt ist. Er ist weder bestätigter Erfolg noch sicher gescheitert.
_Vermeiden_: fehlgeschlagen als Grund für automatischen Neuversand.

**Festgeschriebener Strava-Versuch**:
Der dauerhaft vor dem Anbieteraufruf gespeicherte einzige Uploadversuch einer Fahrt. Nur er berechtigt zum Upload-POST.
_Vermeiden_: Wiederholung oder neuer Versuch nach einem unklaren Ergebnis.

**Mitgliedsstufe**:
Die manuell vergebbare Einstufung eines Kontos als Normal, Premium oder Pro. Eine Stufe allein verspricht noch keinen Preis oder unterschiedliche Spielrechte.
_Vermeiden_: Adminrolle als höhere Mitgliedsstufe.

**VIP-Kennzeichen**:
Eine zusätzliche Auszeichnung eines Kontos, unabhängig von seiner Mitgliedsstufe. VIP verleiht keine Verwaltungsberechtigung.
_Vermeiden_: VIP als Ersatz für Premium, Pro oder Administrator.

**Adminberechtigung**:
Die ausdrücklich vergebene Erlaubnis, Mitgliedsstufen und VIP-Kennzeichen bestehender Konten zu verwalten. Sie entsteht weder durch einen Kauf noch durch VIP oder den ersten Login.
_Vermeiden_: zahlender Nutzer als gleichbedeutend mit Administrator.
