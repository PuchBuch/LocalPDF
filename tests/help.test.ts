import { describe, expect, it } from 'vitest'
import { feedbackText, FEEDBACK_ISSUES, FEEDBACK_KINDS, isIssueUrl, issueUrl } from '../src/core/problemReport'
import { hasOwnHelp, helpTexts } from '../src/renderer/src/help'
import { HELP_SECTIONS, searchQuestions, searchSections } from '../src/renderer/src/help/types'
import type { Locale } from '../src/renderer/src/i18n'

const OWN: Locale[] = ['en', 'de', 'ru']
const CYRILLIC = /[А-Яа-яЁё]/

describe.each(OWN)('the guide in %s', (locale) => {
  const { sections, questions } = helpTexts(locale)
  const texts = [
    ...sections.flatMap(({ title, intro, steps = [], tips = [] }) => [title, intro, ...steps, ...tips]),
    ...questions.flatMap(({ question, answer }) => [question, answer])
  ]

  it('has every chapter once, in order', () => {
    expect(sections.map(({ id }) => id)).toEqual([...HELP_SECTIONS])
  })

  it('says as much as the English one', () => {
    const shape = (help: ReturnType<typeof helpTexts>) => ({
      sections: help.sections.map(({ steps = [], tips = [] }) => [steps.length, tips.length]),
      questions: help.questions.map(({ section }) => section)
    })
    expect(shape({ sections, questions })).toEqual(shape(helpTexts('en')))
  })

  it('has no empty text, no text twice in a list, and the right alphabet', () => {
    for (const text of texts) {
      expect(text.trim()).not.toBe('')
      expect(CYRILLIC.test(text), text).toBe(locale === 'ru')
    }
    for (const { steps = [], tips = [] } of sections) expect(new Set([...steps, ...tips]).size).toBe(steps.length + tips.length)
    expect(new Set(questions.map(({ question }) => question)).size).toBe(questions.length)
  })
})

describe('the guide', () => {
  it('is shown in English where there is none', () => {
    expect(OWN.every(hasOwnHelp)).toBe(true)
    expect(hasOwnHelp('pl')).toBe(false)
    expect(helpTexts('pl')).toBe(helpTexts('en'))
  })

  it('finds chapters and questions by all the words of a search, whatever their case', () => {
    const { sections, questions } = helpTexts('en')
    expect(searchSections(sections, 'EXCEL csv').map(({ id }) => id)).toEqual(['table'])
    expect(searchQuestions(questions, 'publisher')).toHaveLength(1)
    expect(searchSections(sections, 'no such word')).toEqual([])
    expect(searchSections(sections, ' ')).toEqual(sections)
  })
})

describe('feedback', () => {
  const facts = {
    version: '0.9.0',
    variant: 'windows-app' as const,
    system: 'Windows 11',
    language: 'ru',
    problems: ['ocr.failed (Error)']
  }

  it('asks for what each kind needs, and gives errors only with a problem', () => {
    expect(feedbackText('problem', facts)).toContain('ocr.failed')
    expect(feedbackText('idea', facts)).toContain('What would you like to do?')
    expect(feedbackText('question', facts)).toContain('Your question')
    for (const kind of ['idea', 'question'] as const) expect(feedbackText(kind, facts)).not.toContain('ocr.failed')
  })

  it('leads to the issue page, with the template of its kind', () => {
    for (const kind of FEEDBACK_KINDS) {
      const { title, template } = FEEDBACK_ISSUES[kind]
      const url = issueUrl(title, feedbackText(kind, facts), template)
      expect(isIssueUrl(url)).toBe(true)
      expect(new URL(url).searchParams.get('template')).toBe(template)
    }
  })
})
