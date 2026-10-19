import { useEffect, useRef } from 'react'
import { t } from './i18n'
import { useWindows } from './windows'

/**
 * The window `ask` opens: what is about to be done, and a choice between doing it and not. Cancel
 * has the focus, so that Enter does nothing that cannot be seen first; Escape and a click beside
 * the window are Cancel too.
 */
export function QuestionWindow() {
  const question = useWindows((s) => s.question)
  const no = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (question) no.current?.focus()
  }, [question])
  if (!question) return null
  const close = () => useWindows.setState({ question: null })
  return (
    <div
      className="palette-backdrop"
      onMouseDown={close}
      onKeyDown={(e) => {
        // Keys go no further than the window: not to the drawing behind it.
        e.stopPropagation()
        if (e.key === 'Escape') close()
      }}
    >
      <div className="dialog question" role="alertdialog" aria-label={question.title} aria-describedby="question-message" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{question.title}</h2>
        </header>
        <p id="question-message">{question.message}</p>
        <footer>
          <button ref={no} className="pill" onClick={close}>
            {t('Cancel')}
          </button>
          <button
            className="pill danger"
            onClick={() => {
              close()
              question.run()
            }}
          >
            {question.action}
          </button>
        </footer>
      </div>
    </div>
  )
}
