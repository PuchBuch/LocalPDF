/** A count with its word, in the form the Slavic languages use after that number. */
export function counted(locale: 'ru' | 'uk' | 'pl', count: number, one: string, few: string, many: string): string {
  const form = new Intl.PluralRules(locale).select(count)
  return `${count} ${form === 'one' ? one : form === 'few' ? few : many}`
}
