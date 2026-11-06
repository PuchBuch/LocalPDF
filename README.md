# LocalPDF

A PDF editor for Windows that keeps your documents on your computer. Files are never uploaded: the app blocks all outside network requests, and text recognition runs locally.

**This is a beta.** It is well tested on generated files but has seen few real-world documents. Check the result before you rely on it, and keep your originals. [Report a problem](../../issues).

*Русская версия: [README.ru.md](README.ru.md)*

## What it does

- **Edit text in place:** click a line or a word and retype it. Bold, italic and color carry over, and a similar font is picked for you.
- **Remove text for real:** replaced text is cut out of the saved file, not only covered, and the result is checked.
- **Fill in forms:** a PDF's own form fields, or fields you place yourself, with text, ticks, crosses, dots, signatures and pictures.
- **Find fields:** adds empty fields at blank lines and boxes.
- **Recognize text in scans (OCR):** offline, in eight languages. Saved files can be searched.
- **Manage pages:** delete, rotate, reorder, and merge PDFs and pictures.
- **Passwords:** opens protected PDFs, and can keep the protection when saving.
- **Also:** print, extract text as Markdown, recovery after a crash.
- **Languages:** English, Deutsch, Français, Español, Italiano, Polski, Українська, Русский.

## Install

Download `LocalPDF Setup` from [Releases](../../releases) and run it.

Windows may warn that the publisher is unknown, because the installer is not signed yet. Choose **More info**, then **Run anyway**, if you trust this download.

To open PDFs with a double-click, right-click a PDF, then **Open with**, **Choose another app**, **LocalPDF**, **Always**.

## Known limits

- **Pictures and scans:** text on a picture cannot be cut out. It is only covered and stays in the file, and the app warns you. For scans with confidential data, print to PDF instead and check the result.
- **Confidential documents:** after removing something sensitive, search the saved file for it in another PDF viewer. Do not rely only on this app.
- **Edited text** is set in one of four fonts (like Arial, Times New Roman, Calibri or Courier New), so an unusual font will look different. A paragraph does not reflow: a longer word overlaps the next one.
- **Forms:** XFA forms and JavaScript in forms are not supported.
- **Text recognition** is less accurate on faint or skewed scans and does not read handwriting. Read through what it finds.
- **Finding fields** does not detect single-letter cells and may miss or misplace fields on skewed scans.
- **Printing** sends pages as images, so very large documents can take a while.
- **Crash recovery:** while a document has unsaved changes, a copy lies unencrypted in `%APPDATA%\LocalPDF\recovery`. It is removed when you save or close normally. Documents opened with a password are never stored there.

## Translations

The translations were machine-made and have not yet been read by native speakers. Corrections are welcome: see `src/renderer/src/i18n`.

## Development

```powershell
npm install        # dependencies and the Electron binary
npm run dev        # run in development
npm test           # tests of the core and export
npm run test:e2e   # interface tests: app windows open on the screen
npm run typecheck
npm run dist       # the installer, in release/
```

If Electron crashes with `Cannot read properties of undefined (reading 'isPackaged')`, your terminal has `ELECTRON_RUN_AS_NODE` set. Clear it: `Remove-Item Env:\ELECTRON_RUN_AS_NODE`.

- `src/core`: the document model and geometry, free of the interface.
- `src/export`: building the final PDF.
- `src/main`, `src/preload`: the Electron process and a narrow bridge to the interface.
- `src/renderer`: the React interface. Texts are in `src/renderer/src/i18n`.
- `tests`, `e2e`: tests. Documents for manual checks go in `samples/private/`, which git ignores.

Tinos, Carlito and Cousine are embedded whole rather than as a subset, because cutting them down loses most of their letters while the text still reads fine to software. Check any new font in pixels, as `tests/word-and-font.test.ts` does.

## Licences

LocalPDF is released under the [MIT License](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the software and fonts it uses, which have their own licences.
