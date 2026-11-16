# Chrome Web Store listing

What to enter in the Chrome Web Store developer dashboard. Images are in this folder; `node scripts/store-images.mjs` takes them again after `npm run build:extension`.

## Package

Upload the zip of the current version, the one in `package.json`: `release/LocalPDF-extension-<version>.zip`. The Release workflow builds it in the cloud as its `chrome-extension` artifact; `npm run build:extension` builds it locally.

A German listing is in [LISTING.de.md](LISTING.de.md).

## Store listing

**Name:** LocalPDF (from the manifest)

**Summary** (from the manifest, at most 132 characters):

> Edit PDF files on your computer. Nothing is uploaded: this extension has no permissions and no network access.

**Category:** Tools

**Language:** English

**Description:**

> LocalPDF is a PDF editor that keeps your documents on your computer. Files are never uploaded: the extension asks for no permissions and cannot connect to any website. Text recognition runs inside the extension too.
>
> What you can do:
> • Edit text in place: click a line or a word and retype it. Bold, italic and color carry over.
> • Keep the look of the document: new text is set in the document's own font when the file holds the letters it needs, and a picker copies the style of any text on the page.
> • Remove text for real: replaced text is cut out of the saved file, not only covered.
> • Fill in forms, tick boxes, and sign with a drawn or typed signature.
> • Add text, pictures and form fields anywhere on a page.
> • See every field by number, in reading order, and jump to any of them from a list.
> • Fill a form with any AI chat you choose, without the extension going online: it copies the numbered fields as text, you paste them into the chat yourself, then paste the answer back. Each field is checked, problems are listed, and one undo takes it all back.
> • Make scans searchable with offline text recognition in English, German, French, Spanish, Italian, Polish, Ukrainian and Russian.
> • Delete, rotate and reorder pages, and merge PDFs and pictures into one file.
> • Turn a phone photo of a page into a clean PDF page: the sheet is found, straightened, cropped and cleaned like a scan.
> • Sign a page by hand: print that page alone, sign it, then put a scan or a phone photo of it in its place. A photo is straightened, cropped to the sheet and cleaned up.
> • Open password-protected PDFs, and keep the protection when saving.
> • Print, and copy a document's text as Markdown.
> • Get your work back after a browser crash.
>
> The interface is available in English, Deutsch, Français, Español, Italiano, Polski, Українська and Русский.
>
> How to use it: click the LocalPDF button in the toolbar, then "Choose a file" and pick a PDF or a picture. Save the result with "Download". "Print" and "Copy text as Markdown" are in the menu of the arrow next to "Download". To make a scan searchable, right-click its page on the left and choose "Recognize text", then "This page" or "All pages". To number the fields, tick "Show numbers" on the right; open "Fields" for the list and for "Copy form for AI" and "Paste AI answer".
>
> This is a beta. Check the result before you rely on it, and keep your originals. Some limits:
> • Text inside pictures and scans cannot be cut out, only covered, and the app warns you.
> • When a font is not embedded in the file or lacks a letter, edited text uses one of four standard fonts, so an unusual font will look different.
> • XFA forms and JavaScript in forms are not supported.
> • PDFs cannot be opened with a double-click in Windows; open them from the extension.
>
> LocalPDF is open source under the MIT licence. There is also a Windows app.
> Source code and issues: https://github.com/PuchBuch/LocalPDF

**Icon:** `icon-128.png`

**Screenshots** (1280×800), in this order:

1. `1-edit-text.jpg`
2. `2-forms-and-signature.jpg`
3. `3-recognize-scans.jpg`
4. `4-pages.jpg`
5. `5-private.jpg`

**Small promo tile** (440×280): `promo-small-440x280.jpg`

**Marquee promo tile** (1400×560, optional): `promo-marquee-1400x560.jpg`

**Homepage URL:** https://github.com/PuchBuch/LocalPDF

**Support URL:** https://github.com/PuchBuch/LocalPDF/issues

## Privacy practices

**Single purpose:**

> Open, edit and save PDF files locally in the browser, without uploading them.

**Permission justification:** the extension requests no permissions and no host permissions, so there is nothing to justify.

**Remote code:** No, I am not using remote code. All scripts, WebAssembly, fonts and text recognition data are packed inside the extension.

**Data usage:** tick none of the data types. The extension does not collect or transmit any user data.

Certify all three statements:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/PuchBuch/LocalPDF/blob/main/PRIVACY.md

## Distribution

**Visibility:** Public. **Regions:** all.
