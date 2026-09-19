import { useState } from 'react'
import type { DailyCard } from '../../lib/daily.ts'
import { sentenceFitsCard, validListeningOptions, type RoutineStep } from '../../lib/dailyRoutine.ts'
import { contextSentences } from '../../lib/context.ts'
import type { Dictionary } from '../../lib/dict.ts'

interface Props {
  step: RoutineStep
  card: DailyCard
  dict: Dictionary
  onSave: (changes: { original: string; text: string }[]) => void
  onCancel: () => void
}

export function DailySentenceEditor({ step, card, dict, onSave, onCancel }: Props) {
  const originals = step.options ?? [step.prompt]
  const [drafts, setDrafts] = useState<string[]>(originals)
  const [error, setError] = useState<string | null>(null)
  const save = (event: React.FormEvent) => {
    event.preventDefault()
    const texts = drafts.map((text) => text.trim().replace(/\s+/g, ' '))
    if (texts.some((text) => !text || contextSentences([text]).length !== 1)) {
      setError('Enter one complete sentence in each field.'); return
    }
    if (step.options ? !validListeningOptions(texts as [string, string], step.pair, dict)
      : !sentenceFitsCard(texts[0], card, dict)) {
      setError(step.options
        ? 'Use at least five recognized words in each sentence and keep the same sound contrast. Make matching corrections in both sentences.'
        : `Use at least five recognized words and keep the practice target (${card.label}) in the sentence.`)
      return
    }
    onSave(originals.flatMap((original, index) => original === texts[index] ? [] : [{ original, text: texts[index] }]))
  }
  return <form className="daily-sentence-editor" onSubmit={save}>
    <p>Correct the text here and Daily Practice will use your version in future sessions. Past recordings keep their original text.</p>
    {drafts.map((draft, index) => <label key={index}>
      {step.options ? `Sentence ${index === 0 ? 'A' : 'B'}` : 'Sentence'}
      <textarea autoFocus={index === 0} rows={3} value={draft} required aria-describedby={error ? 'daily-sentence-error' : undefined}
        onChange={(event) => { setDrafts((previous) => previous.map((text, i) => i === index ? event.target.value : text)); setError(null) }} />
    </label>)}
    {step.kind !== 'listening' && step.kind !== 'production' && <p className="daily-help">After editing, this sentence counts as practice because you have already reviewed its text.</p>}
    {error && <p id="daily-sentence-error" className="transport-error-banner" role="alert">{error}</p>}
    <div className="daily-sentence-actions"><button type="submit" className="primary">Save sentence{step.options ? 's' : ''}</button>
      <button type="button" className="ghost" onClick={onCancel}>Cancel</button></div>
  </form>
}
