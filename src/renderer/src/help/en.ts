import type { HelpTexts } from './types'

export const en: HelpTexts = {
  sections: [
    {
      id: 'start',
      title: 'Getting started',
      intro: 'LocalPDF edits and fills in PDFs on your computer. Documents are not sent anywhere.',
      steps: [
        'Open a file: “Choose a file”, or drop it on the window.',
        'Choose a tool on the right and click the page. The line below the tools says what the chosen one does.',
        'Press “Download” and choose where to save. The original does not change unless you choose its own name.'
      ],
      tips: [
        'On the left are thumbnails of the pages. The “⋯” button beside one, or a right click on it, opens the other actions: recognize text, find fields, fill a table, print, replace.',
        'Made a mistake? Press “Undo” or Ctrl+Z.',
        'F1 opens this help at the chapter that fits.'
      ]
    },
    {
      id: 'open',
      title: 'Open and merge files',
      intro: 'PDF, JPEG, PNG, WebP and GIF can be opened. Several files at once become one document.',
      steps: [
        'Press “Choose a file” and choose one or several.',
        'To add more pages, press “+” below the thumbnails or drop a file on the window.',
        'To start again, press “New file”. If there are unsaved changes, you are asked about them.'
      ],
      tips: [
        'HEIC photos from an iPhone cannot be opened yet: save them as JPEG.',
        'A picture first goes to “Prepare the page”: see “Photos and scans of pages”.'
      ]
    },
    {
      id: 'edit',
      title: 'Change text of the document',
      intro: 'The “Edit text” tool changes text the PDF already has.',
      steps: [
        'Choose “Edit text” and what to edit: “Line” or “Word”.',
        'Click the text and type the new one.',
        'If needed, change the font, size, colour, bold or italic in the bar above the field. The picker takes the style of any text on the page.',
        'Save. The old text is cut out of the file, not only covered.'
      ],
      tips: [
        'A paragraph does not reflow: a longer word overlaps the next one.',
        'On a scan, recognize its text first. The picture under a change stays in the file, and you are warned.',
        'After removing something secret, search the saved file for it in another program.'
      ]
    },
    {
      id: 'fill',
      title: 'Write text and marks',
      intro: 'If the PDF has fields of its own, just click and fill them in. Otherwise add your own.',
      steps: [
        'Choose “Text”, “Mark” or “Text in cells” and click a place on the page.',
        'Type the text. For a mark, choose a tick, a cross or a dot.',
        'Drag the field by its handle, and change the font size with the buttons above it.'
      ],
      tips: [
        '“Text in cells” puts each character in a cell of its own, for an IBAN or a date of birth. The width of the cells can be changed.',
        'To repeat a field, press “Copy field” and click a place on any page. Esc cancels.',
        'A dragged field lines up with its neighbours. Shift turns that off.',
        'XFA forms and JavaScript in forms are not supported.'
      ]
    },
    {
      id: 'sign',
      title: 'Signature and picture',
      intro: 'A signature can be drawn or typed, a picture is taken from a file.',
      steps: [
        'Choose “Signature” and click a place on the page.',
        'Draw the signature with the mouse or a finger, or type a name, then press “Done”.',
        'Drag it into place and resize it by its bottom right corner.',
        'For a picture, choose “Picture”, click the page, then click the field and choose a JPEG, PNG, WebP or GIF file.'
      ],
      tips: [
        'Shift while resizing unlocks the proportions.',
        'This is a picture of a signature, not a digital signature with a certificate.',
        'For a signature by hand, see “Photos and scans of pages”.'
      ]
    },
    {
      id: 'fields',
      title: 'Find the fields of a form',
      intro: 'The app puts empty fields on lines and in boxes by itself.',
      steps: [
        'Right click a thumbnail, or press “⋯” beside it.',
        'Choose “Find fields” and “This page” or “All pages”.',
        'Check the places and fill in the fields.'
      ],
      tips: [
        'The “Fields” panel on the right lists all of them. “Show numbers” puts numbers on the page, which do not go into the file.',
        '“Delete fields” in the same menu removes unneeded ones.',
        'For tables, “Fill a table…” works better.'
      ]
    },
    {
      id: 'table',
      title: 'Fill a table on a scan',
      intro: 'The app finds the cells of a ruled table and writes your data into its empty rows. There is no need to type it.',
      steps: [
        'Open the scanned form. Right click its thumbnail, or press “⋯”, and choose “Fill a table…”.',
        'Press “Open a file…” and choose an Excel (.xlsx) or CSV file. Or select the rows in Excel or Google Sheets, press Ctrl+C, and Ctrl+V in the dialog.',
        'If the file has several sheets, choose one. Rows you do not want can be deleted right there.',
        'If the first row is headings, tick “The first row is headings, skip it”.',
        'Check the number of rows and columns and the warnings, then press “Fill in”.',
        'Look the result over. Ctrl+Z takes all of it back.'
      ],
      tips: [
        'The columns must be in the same order as on the form. For a column of the form you leave blank, keep an empty column in the data.',
        'Clear, complete lines are needed. Straighten a photo taken at an angle first.',
        'Save an old .xls as .xlsx in Excel. Hidden rows and columns are left out.',
        'CSV is split at Tab, “;” or “,”.'
      ]
    },
    {
      id: 'ai',
      title: 'Fill in with an AI',
      intro: 'LocalPDF prepares text for any AI chat and takes its answer. It sends nothing itself.',
      steps: [
        'Open the “Fields” list on the right and press “Copy form for AI”.',
        'Paste the text into an AI chat and add your data.',
        'Copy the answer, press “Paste AI answer”, paste it and press “Fill in”.',
        'Read the report: it says which fields were skipped and why.'
      ],
      tips: [
        'What you paste into a chat yourself is seen by those who run it.',
        'Signatures and pictures can only be added by hand. One Ctrl+Z takes back all that was filled.'
      ]
    },
    {
      id: 'ocr',
      title: 'Recognize the text of a scan',
      intro: 'Once recognized, the text of a scan can be searched, copied and edited. It works offline, in eight languages.',
      steps: [
        'Choose the “Text recognition language” at the bottom right.',
        'Right click a thumbnail, or press “⋯”, choose “Recognize text” and the pages.',
        'Wait: it takes some seconds for each page.',
        'Save the file: it can now be searched.'
      ],
      tips: ['Faint and skewed scans are read less well, handwriting not at all. Read through the result.']
    },
    {
      id: 'pages',
      title: 'Pages',
      intro: 'The buttons beside a thumbnail delete, rotate and move its page.',
      steps: [
        '✕ deletes the page, ⟳ rotates it clockwise, ↑ and ↓ move it.',
        '“⋯” or a right click on the thumbnail: copy its text, print only this page, clear or delete its fields.',
        '“+” below the thumbnails adds pages from other files.'
      ],
      tips: ['The only page cannot be deleted.', 'Fields turn and move together with their page.']
    },
    {
      id: 'photo',
      title: 'Photos and scans of pages',
      intro: 'A photo of a sheet is straightened, cropped and cleaned. This also brings back a page signed by hand.',
      steps: [
        'Open a photo or drop it on the window: “Prepare the page” appears.',
        'Correct the corners of the sheet if needed and choose a look: colour, black and white, or not cleaned.',
        'Press “Done”. “Use as is” leaves the picture as it is.',
        'To replace a page: print it, sign it, take a photo and choose “Replace with a scan or photo…” in the menu of the thumbnail.'
      ]
    },
    {
      id: 'save',
      title: 'Save, print, extract text',
      intro: '“Download” builds the finished PDF and asks where to save it.',
      steps: [
        'Press “Download” or Ctrl+S.',
        'The arrow beside “Download” has printing, and copying or saving the text as Markdown.',
        'Read the notices at the bottom: they say if something did not get into the file.'
      ],
      tips: [
        'If it does not save, the file may be open in another program. Choose another name.',
        'After a crash, the app offers to restore the unsaved document.'
      ]
    },
    {
      id: 'password',
      title: 'Files with a password',
      intro: 'A protected PDF opens once its password is entered.',
      steps: ['Open the file and enter the password.', 'To protect the saved file with it too, tick “Keep password”.'],
      tips: ['The app cannot guess or remove a password you do not know.']
    },
    {
      id: 'privacy',
      title: 'Privacy',
      intro: 'Documents stay on your computer: the app blocks outside network requests, and recognition and this help work offline.',
      tips: [
        'While there are unsaved changes, a recovery copy lies unencrypted in %APPDATA%\\LocalPDF\\recovery. It is removed when you save or close normally. Documents with a password are never stored there.',
        'Feedback is sent only by you, from the GitHub page. Its text holds nothing from documents and no file names unless you write them in.'
      ]
    },
    {
      id: 'shortcuts',
      title: 'Keyboard shortcuts',
      intro: 'They work on any keyboard layout.',
      steps: [
        'F1: help.',
        'Ctrl+S: save, Ctrl+P: print.',
        'Ctrl+Z: undo, Ctrl+Shift+Z: redo.',
        'Esc: close a dialog, cancel pasting a field or picking a style.',
        'Shift while dragging: no alignment; while resizing: free proportions.'
      ]
    },
    {
      id: 'extension',
      title: 'Browser extension',
      intro: 'The same editor runs as an extension for Chrome and Edge, with a few differences.',
      tips: [
        'PDFs do not open with a double-click: press the button of the extension and choose a file.',
        'The recovery copy lies unencrypted in the profile of the browser.',
        'Printing uses the dialog of the browser.'
      ]
    },
    {
      id: 'limits',
      title: 'Limits',
      intro: 'This is a beta. Check the result and keep your originals.',
      tips: [
        'Text on a picture cannot be cut out, it is only covered and stays in the file.',
        'Edited text is set in the document’s font only if the file has every letter needed, otherwise in a similar one.',
        'XFA, JavaScript in forms and HEIC are not supported.',
        'Finding fields and tables can go wrong on skewed scans.'
      ]
    }
  ],
  questions: [
    {
      question: 'Do I have to type the data of a table?',
      answer: 'No. Open an Excel or CSV file in “Fill a table…”, or copy the rows and paste them with Ctrl+V.',
      section: 'table'
    },
    {
      question: 'Where are “Recognize text”, “Find fields” and “Fill a table…”?',
      answer: 'In the menu of a page: the “⋯” button beside its thumbnail on the left, or a right click on the thumbnail.',
      section: 'start'
    },
    {
      question: 'The app says no table was found. Why?',
      answer: 'It needs clear, unbroken lines and an outer frame. Scan the sheet straighter, or straighten the photo, and try again.',
      section: 'table'
    },
    {
      question: 'The data went into the wrong columns. What now?',
      answer: 'Press Ctrl+Z. The columns of the data must be in the order of the form; leave an empty one for a column you skip.',
      section: 'table'
    },
    {
      question: 'My Excel file does not open for the table.',
      answer: 'It must be .xlsx. Save an old .xls, or a file with a password, as a plain .xlsx in Excel, or copy its rows and paste them.',
      section: 'table'
    },
    {
      question: 'Are my documents sent anywhere?',
      answer: 'No. The app blocks outside network requests, and everything is done on your computer.',
      section: 'privacy'
    },
    {
      question: 'Why can I not edit the text?',
      answer: 'The page is most likely a scan, which is a picture. Recognize its text first, then edit it.',
      section: 'ocr'
    },
    {
      question: 'Why does the edited text look different?',
      answer: 'The file lacks letters of its font, so a similar one is used. Try the picker, or another font in the bar above the field.',
      section: 'edit'
    },
    {
      question: 'Is removed text really gone from the file?',
      answer: 'Ordinary text is cut out, and the result is checked. Text on a picture is only covered, and you are warned of it.',
      section: 'edit'
    },
    {
      question: 'Is my signature legally binding?',
      answer: 'It is a picture of a signature, not a digital signature with a certificate. Whether it is accepted is up to the recipient.',
      section: 'sign'
    },
    {
      question: 'Windows warns of an unknown publisher. Is that dangerous?',
      answer: 'The installer is not signed yet. If you downloaded it from the Releases page of the project and trust it, choose “More info”, then “Run anyway”.'
    },
    {
      question: 'The app closed before I saved.',
      answer: 'Open LocalPDF again: it offers to restore the document. Files opened with a password are not restored.',
      section: 'save'
    },
    {
      question: 'Why does the file not save?',
      answer: 'Most often it is open in another program. Close that, or choose another name or folder.',
      section: 'save'
    },
    {
      question: 'How do I change the language?',
      answer: 'At the bottom of the right panel, or in the corner of the start screen. The language for reading scans is chosen separately.',
      section: 'ocr'
    },
    {
      question: 'How do I report a problem or suggest an idea?',
      answer: 'Press “Feedback” below the thumbnails or on the start screen. Sending needs a GitHub account, and anyone can read it.'
    }
  ]
}
