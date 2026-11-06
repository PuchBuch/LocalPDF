# Third-party software

LocalPDF is built with the following software. Thanks to its authors. The full text of each licence is in the named package or font file.

## Libraries in the application

| Software | Licence |
| --- | --- |
| [Electron](https://www.electronjs.org/) and Chromium | MIT, and the licences listed in `LICENSES.chromium.html` next to the installed app |
| [React](https://react.dev/), React DOM | MIT |
| [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`) | Apache-2.0 |
| [pdf-lib](https://pdf-lib.js.org/), `@pdf-lib/fontkit`, `@pdf-lib/standard-fonts` | MIT |
| [qpdf](https://qpdf.sourceforge.io/), compiled to WebAssembly as `@neslinesli93/qpdf-wasm` | Apache-2.0 for qpdf, ISC for the package |
| [Tesseract](https://github.com/tesseract-ocr/tesseract), [tesseract.js](https://tesseract.projectnaptha.com/), `tesseract.js-core` | Apache-2.0 |
| Language data, `@tesseract.js-data/*` | Apache-2.0 for the Tesseract data, MIT for the packages |
| [Immer](https://immerjs.github.io/immer/), [Zustand](https://zustand.docs.pmnd.rs/), [signature_pad](https://github.com/szimek/signature_pad) | MIT |
| [pako](https://github.com/nodeca/pako) | MIT and Zlib |

## Fonts

All are under the SIL Open Font License 1.1. Their licences are installed with the app in the `fonts` folder.

| Font | Used for |
| --- | --- |
| Liberation Sans | Text, in place of Arial |
| Tinos | Text, in place of Times New Roman |
| Carlito | Text, in place of Calibri |
| Cousine | Text, in place of Courier New |
| Roboto Mono | Text in cells |
| Caveat | Typed signatures |

Arial, Times New Roman, Calibri and Courier New are trademarks of their owners. LocalPDF does not contain these fonts. It uses free fonts with matching letter widths.
