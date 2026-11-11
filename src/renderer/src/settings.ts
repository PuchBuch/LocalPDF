import { DEFAULT_LOCALE, matchLocale, setLocale, t, type Locale } from './i18n'
import { useEditor } from './store'

const LOCALE_KEY = 'localpdf.locale'
const OCR_LOCALE_KEY = 'localpdf.ocrLocale'
const SHOW_NUMBERS_KEY = 'localpdf.showFieldNumbers'

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Without storage the choice lasts until the window closes.
  }
}

/** The open dialogs of the system are drawn by the app around the window, in the same language. */
function sendDialogTexts(): void {
  window.localpdf.setDialogTexts(t.dialogs)
}

/** Picks the language at startup: the one chosen before, else the system's, else the default. */
export async function loadLanguage(): Promise<void> {
  const system = await window.localpdf.systemLocale()
  const locale = matchLocale(remembered(LOCALE_KEY)) ?? matchLocale(system) ?? DEFAULT_LOCALE
  setLocale(locale)
  sendDialogTexts()
  useEditor.setState({
    locale,
    ocrLocale: matchLocale(remembered(OCR_LOCALE_KEY)) ?? locale,
    showFieldNumbers: remembered(SHOW_NUMBERS_KEY) === '1'
  })
}

export function changeLanguage(locale: Locale): void {
  setLocale(locale)
  remember(LOCALE_KEY, locale)
  sendDialogTexts()
  useEditor.setState((state) => ({
    locale,
    // Until a language is chosen for recognition, it follows the one of the app.
    ocrLocale: remembered(OCR_LOCALE_KEY) ? state.ocrLocale : locale
  }))
}

/** Numbers on the fields are off until switched on, and then stay on. */
export function changeShowFieldNumbers(show: boolean): void {
  remember(SHOW_NUMBERS_KEY, show ? '1' : '0')
  useEditor.setState({ showFieldNumbers: show })
}

export function changeOcrLanguage(locale: Locale): void {
  remember(OCR_LOCALE_KEY, locale)
  useEditor.setState({ ocrLocale: locale })
}
