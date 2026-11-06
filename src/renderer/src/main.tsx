import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { loadTextFont } from './render/textMetrics'
import { startSession } from './session'
import { loadLanguage } from './settings'
import { useEditor } from './store'
import 'pdfjs-dist/web/pdf_viewer.css'
import './styles.css'

/** Changing the language draws the app anew. The document lives in the store and stays. */
function Root() {
  const locale = useEditor((state) => state.locale)
  return <App key={locale} />
}

// Text fields are sized by measuring this font, so it has to be there first.
void Promise.allSettled([loadTextFont(), loadLanguage()]).finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root />
    </StrictMode>
  )
  void startSession()
})
