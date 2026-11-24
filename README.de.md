# LocalPDF

Ein PDF-Editor für Windows, der Ihre Dokumente auf Ihrem Computer lässt. **PDF-Formulare ausfüllen, ohne sie hochzuladen:** Die App blockiert alle Netzwerkanfragen nach außen, und auch die Texterkennung läuft lokal. Gerade für Anträge, Formulare von Ämtern und Verträge mit persönlichen Daten.

**Dies ist eine Beta.** Sie ist an erzeugten Dateien gut getestet, hat aber erst wenige echte Dokumente gesehen. Prüfen Sie das Ergebnis und behalten Sie Ihre Originale. [Problem melden](../../issues): In der App geht das auch über „Problem melden…“.

**Projektseite:** https://puchbuch.github.io/LocalPDF/de/

*English: [README.md](README.md) · Русский: [README.ru.md](README.ru.md)*

## Was es kann

- **Formulare ausfüllen:** die Formularfelder des PDFs selbst oder eigene Felder, mit Text, Häkchen, Kreuzen, Punkten, Unterschriften und Bildern.
- **Felder finden:** fügt leere Felder an Linien und Kästchen ein.
- **Tabelle auf einem gescannten Formular ausfüllen:** findet die Zellen einer linierten Tabelle und trägt Daten in ihre leeren Zeilen ein, aus einer Excel- (.xlsx) oder CSV-Datei oder aus Excel oder Google Sheets eingefügt. Ein Rückgängig nimmt alles zurück.
- **Felder nach Nummern:** Jedes Feld bekommt eine Nummer in Lesereihenfolge, mit einer Liste, um zu jedem zu springen.
- **Mit einer beliebigen KI ausfüllen, ohne Internet:** Kopieren Sie die nummerierten Felder als Text in einen KI-Chat, fügen Sie die Antwort wieder ein, und die Felder sind ausgefüllt. Jedes Feld wird geprüft, Probleme werden gemeldet, ein Rückgängig nimmt alles zurück. LocalPDF selbst sendet nichts.
- **Text direkt bearbeiten:** Zeile oder Wort anklicken und neu tippen. Fett, kursiv und Farbe bleiben erhalten. Neuer Text wird in der Schrift des Dokuments gesetzt, wenn die Datei die nötigen Buchstaben enthält, sonst in einer ähnlichen. Eine Pipette übernimmt den Stil eines beliebigen Textes der Seite.
- **Text wirklich entfernen:** Ersetzter Text wird aus der gespeicherten Datei herausgeschnitten, nicht nur überdeckt, und das Ergebnis wird geprüft.
- **Text in Scans erkennen (OCR):** ohne Internet, in acht Sprachen. Gespeicherte Dateien sind durchsuchbar.
- **Seiten verwalten:** löschen, drehen, umsortieren, PDFs und Bilder zusammenfügen.
- **Von Hand unterschreiben:** eine einzelne Seite drucken, unterschreiben und einen Scan oder ein Handyfoto davon an ihre Stelle setzen. Ein Foto wird gerade gerückt, auf das Blatt zugeschnitten und aufbereitet.
- **Passwörter:** öffnet geschützte PDFs und kann den Schutz beim Speichern behalten.
- **Hilfe im Programm:** durchsuchbare Anleitung und häufige Fragen, ohne Internet (F1), auf Deutsch, Englisch und Russisch. Feedback wird im Programm vorbereitet und von Ihnen auf GitHub gesendet.
- **Außerdem:** Drucken, Text als Markdown, Wiederherstellung nach einem Absturz.
- **Sprachen:** English, Deutsch, Français, Español, Italiano, Polski, Українська, Русский.

## Installation

Laden Sie `LocalPDF Setup` unter [Releases](../../releases) herunter und starten Sie es.

Windows warnt eventuell vor einem unbekannten Herausgeber, weil der Installer noch nicht signiert ist. Wenn Sie diesem Download vertrauen, wählen Sie **Weitere Informationen** und dann **Trotzdem ausführen**.

Um PDFs per Doppelklick zu öffnen: Rechtsklick auf ein PDF → **Öffnen mit** → **Andere App auswählen** → **LocalPDF** → **Immer**.

## Browser-Erweiterung

