# Changelog

Every fix or change adds a line under **Unreleased**. Once a week `node scripts/release.mjs` turns that section into a new version.

## Unreleased

- "Fill a table…" in the menu of a page finds a ruled table on a scan and writes rows from an Excel (.xlsx) or CSV file, or pasted from Excel or Google Sheets, into its empty rows, as one step to undo.

## 0.9.0-beta.12 (2026-11-17)

- The README describes the document's own font and the style picker, and their limits.
- The browser extension is tested in Microsoft Edge as well as Chromium.
- "Report a problem…", in the menu beside Download and on the start screen, prepares a report with the version, the system and the kinds of recent errors, without file names or document content. You check it and send it yourself on GitHub.
- A German README, and the German, Russian and Ukrainian texts as tables for native speakers to correct.
- A project page in English and German, in `docs/` for GitHub Pages, with no scripts, counters or outside fonts.

## 0.9.0-beta.11 (2026-11-15)

- Digits and letters no longer look slightly different after an edit when a PDF carries part of Arial, Times New Roman or a similar font: the font from the file is used.

## 0.9.0-beta.10 (2026-11-15)

- A replaced word starts exactly where the old one did, instead of a point or two to the right.
- Text keeps its baseline and left edge when the style picker or the font list changes its font or size.

## 0.9.0-beta.9 (2026-11-15)

- Edited text is set in the document's own font when the file holds the letters it needs, and the saved text stays searchable.
- A picker copies the style of any text on the page. A warning shows when the document's font lacks a letter.

## Earlier versions

See [Releases](https://github.com/PuchBuch/LocalPDF/releases).
