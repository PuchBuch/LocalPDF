# Privacy policy

*Applies to the LocalPDF Windows app and the LocalPDF Chrome extension. Last updated: 16 November 2026.*

LocalPDF does not collect, send or share any data. It has no accounts, no analytics, no advertising and no servers.

## Your documents

The PDF files and pictures you open are read and edited only on your computer. They are never uploaded. Text recognition (OCR), fonts and every other part of the editor are included in the app and run locally.

The Windows app blocks all outside network requests. The Chrome extension requests no permissions and its content security policy allows no connections to other sites, so it cannot send your files anywhere.

"Report a problem…" only prepares a text: the version, the variant, Windows and the browser, the interface language and the kinds of recent errors, never the content of a document or a file name. You see the text first, and you send it yourself through GitHub; LocalPDF sends nothing. The list of recent errors is kept in memory only and is gone when you close LocalPDF.

## What is stored on your computer

- **Settings:** the interface language and the text recognition language.
- **Crash recovery:** while a document has unsaved changes, a copy is kept so that it can be restored after a crash. The Windows app keeps it in `%APPDATA%\LocalPDF\recovery`, the extension in its own storage in your browser profile. The copy is not encrypted. It is deleted when you save or close the document normally. Documents opened with a password are never stored.

This data stays on your computer. Removing the extension deletes its storage. Uninstalling the Windows app leaves the folder `%APPDATA%\LocalPDF` in place; you can delete it by hand.

## Changes

Changes to this policy are published in this file, with the date above.

## Contact

Questions: [open an issue](https://github.com/PuchBuch/LocalPDF/issues) on GitHub.