Derselbe Editor läuft auch als Erweiterung für Chrome und Edge. Sie verlangt keine Berechtigungen und lässt keine Verbindungen nach außen zu. In den Stores ist sie noch nicht. Zum Ausprobieren: `npm run build:extension` ausführen, `chrome://extensions` öffnen, den **Entwicklermodus** einschalten, **Entpackte Erweiterung laden** wählen und den Ordner `out-extension` auswählen.

Von der Windows-App unterscheidet sie sich so:

- PDFs lassen sich nicht per Doppelklick öffnen. Klicken Sie auf die Schaltfläche der Erweiterung in der Symbolleiste und wählen Sie eine Datei.
- Die Kopie für die Wiederherstellung nach einem Absturz liegt unverschlüsselt in Ihrem Browserprofil. Mit Passwort geöffnete Dokumente werden dort nie gespeichert.
- Gedruckt wird über den Dialog des Browsers, und die App erfährt nicht, ob Sie gedruckt oder abgebrochen haben.
- Getestet in Chromium und Microsoft Edge, nicht in anderen Browsern.

## Grenzen

- **Bilder und Scans:** Text in einem Bild kann nicht herausgeschnitten werden. Er wird nur überdeckt und bleibt in der Datei, die App weist Sie darauf hin. Für Scans mit vertraulichen Daten drucken Sie stattdessen als PDF und prüfen das Ergebnis.
- **Vertrauliche Dokumente:** Suchen Sie nach dem Entfernen sensibler Daten in der gespeicherten Datei mit einem anderen PDF-Programm danach. Verlassen Sie sich nicht allein auf diese App.
- **Bearbeiteter Text** wird nur dann in der Schrift des Dokuments gesetzt, wenn sie in die Datei eingebettet ist und alle nötigen Buchstaben hat. Sonst wird eine von vier Schriften verwendet (wie Arial, Times New Roman, Calibri oder Courier New), und eine ungewöhnliche Schrift sieht anders aus. Ein Absatz wird nicht neu umbrochen: Ein längeres Wort überlappt das nächste.
- **Formulare:** XFA-Formulare und JavaScript in Formularen werden nicht unterstützt.
- **Texterkennung** ist bei blassen oder schiefen Scans ungenauer und liest keine Handschrift. Lesen Sie das Ergebnis durch.
- **Felder finden** erkennt keine Kästchen für einzelne Buchstaben und kann bei schiefen Scans Felder übersehen oder falsch setzen.
- **Tabelle ausfüllen** braucht klare, vollständige Tabellenlinien. Ein schräg aufgenommenes Foto zuerst gerade rücken: öffnen und die Ecken des Blatts anpassen. Zeilen auf dunklem Grund und über mehrere Zeilen verbundene Zellen können falsch gelesen werden, sehen Sie das Ergebnis daher durch. Das alte XLS-Format wird nicht gelesen. In einer Excel-Datei ausgeblendete Zeilen und Spalten fallen weg, ungewöhnliche Zahlenformate werden schlicht dargestellt.
- **Drucken** sendet die Seiten als Bilder, sehr große Dokumente brauchen daher eine Weile.
- **Wiederherstellung nach einem Absturz:** Solange ein Dokument ungespeicherte Änderungen hat, liegt eine unverschlüsselte Kopie in `%APPDATA%\LocalPDF\recovery`. Sie wird beim Speichern oder normalen Schließen entfernt. Mit Passwort geöffnete Dokumente werden dort nie gespeichert.

## Übersetzungen

Die Übersetzungen sind maschinell erstellt und noch nicht von Muttersprachlern gelesen. Korrekturen sind sehr willkommen: Alle Texte der Oberfläche stehen in [docs/i18n-review/de.csv](docs/i18n-review/de.csv), mit dem englischen Original daneben. Tragen Sie Verbesserungen in die Spalte `correction` ein, setzen Sie bei passenden Texten den Status `ok`, und schicken Sie die Datei als Issue oder Pull Request.

## Entwicklung

Befehle und Aufbau des Projekts stehen in der [README.md](README.md).

## Lizenzen

LocalPDF steht unter der [MIT-Lizenz](LICENSE). Die verwendete Software und die Schriften haben eigene Lizenzen, siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
