import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { helpTexts, hasOwnHelp } from '../help'
import { searchQuestions, searchSections, type HelpSectionId } from '../help/types'
import { currentLocale, t } from '../i18n'
import { useEditor, type Tool } from '../store'
import { openFeedback } from './ReportDialog'

type HelpTab = 'guide' | 'faq'

export const useHelp = create<{ open: boolean; tab: HelpTab; section: HelpSectionId }>(() => ({
  open: false,
  tab: 'guide',
  section: 'start'
}))

export const openHelp = (section: HelpSectionId = 'start'): void => useHelp.setState({ open: true, tab: 'guide', section })
export const openQuestions = (): void => useHelp.setState({ open: true, tab: 'faq' })
// Escape closes it from anywhere in the window, in App's useEscape.
export const closeHelp = (): void => useHelp.setState({ open: false })

const TOOL_SECTIONS: Record<Tool, HelpSectionId> = {
  cursor: 'start',
  edit: 'edit',
  text: 'fill',
  checkbox: 'fill',
  signature: 'sign',
  picture: 'sign',
  comb: 'fill'
}

/** The chapter about what is being done now. */
export function currentHelpSection(): HelpSectionId {
  const { activeTool, document, passwordRequest, scanRequest, signingFieldId, tableRequest } = useEditor.getState()
  if (passwordRequest) return 'password'
  if (scanRequest) return 'photo'
  if (tableRequest) return 'table'
  if (signingFieldId) return 'sign'
  return document ? TOOL_SECTIONS[activeTool] : 'start'
}

/** A small button that opens the guide at a chapter. */
export function HelpLink({ section }: { section: HelpSectionId }) {
  return (
    <button
      type="button"
      className="help-link"
      data-testid={`help-link-${section}`}
      aria-label={t.help.more}
      title={t.help.more}
      onClick={() => openHelp(section)}
    >
      ?
    </button>
  )
}

export const toolHelpSection = (tool: Tool): HelpSectionId => TOOL_SECTIONS[tool]

/** The guide and the frequent questions, with a search through both. They are part of the app, nothing is loaded. */
export function HelpDialog() {
  const { tab, section } = useHelp()
  const [search, setSearch] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const locale = currentLocale()
  const texts = helpTexts(locale)

  useEffect(() => {
    const before = document.activeElement
    searchInput.current?.focus()
    return () => {
      if (before instanceof HTMLElement) before.focus()
    }
  }, [])

  const sections = searchSections(texts.sections, search)
  const questions = searchQuestions(texts.questions, search)
  const shown = sections.find(({ id }) => id === section) ?? sections[0]
  const shownId = shown?.id

  useEffect(() => {
    content.current?.scrollTo(0, 0)
  }, [tab, shownId])

  const ask = () => {
    closeHelp()
    openFeedback('question')
  }

  return (
    <div className="dialog-backdrop" data-testid="help-dialog">
      <div className="dialog help-dialog" role="dialog" aria-modal="true" aria-label={t.help.title}>
        <div className="dialog-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'guide'}
            data-testid="help-tab-guide"
            onClick={() => useHelp.setState({ tab: 'guide' })}
          >
            {t.help.guide}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'faq'}
            data-testid="help-tab-faq"
            onClick={() => useHelp.setState({ tab: 'faq' })}
          >
            {t.help.faq}
          </button>
          <button
            type="button"
            className="dialog-close"
            data-testid="help-close"
            aria-label={t.close}
            title={t.close}
            onClick={closeHelp}
          >
            ✕
          </button>
        </div>
        <input
          ref={searchInput}
          type="search"
          className="help-search"
          data-testid="help-search"
          aria-label={t.help.search}
          placeholder={t.help.search}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {!hasOwnHelp(locale) && (
          <p className="help-note" data-testid="help-other-language">
            {t.help.otherLanguage}
          </p>
        )}
        {tab === 'guide' ? (
          <div className="help-body" lang={hasOwnHelp(locale) ? locale : 'en'}>
            <nav className="help-contents">
              {sections.map(({ id, title }) => (
                <button
                  key={id}
                  type="button"
                  className={id === shownId ? 'active' : undefined}
                  aria-current={id === shownId ? 'true' : undefined}
                  data-testid={`help-section-${id}`}
                  onClick={() => useHelp.setState({ section: id })}
                >
                  {title}
                </button>
              ))}
            </nav>
            <div className="help-content" data-testid="help-content" ref={content} tabIndex={0}>
              {shown ? (
                <>
                  <h2>{shown.title}</h2>
                  <p>{shown.intro}</p>
                  {shown.steps && (
                    <ol>
                      {shown.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  )}
                  {shown.tips && (
                    <ul>
                      {shown.tips.map((tip) => (
                        <li key={tip}>{tip}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p data-testid="help-nothing">{t.help.nothing}</p>
              )}
            </div>
          </div>
        ) : (
          <div className="help-body" lang={hasOwnHelp(locale) ? locale : 'en'}>
            <div className="help-content" data-testid="help-content" ref={content} tabIndex={0}>
              {questions.length === 0 && <p data-testid="help-nothing">{t.help.nothing}</p>}
              {questions.map(({ question, answer, section: more }) => (
                <details key={question} data-testid="help-question">
                  <summary>{question}</summary>
                  <p>{answer}</p>
                  {more && (
                    <button type="button" className="report-link" onClick={() => openHelp(more)}>
                      {t.help.more}
                    </button>
                  )}
                </details>
              ))}
            </div>
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="secondary-left" data-testid="help-ask" onClick={ask}>
            {t.help.ask}
          </button>
          <button type="button" className="primary" onClick={closeHelp}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  )
}
