import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { it } from './it'
import { pl } from './pl'
import { ru, type Messages } from './ru'
import { uk } from './uk'

export type Locale = 'en' | 'de' | 'fr' | 'es' | 'it' | 'pl' | 'uk' | 'ru'

/** Each language under its own name, as a person who reads only that language looks for it. */
export const LOCALES: { id: Locale; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch' },
  { id: 'fr', name: 'Français' },
  { id: 'es', name: 'Español' },
  { id: 'it', name: 'Italiano' },
  { id: 'pl', name: 'Polski' },
  { id: 'uk', name: 'Українська' },
  { id: 'ru', name: 'Русский' }
]

const MESSAGES: Record<Locale, Messages> = { en, de, fr, es, it, pl, uk, ru }

const DEFAULT_LOCALE: Locale = 'en'

let locale: Locale = DEFAULT_LOCALE

/** The texts of the current language. The app is drawn anew when it changes. */
export let t: Messages = MESSAGES[DEFAULT_LOCALE]

export const currentLocale = (): Locale => locale

export function setLocale(next: Locale): void {
  locale = next
  t = MESSAGES[next]
  document.documentElement.lang = next
}

/** The language for a system locale such as de-AT, or the default one if the app lacks it. */
export function matchLocale(wanted: string | null | undefined): Locale | null {
  const language = wanted?.toLowerCase().split(/[-_]/)[0]
  return LOCALES.find(({ id }) => id === language)?.id ?? null
}

export { DEFAULT_LOCALE }
