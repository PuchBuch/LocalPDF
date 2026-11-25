import type { HelpTexts } from './types'

export const de: HelpTexts = {
  sections: [
    {
      id: 'start',
      title: 'Erste Schritte',
      intro: 'LocalPDF bearbeitet und füllt PDFs auf Ihrem Computer aus. Dokumente werden nirgendwohin gesendet.',
      steps: [
        'Öffnen Sie eine Datei: „Datei auswählen“ oder ins Fenster ziehen.',
        'Wählen Sie rechts ein Werkzeug und klicken Sie auf die Seite. Unter den Werkzeugen steht, was das gewählte tut.',
        'Klicken Sie auf „Herunterladen“ und wählen Sie den Speicherort. Das Original bleibt unverändert, solange Sie nicht seinen eigenen Namen wählen.'
      ],
      tips: [
        'Links stehen Miniaturen der Seiten. Die Schaltfläche „⋯“ daneben oder ein Rechtsklick öffnet weitere Aktionen: Text erkennen, Felder finden, Tabelle ausfüllen, drucken, ersetzen.',
        'Vertan? „Rückgängig“ oder Strg+Z.',
        'F1 öffnet diese Hilfe im passenden Kapitel.'
      ]
    },
    {
      id: 'open',
      title: 'Dateien öffnen und zusammenfügen',
      intro: 'Geöffnet werden PDF, JPEG, PNG, WebP und GIF. Mehrere Dateien auf einmal werden ein Dokument.',
      steps: [
        'Klicken Sie auf „Datei auswählen“ und wählen Sie eine oder mehrere Dateien.',
        'Weitere Seiten: „+“ unter den Miniaturen oder eine Datei ins Fenster ziehen.',
        'Neu beginnen: „Neue Datei“. Bei nicht gespeicherten Änderungen wird nachgefragt.'
      ],
      tips: [
        'HEIC-Fotos vom iPhone lassen sich noch nicht öffnen: als JPEG speichern.',
        'Ein Bild kommt zuerst in „Seite vorbereiten“: siehe „Fotos und Scans von Seiten“.'
      ]
    },
    {
      id: 'edit',
      title: 'Text im Dokument ändern',
      intro: 'Das Werkzeug „Text bearbeiten“ ändert Text, der schon im PDF steht.',
      steps: [
        'Wählen Sie „Text bearbeiten“ und was bearbeitet wird: „Zeile“ oder „Wort“.',
        'Klicken Sie auf den Text und tippen Sie den neuen.',
        'Bei Bedarf Schrift, Größe, Farbe, fett oder kursiv in der Leiste unter dem Feld ändern. Die Pipette übernimmt den Stil eines beliebigen Textes der Seite.',
        'Speichern. Der alte Text wird aus der Datei herausgeschnitten, nicht nur überdeckt.'
      ],
      tips: [
        'Ein Absatz wird nicht neu umbrochen: Ein längeres Wort überlappt das nächste.',
        'Bei einem Scan zuerst den Text erkennen. Das Bild unter der Änderung bleibt in der Datei, darauf wird hingewiesen.',
        'Nach dem Entfernen von Vertraulichem: die gespeicherte Datei mit einem anderen Programm danach durchsuchen.'
      ]
    },
    {
      id: 'fill',
      title: 'Text und Markierungen eintragen',
      intro: 'Hat das PDF eigene Felder, klicken Sie einfach hinein und füllen sie aus. Sonst fügen Sie eigene hinzu.',
      steps: [
        'Wählen Sie „Text“, „Markierung“ oder „Text in Kästchen“ und klicken Sie auf die Stelle.',
        'Tippen Sie den Text. Bei einer Markierung wählen Sie Haken, Kreuz oder Punkt.',
        'Ziehen Sie das Feld am Griff; die Schriftgröße ändern die Schaltflächen darunter.'
      ],
      tips: [
        '„Text in Kästchen“ setzt jedes Zeichen in ein eigenes Kästchen, etwa für IBAN oder Geburtsdatum. Die Breite ist einstellbar.',
        'Ein Feld wiederholen: „Feld kopieren“, dann auf eine beliebige Seite klicken. Esc bricht ab.',
        'Beim Ziehen richten sich Felder an Nachbarn aus. Die Umschalttaste schaltet das ab.',
        'XFA-Formulare und JavaScript in Formularen werden nicht unterstützt.'
      ]
    },
    {
      id: 'sign',
      title: 'Unterschrift und Bild',
      intro: 'Eine Unterschrift wird gezeichnet oder getippt, ein Bild aus einer Datei eingefügt.',
      steps: [
        'Wählen Sie „Unterschrift“ und klicken Sie auf die Stelle.',
        'Mit Maus oder Finger zeichnen oder einen Namen tippen, dann „Fertig“.',
        'An die richtige Stelle ziehen und an der Ecke rechts unten vergrößern oder verkleinern.',
        'Für ein Bild „Bild“ wählen, auf die Seite und dann auf das Feld klicken und eine Datei wählen: JPEG, PNG, WebP oder GIF.'
      ],
      tips: [
        'Die Umschalttaste gibt beim Ändern der Größe die Proportionen frei.',
        'Es ist ein Bild einer Unterschrift, keine elektronische Signatur mit Zertifikat.',
        'Von Hand unterschreiben: siehe „Fotos und Scans von Seiten“.'
      ]
    },
    {
      id: 'fields',
      title: 'Felder eines Formulars finden',
      intro: 'Das Programm setzt leere Felder selbst auf Linien und in Kästchen.',
      steps: [
        'Rechtsklick auf eine Miniatur oder „⋯“ daneben.',
        '„Felder finden“ und „Diese Seite“ oder „Alle Seiten“ wählen.',
        'Die Stellen prüfen und die Felder ausfüllen.'
      ],
      tips: [
        'Rechts unter „Felder“ steht die Liste aller Felder. „Nummern anzeigen“ setzt Nummern auf die Seite, die nicht in die Datei kommen.',
        '„Felder löschen“ im selben Menü entfernt überflüssige.',
        'Für Tabellen eignet sich „Tabelle ausfüllen…“ besser.'
      ]
    },
    {
      id: 'table',
      title: 'Tabelle auf einem Scan ausfüllen',
      intro: 'Das Programm findet die Zellen einer linierten Tabelle und trägt Ihre Daten in die leeren Zeilen ein. Abtippen ist nicht nötig.',
      steps: [
        'Den gescannten Vordruck öffnen. Rechtsklick auf die Miniatur oder „⋯“, dann „Tabelle ausfüllen…“.',
        '„Datei öffnen…“ und eine Excel- (.xlsx) oder CSV-Datei wählen. Oder die Zeilen in Excel oder Google Sheets markieren, Strg+C, und im Fenster Strg+V.',
        'Bei mehreren Blättern eines auswählen. Unerwünschte Zeilen lassen sich direkt im Textfeld löschen.',
        'Enthält die erste Zeile Überschriften, das Häkchen „Die erste Zeile enthält Überschriften, überspringen“ setzen.',
        'Anzahl der Zeilen und Spalten und die Warnungen prüfen, dann „Ausfüllen“.',
        'Das Ergebnis ansehen. Strg+Z nimmt alles zurück.'
      ],
      tips: [
        'Die Spalten müssen dieselbe Reihenfolge haben wie im Vordruck. Für eine Spalte, die leer bleibt, eine leere Spalte in den Daten lassen.',
        'Nötig sind klare, vollständige Linien. Ein schräges Foto zuerst gerade rücken.',
        'Eine alte .xls in Excel als .xlsx speichern. Ausgeblendete Zeilen und Spalten fallen weg.',
        'CSV wird an Tab, „;“ oder „,“ getrennt.'
      ]
    },
    {
      id: 'ai',
      title: 'Mit einer KI ausfüllen',
      intro: 'LocalPDF bereitet Text für einen beliebigen KI-Chat vor und übernimmt dessen Antwort. Selbst sendet es nichts.',
      steps: [
        'Rechts die Liste „Felder“ öffnen und „Formular für KI kopieren“ wählen.',
        'Den Text in einen KI-Chat einfügen und Ihre Angaben ergänzen.',
        'Die Antwort kopieren, „KI-Antwort einfügen“ wählen, einfügen und „Ausfüllen“.',
        'Den Bericht lesen: Er nennt übersprungene Felder und den Grund.'
      ],
      tips: [
        'Was Sie selbst in einen Chat einfügen, sieht dessen Betreiber.',
        'Unterschriften und Bilder gehen nur von Hand. Ein Strg+Z nimmt alles Ausgefüllte zurück.'
      ]
    },
    {
      id: 'ocr',
      title: 'Text eines Scans erkennen',
      intro: 'Danach lässt sich der Text eines Scans durchsuchen, kopieren und bearbeiten. Ohne Internet, in acht Sprachen.',
      steps: [
        'Unten rechts die „Sprache der Texterkennung“ wählen.',
        'Rechtsklick auf eine Miniatur oder „⋯“, dann „Text erkennen“ und die Seiten wählen.',
        'Warten: Es dauert einige Sekunden pro Seite.',
        'Speichern: Die Datei ist nun durchsuchbar.'
      ],
      tips: ['Blasse und schiefe Scans werden schlechter gelesen, Handschrift gar nicht. Lesen Sie das Ergebnis durch.']
    },
    {
      id: 'pages',
      title: 'Seiten',
      intro: 'Die Schaltflächen neben einer Miniatur löschen, drehen und verschieben die Seite.',
      steps: [
        '✕ löscht die Seite, ⟳ dreht sie im Uhrzeigersinn, ↑ und ↓ verschieben sie.',
        '„⋯“ oder Rechtsklick auf die Miniatur: Text kopieren, nur diese Seite drucken, Felder leeren oder löschen.',
        '„+“ unter den Miniaturen fügt Seiten aus anderen Dateien hinzu.'
      ],
      tips: ['Die einzige Seite lässt sich nicht löschen.', 'Felder drehen und verschieben sich mit ihrer Seite.']
    },
    {
      id: 'photo',
      title: 'Fotos und Scans von Seiten',
      intro: 'Ein Foto eines Blatts wird gerade gerückt, zugeschnitten und aufbereitet. So kommt auch eine von Hand unterschriebene Seite zurück.',
      steps: [
        'Ein Foto öffnen oder ins Fenster ziehen: „Seite vorbereiten“ erscheint.',
        'Die Ecken des Blatts bei Bedarf anpassen und das Aussehen wählen: Farbe, Schwarzweiß oder ohne Bereinigung.',
        '„Fertig“. „Unverändert“ lässt das Bild, wie es ist.',
        'Eine Seite ersetzen: drucken, unterschreiben, fotografieren und im Menü der Miniatur „Durch Scan oder Foto ersetzen…“ wählen.'
      ]
    },
    {
      id: 'save',
      title: 'Speichern, drucken, Text entnehmen',
      intro: '„Herunterladen“ erstellt das fertige PDF und fragt nach dem Speicherort.',
      steps: [
        '„Herunterladen“ oder Strg+S.',
        'Der Pfeil neben „Herunterladen“: drucken, Text als Markdown kopieren oder speichern.',
        'Die Hinweise unten lesen: Sie sagen, wenn etwas nicht in die Datei kam.'
      ],
      tips: [
        'Wird nicht gespeichert, ist die Datei vielleicht in einem anderen Programm geöffnet. Wählen Sie einen anderen Namen.',
        'Nach einem Absturz bietet das Programm an, das nicht gespeicherte Dokument wiederherzustellen.'
      ]
    },
    {
      id: 'password',
      title: 'Dateien mit Passwort',
      intro: 'Ein geschütztes PDF öffnet sich nach Eingabe des Passworts.',
      steps: [
        'Die Datei öffnen und das Passwort eingeben.',
        'Soll auch die gespeicherte Datei geschützt sein, „Passwort beibehalten“ wählen.'
      ],
      tips: ['Ein unbekanntes Passwort kann das Programm nicht erraten oder entfernen.']
    },
    {
      id: 'privacy',
      title: 'Datenschutz',
      intro: 'Dokumente bleiben auf Ihrem Computer: Die App blockiert Netzwerkanfragen nach außen, Texterkennung und Hilfe arbeiten ohne Internet.',
      tips: [
        'Solange es nicht gespeicherte Änderungen gibt, liegt eine Kopie unverschlüsselt in %APPDATA%\\LocalPDF\\recovery. Sie wird beim Speichern und normalen Schließen entfernt. Dokumente mit Passwort werden dort nie abgelegt.',
        'Feedback senden nur Sie selbst, von der GitHub-Seite aus. Der Text enthält nichts aus Dokumenten und keine Dateinamen, außer Sie schreiben sie hinein.'
      ]
    },
    {
      id: 'shortcuts',
      title: 'Tastenkürzel',
      intro: 'Sie funktionieren mit jeder Tastaturbelegung.',
      steps: [
        'F1: Hilfe.',
        'Strg+S: speichern, Strg+P: drucken.',
        'Strg+Z: rückgängig, Strg+Umschalt+Z: wiederholen.',
        'Esc: Fenster schließen, Einfügen eines Felds oder Pipette abbrechen.',
        'Umschalttaste beim Ziehen: ohne Ausrichten; beim Ändern der Größe: freie Proportionen.'
      ]
    },
    {
      id: 'extension',
      title: 'Browser-Erweiterung',
      intro: 'Derselbe Editor läuft als Erweiterung für Chrome und Edge, mit kleinen Unterschieden.',
      tips: [
        'PDFs öffnen sich nicht per Doppelklick: auf die Schaltfläche der Erweiterung klicken und eine Datei wählen.',
        'Die Wiederherstellungskopie liegt unverschlüsselt im Profil des Browsers.',
        'Gedruckt wird über den Dialog des Browsers.'
      ]
    },
    {
      id: 'limits',
      title: 'Grenzen',
      intro: 'Dies ist eine Beta. Prüfen Sie das Ergebnis und behalten Sie Ihre Originale.',
      tips: [
        'Text auf einem Bild lässt sich nicht herausschneiden, er wird nur überdeckt und bleibt in der Datei.',
        'Geänderter Text erscheint nur in der Schrift des Dokuments, wenn die Datei alle Buchstaben enthält, sonst in einer ähnlichen.',
        'XFA, JavaScript in Formularen und HEIC werden nicht unterstützt.',
        'Das Finden von Feldern und Tabellen kann bei schiefen Scans danebenliegen.'
      ]
    }
  ],
  questions: [
    {
      question: 'Muss ich die Daten einer Tabelle abtippen?',
      answer: 'Nein. Öffnen Sie in „Tabelle ausfüllen…“ eine Excel- oder CSV-Datei, oder kopieren Sie die Zeilen und fügen Sie sie mit Strg+V ein.',
      section: 'table'
    },
    {
      question: 'Wo sind „Text erkennen“, „Felder finden“ und „Tabelle ausfüllen…“?',
      answer: 'Im Menü der Seite: „⋯“ neben der Miniatur links oder Rechtsklick auf die Miniatur.',
      section: 'start'
    },
    {
      question: 'Es wurde keine Tabelle gefunden. Warum?',
      answer: 'Nötig sind klare, durchgehende Linien und ein äußerer Rahmen. Scannen Sie gerader oder rücken Sie das Foto gerade und versuchen Sie es erneut.',
      section: 'table'
    },
    {
      question: 'Die Daten stehen in den falschen Spalten. Was tun?',
      answer: 'Strg+Z. Die Spalten der Daten müssen die Reihenfolge des Vordrucks haben; für eine ausgelassene bleibt eine leere.',
      section: 'table'
    },
    {
      question: 'Meine Excel-Datei lässt sich für die Tabelle nicht öffnen.',
      answer: 'Es muss .xlsx sein. Speichern Sie eine alte .xls oder eine Datei mit Passwort in Excel als normale .xlsx, oder kopieren Sie die Zeilen und fügen Sie sie ein.',
      section: 'table'
    },
    {
      question: 'Werden meine Dokumente irgendwohin gesendet?',
      answer: 'Nein. Die App blockiert Netzwerkanfragen nach außen, alles geschieht auf Ihrem Computer.',
      section: 'privacy'
    },
    {
      question: 'Warum kann ich den Text nicht bearbeiten?',
      answer: 'Die Seite ist wahrscheinlich ein Scan, also ein Bild. Erkennen Sie zuerst den Text, dann bearbeiten Sie ihn.',
      section: 'ocr'
    },
    {
      question: 'Warum sieht der geänderte Text anders aus?',
      answer: 'In der Datei fehlen Buchstaben der Schrift, daher wird eine ähnliche benutzt. Versuchen Sie die Pipette oder eine andere Schrift in der Leiste unter dem Feld.',
      section: 'edit'
    },
    {
      question: 'Ist entfernter Text wirklich aus der Datei verschwunden?',
      answer: 'Normaler Text wird herausgeschnitten und das Ergebnis geprüft. Text auf einem Bild wird nur überdeckt, darauf wird hingewiesen.',
      section: 'edit'
    },
    {
      question: 'Ist meine Unterschrift rechtsgültig?',
      answer: 'Es ist ein Bild einer Unterschrift, keine elektronische Signatur mit Zertifikat. Ob es angenommen wird, entscheidet der Empfänger.',
      section: 'sign'
    },
    {
      question: 'Windows warnt vor einem unbekannten Herausgeber. Ist das gefährlich?',
      answer: 'Der Installer ist noch nicht signiert. Wenn Sie ihn von der Releases-Seite des Projekts haben und ihr vertrauen: „Weitere Informationen“, dann „Trotzdem ausführen“.'
    },
    {
      question: 'Das Programm wurde geschlossen, bevor ich gespeichert habe.',
      answer: 'Öffnen Sie LocalPDF erneut: Es bietet an, das Dokument wiederherzustellen. Mit Passwort geöffnete Dateien werden nicht wiederhergestellt.',
      section: 'save'
    },
    {
      question: 'Warum lässt sich die Datei nicht speichern?',
      answer: 'Meist ist sie in einem anderen Programm geöffnet. Schließen Sie es oder wählen Sie einen anderen Namen oder Ordner.',
      section: 'save'
    },
    {
      question: 'Wie ändere ich die Sprache?',
      answer: 'Unten in der rechten Leiste oder in der Ecke des Startbildschirms. Die Sprache für Scans wird getrennt gewählt.',
      section: 'ocr'
    },
    {
      question: 'Wie melde ich ein Problem oder schlage eine Idee vor?',
      answer: 'Klicken Sie unter den Miniaturen oder auf dem Startbildschirm auf „Feedback“. Zum Senden ist ein GitHub-Konto nötig, und jeder kann den Eintrag lesen.'
    }
  ]
}
