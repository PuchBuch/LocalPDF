/** The chapters of the guide, in the order they are read. */
export const HELP_SECTIONS = [
  'start',
  'open',
  'edit',
  'fill',
  'sign',
  'fields',
  'table',
  'ai',
  'ocr',
  'pages',
  'photo',
  'save',
  'password',
  'privacy',
  'shortcuts',
  'extension',
  'limits'
] as const

export type HelpSectionId = (typeof HELP_SECTIONS)[number]

export interface HelpSection {
  id: HelpSectionId
  title: string
  intro: string
  steps?: string[]
  tips?: string[]
}

export interface HelpQuestion {
  question: string
  answer: string
  /** The chapter that says more. */
  section?: HelpSectionId
}

export interface HelpTexts {
  sections: HelpSection[]
  questions: HelpQuestion[]
}

/** The chapters that have every word of a search somewhere in them. */
export function searchSections(sections: HelpSection[], search: string): HelpSection[] {
  return sections.filter(({ title, intro, steps = [], tips = [] }) => matches([title, intro, ...steps, ...tips], search))
}

export function searchQuestions(questions: HelpQuestion[], search: string): HelpQuestion[] {
  return questions.filter(({ question, answer }) => matches([question, answer], search))
}

function matches(texts: string[], search: string): boolean {
  const text = texts.join(' ').toLowerCase()
  return search
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word))
}
