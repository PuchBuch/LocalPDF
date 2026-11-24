import type { Locale } from '../i18n'
import { de } from './de'
import { en } from './en'
import { ru } from './ru'
import type { HelpTexts } from './types'

const TEXTS: Partial<Record<Locale, HelpTexts>> = { en, de, ru }

/** Whether the guide is written in a language, and not shown in English instead. */
export const hasOwnHelp = (locale: Locale): boolean => TEXTS[locale] !== undefined

export const helpTexts = (locale: Locale): HelpTexts => TEXTS[locale] ?? en
