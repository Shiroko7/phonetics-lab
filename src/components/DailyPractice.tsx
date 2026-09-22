import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dictionary } from '../lib/dict.ts'
import { dominant } from '../lib/report.ts'
import { PRACTICE_POLICY_REVISION, soundScore, wordPracticeStatus } from '../lib/practicePolicy.ts'
import { automaticDailyOutcome } from '../lib/dailyDecision.ts'
import {
  cardIdForSound, cardIdForWord, findOpenSession, formatDue, loadDailyState,
  localDateKey, saveDailyState, startDailySession, syncCandidates,
  type CardCandidate, type DailyCard, type DailyState,
} from '../lib/daily.ts'
import {
  advanceRoutine, changeRoutineVoice, exposeRoutineStep, markReferenceHeard, planDailyRoutine, refreshLegacyContexts, refreshRoutineVoices,
  recordRoutineEvent, recordRoutineReviewChoices, referenceVoicePool, refreshRoutineSentences, routineSummary, updateRoutine,
  type RoutineEvent, type RoutineKind,
} from '../lib/dailyRoutine.ts'
import { listVoices, onVoicesReady, stop, synthesise, type Voice } from '../lib/speech.ts'
import { useVoicePreferences } from '../lib/useVoicePreferences.ts'
import { excludeVoice, voiceLabel } from '../lib/voicePreferences.ts'
import type { PracticeState } from '../lib/usePracticeState.ts'
import { AudioTransport } from './shared/AudioTransport.tsx'
import { WordDiagnostics } from './shared/WordDiagnostics.tsx'
import { VoiceLibrary } from './shared/VoiceLibrary.tsx'
import { DailySentenceEditor } from './shared/DailySentenceEditor.tsx'
import { changeDailySentence } from '../lib/dailySentences.ts'

interface Props { practice: PracticeState; dict: Dictionary }
const STAGES: Record<RoutineKind, { title: string; instruction: string }> = {
  recall: { title: 'Recall after a break', instruction: 'Say this sentence before listening. Your first take checks what stayed with you since the last review.' },
  listening: { title: 'Hear the difference', instruction: 'Listen to the whole sentence, then choose the sentence you heard. Your first answer is saved.' },
  production: { title: 'Practise in context', instruction: 'Listen, then say the whole sentence at a comfortable pace. Use the word highlights to guide another try.' },
  transfer: { title: 'Try an unfamiliar sentence', instruction: 'Read this new sentence aloud before hearing a reference. Only the first take counts toward your unfamiliar-sentence score.' },
}

function buildCandidates(practice: PracticeState): CardCandidate[] {
  const sounds: CardCandidate[] = practice.weak.slice(0, 4).map((stat) => {
    const swap = dominant(stat.confusions)?.[0]
    return { id: cardIdForSound(stat.phone, swap), kind: 'sound',
      label: swap ? `/${stat.phone}/ → /${swap}/` : `/${stat.phone}/`, focusPhones: [stat.phone], confusion: swap }
  })
  return [...sounds, ...practice.struggles.filter((entry) => entry.pinned || entry.struggleCount >= 2).slice(0, 8).map((word) => ({
    id: cardIdForWord(word.word), kind: 'word' as const, label: word.display,
    word: word.display, focusPhones: word.weakPhones.map((phone) => phone.phone),
  }))]
}

function focusPercent(card: DailyCard, practice: PracticeState): number | undefined {
  if (!practice.aligned) return undefined
  const values = practice.report.filter((w) => wordPracticeStatus(w, practice.practiceThreshold) !== 'unscored')
    .flatMap((w) => w.steps.filter((s) => s.expected && card.focusPhones.includes(s.expected)).map(soundScore))
    .filter((n): n is number => n !== null)
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : undefined
}

function eventLabel(event: RoutineEvent): string {
  if (event.status === 'skipped') return 'Skipped'
  if (event.kind === 'listening') return event.correct ? 'Correct' : 'Contrast to revisit'
  return `${event.overallScore ?? '—'}/100${event.first ? '' : ' · extra practice'}`
}

export function DailyPractice({ practice, dict }: Props) {
  const [daily, setDaily] = useState<DailyState>(loadDailyState)
  const [sessionId, setSessionId] = useState<string | null>(() => findOpenSession(daily)?.id ?? null)
  const [voices, setVoices] = useState<Voice[]>(listVoices)
  const [voicePreferences, updateVoicePreferences] = useVoicePreferences()
  const [showVoices, setShowVoices] = useState(false)
  const [editingSentence, setEditingSentence] = useState(false)
  const [showBlacklist, setShowBlacklist] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const loadedStep = useRef<string | null>(null)
  const audioGeneration = useRef(0)
  const recordingStep = useRef<string | null>(null)
  const today = localDateKey()
  const mutate = useCallback((change: (state: DailyState) => DailyState) => {
    setDaily(change)
  }, [])
  // Persist the committed state, not speculative/replayed React updater calls.
  useEffect(() => saveDailyState(daily), [daily])
  const silence = useCallback(() => {
    audioGeneration.current++
    setSpeaking(false)
    practice.silence()
  }, [practice.silence])
  useEffect(() => onVoicesReady(setVoices), [])
  useEffect(() => () => { audioGeneration.current++; stop() }, [])
  const candidates = buildCandidates(practice)
  const candidateSignature = JSON.stringify(candidates)
  useEffect(() => {
    mutate((state) => {
      const next = syncCandidates(state, candidates)
      return next.cards.length !== state.cards.length ? next : state
    })
  }, [candidateSignature, mutate])
  const voicePool = useMemo(() => referenceVoicePool(voices, voicePreferences), [voices, voicePreferences])
  const poolSignature = voicePool.map((voice) => voice.uri).join('|')
  const session = daily.sessions.find((item) => item.id === sessionId && !item.endedAt) ?? null
  const routine = session?.routine
  const step = routine?.steps[routine.cursor]
  const currentCard = daily.cards.find((card) => card.id === step?.cardId)
  const stepEvents = routine?.events.filter((event) => event.stepId === step?.id && event.status !== 'skipped') ?? []
  const firstEvent = stepEvents[0]
  const lastEvent = stepEvents[stepEvents.length - 1]
  const independent = step?.kind === 'transfer' || step?.kind === 'recall'
  const lockedReference = independent && !firstEvent
  const currentVoice = voicePool.find((voice) => voice.uri === step?.voiceURI)
  const voiceURI = currentVoice?.uri
  const goal = daily.preferences?.goal ?? 4
  const working = practice.busy || practice.phase === 'recording'
  const sourceTexts = [...practice.sentences, ...practice.attempts.map((attempt) => attempt.target),
    ...practice.struggles.flatMap((word) => word.contexts ?? [])]
  const sourceSignature = JSON.stringify(sourceTexts)
  const blacklisted = (daily.sentencePreferences ?? []).filter((entry) => entry.blocked)

  useEffect(() => {
    if (!working) mutate((state) => refreshRoutineSentences(state, dict))
  }, [daily.sentencePreferences, session?.id, working, dict, mutate])

  // Upgrade pending legacy exercises in place; recorded answers and reviews survive.
  useEffect(() => {
    if (!session || working) return
    const planned = refreshLegacyContexts(daily, session, dict, voicePool, sourceTexts)
    if (planned) mutate((state) => updateRoutine(state, session.id, planned))
  }, [session?.id, routine, dict, sourceSignature, working, mutate])
  useEffect(() => {
    if (!session || !routine || working) return
    const revised = refreshRoutineVoices(routine, voicePool)
    if (revised === routine) return
    if (revised.steps[revised.cursor]?.voiceURI !== step?.voiceURI) { silence(); setAudioError(null) }
    mutate((state) => updateRoutine(state, session.id, revised))
  }, [session?.id, routine, poolSignature, working, silence, mutate])
  useEffect(() => {
    if (!session || !routine || step) return
    mutate((state) => ({ ...state, sessions: state.sessions.map((item) => item.id === session.id
      ? { ...item, endedAt: Date.now() } : item) }))
    setMessage(routine.notices.join(' ') || 'No contextual exercises are available. Add a full sentence in Practice Studio to continue.')
    setSessionId(null)
  }, [session?.id, routine, step, mutate])
  useEffect(() => {
    if (!session || !step || loadedStep.current === step.id) return
    silence()
    loadedStep.current = step.id
    recordingStep.current = null
    setShowVoices(false)
    setEditingSentence(false)
    setAudioError(null)
    practice.setLine(step.kind === 'listening' ? '' : step.prompt)
    mutate((state) => exposeRoutineStep(state, session.id, Date.now(), sourceTexts))
  }, [session?.id, step?.id, practice.setLine, silence, mutate])

  const scoredHere = !!step && step.kind !== 'listening' && recordingStep.current === step.id
    && practice.phase === 'done' && practice.target === step.prompt && !!practice.score
  useEffect(() => {
    if (!scoredHere || !session || !step || !currentCard || !practice.score || practice.editing === null) return
    const attempt = practice.attempts[practice.editing]
    if (!attempt || attempt.target !== step.prompt) return
    const outcome = automaticDailyOutcome(currentCard.focusPhones, practice.aligned, practice.score, practice.report, practice.practiceThreshold)
    mutate((state) => recordRoutineEvent(state, session.id, {
      stepId: step.id, at: Date.now(), status: 'scored', attemptAt: attempt.at,
      overallScore: practice.score!.overall, focusScore: focusPercent(currentCard, practice),
      rating: outcome.rating, scorer: attempt.scorer ?? 'browser', revision: attempt.rev,
      assessed: outcome.assessed, practiceThreshold: practice.practiceThreshold, practicePolicyRevision: PRACTICE_POLICY_REVISION,
    }))
  }, [scoredHere, session?.id, step?.id, practice.editing, practice.attempts, practice.score?.overall, mutate])
  const reviewSignature = JSON.stringify(practice.reviewChoices)
  useEffect(() => {
    if (!scoredHere || !session || !currentCard || practice.editing === null) return
    const attempt = practice.attempts[practice.editing]
    const reviewed = automaticDailyOutcome(currentCard.focusPhones, practice.aligned, practice.score, practice.report, practice.practiceThreshold, practice.reviewChoices)
    if (attempt) mutate((state) => recordRoutineReviewChoices(state, session.id, attempt.at, practice.reviewChoices, !reviewed.retry))
  }, [scoredHere, session?.id, practice.editing, practice.aligned, reviewSignature, practice.practiceThreshold, mutate])

  const playReference = (text = step?.prompt ?? '', feedback = false) => {
    if (!step || !session || !voiceURI || lockedReference) return
    if (speaking) { silence(); return }
    silence()
    setAudioError(null)
    const generation = audioGeneration.current
    const playingStep = step.id
    setSpeaking(true)
    synthesise(text, {
      voiceURI, rate: 1,
      onEnd: () => {
        if (generation !== audioGeneration.current) return
        setSpeaking(false)
        if (!feedback) mutate((state) => {
          const active = state.sessions.find((item) => item.id === session.id)?.routine
          const current = active?.steps[active.cursor]
          return current?.id === playingStep && current.voiceURI === voiceURI ? markReferenceHeard(state, session.id, voiceURI) : state
        })
      },
      onError: (error) => {
        if (generation !== audioGeneration.current) return
        setSpeaking(false)
        setAudioError(error)
      },
    })
  }
  const begin = () => {
    const result = startDailySession(syncCandidates(daily, candidates), goal)
    if (!result.session) {
      setMessage(daily.cards.length ? 'No targets are due right now. Your next review will include a recall check after the break.'
        : 'Practise in the Studio or pin a trouble word to create your first Daily targets.')
      return
    }
    const next = result.session.routine ? result.state : updateRoutine(result.state, result.session.id,
      planDailyRoutine(result.state, result.session, dict, voicePool, sourceTexts))
    saveDailyState(next)
    setDaily(next)
    setSessionId(result.session.id)
    loadedStep.current = null
    setMessage(null)
  }
  const pause = () => {
    silence()
    setEditingSentence(false)
    setSessionId(null)
    loadedStep.current = null
    setMessage('Paused. Your exercises, first answers, and place are saved.')
  }
  const next = () => {
    if (!session || !step) return
    silence()
    recordingStep.current = null
    mutate((state) => advanceRoutine(state, session.id))
    if (routine && routine.cursor + 1 >= routine.steps.length) {
      setSessionId(null)
      setMessage('Session complete. Your listening, speech, and independent checks are saved below. Targets will return when due.')
    }
  }
  const record = () => {
    if (!step) return
    silence()
    recordingStep.current = step.id
    void practice.beginRecording({ session: session!.id, first: !firstEvent })
  }
  const answer = (choice: number) => {
    if (!step || !session || firstEvent || !step.referenceHeard || speaking) return
    mutate((state) => recordRoutineEvent(state, session.id, {
      stepId: step.id, at: Date.now(), status: 'answered', choice, correct: choice === step.answer,
    }))
  }
  const anotherVoice = () => {
    if (!session || !routine) return
    silence(); setAudioError(null)
    const alternatives = voicePool.filter((voice) => voice.uri !== voiceURI)
    const voice = alternatives[Math.floor(Math.random() * alternatives.length)]
    if (voice) mutate((state) => {
      const active = state.sessions.find((item) => item.id === session.id)?.routine
      return active ? updateRoutine(state, session.id, changeRoutineVoice(active, voice.uri)) : state
    })
  }
  const manageVoices = () => { silence(); setShowVoices((open) => !open) }
  const saveSentences = (changes: { original: string; text: string }[]) => {
    silence()
    recordingStep.current = null
    mutate((state) => refreshRoutineSentences({ ...state, sentencePreferences: changes.reduce(
      (preferences, change) => changeDailySentence(preferences, change.original, { text: change.text }), state.sentencePreferences ?? [],
    ) }, dict))
    setEditingSentence(false)
    if (changes.length) setMessage('Sentence saved. Daily Practice will use your correction in future sessions.')
  }
  const blacklistSentences = () => {
    if (!step) return
    silence()
    recordingStep.current = null
    const texts = step.options ?? [step.prompt]
    mutate((state) => refreshRoutineSentences({ ...state, sentencePreferences: texts.reduce(
      (preferences, text) => changeDailySentence(preferences, text, { blocked: true }), state.sentencePreferences ?? [],
    ) }, dict))
    setEditingSentence(false)
    setMessage(`${texts.length === 1 ? 'Sentence blacklisted. It' : 'Sentences blacklisted. They'} will no longer appear in Daily Practice. You can restore ${texts.length === 1 ? 'it' : 'them'} in Blacklisted sentences.`)
  }
  const summary = routineSummary(daily.sessions, today)
  const outcome = scoredHere && currentCard ? automaticDailyOutcome(currentCard.focusPhones, practice.aligned, practice.score, practice.report, practice.practiceThreshold, practice.reviewChoices) : null
  const historyDates = [...new Set([today, ...daily.sessions.map((item) => item.dateKey),
    ...daily.sessions.flatMap((item) => item.routine?.events.map((event) => localDateKey(event.at)) ?? [])])].sort().reverse().slice(0, 14)
  const due = daily.cards.filter((card) => card.state !== 'suspended' && card.dueAt <= Date.now()).length

  return (
    <div className="daily-page">
      <section className="daily-hero">
        <div><span className="daily-eyebrow">Listen · speak · carry it forward</span><h1>Daily Practice</h1>
          <p>Train your ear with different voices, practise in connected speech, and check what carries into an unfamiliar sentence.</p></div>
        <div className="daily-hero-actions">
          <button className="ghost" aria-expanded={showBlacklist} onClick={() => setShowBlacklist((open) => !open)}>Blacklisted sentences ({blacklisted.length})</button>
          {session ? <button className="ghost" onClick={pause} disabled={working}>Pause session</button>
            : <button className="primary" onClick={begin}>{findOpenSession(daily) ? 'Resume session' : 'Start today'}</button>}
          {routine && <span className="daily-progress-pill">{routine.cursor + 1} / {routine.steps.length}</span>}
        </div>
      </section>
      {message && <div className="daily-message" role="status">{message}</div>}
      {showBlacklist && <section className="daily-history-card daily-blacklist" aria-label="Blacklisted sentences">
        <h2>Blacklisted sentences</h2>
        <p className="daily-help">These sentences stay out of Daily Practice, including when they appear in past attempts. Changes are saved in this browser.</p>
        {blacklisted.length ? <ul>{blacklisted.map((entry) => <li key={entry.text}><p>{entry.text}</p>
          <button className="ghost small" disabled={working} onClick={() => {
            mutate((state) => ({ ...state, sentencePreferences: changeDailySentence(state.sentencePreferences, entry.text, { blocked: false }) }))
            setMessage('Sentence restored. It can appear in future Daily Practice sessions.')
          }}>Restore sentence</button></li>)}</ul> : <p>No blacklisted sentences.</p>}
      </section>}
      {session && step && currentCard ? <>
        <nav className="daily-stage-strip" aria-label="Practice stages">
          {(['recall', 'listening', 'production', 'transfer'] as RoutineKind[]).filter((kind) => routine?.steps.some((item) => item.kind === kind)).map((kind) => (
            <span key={kind} aria-current={kind === step.kind ? 'step' : undefined} className={kind === step.kind ? 'active' : ''}>{STAGES[kind].title}</span>))}
        </nav>
        <section className="daily-review-card">
          <header className="daily-card-navigation">
            <div className="daily-review-meta"><span>{STAGES[step.kind].title}</span><span>{currentCard.label}</span></div>
            <button className="primary" onClick={next} disabled={working || editingSentence}>{firstEvent ? 'Next card' : 'Skip this card'}</button>
          </header>
          <h2 className="daily-exercise-heading">{STAGES[step.kind].title}</h2>
          <p className="daily-instruction">{STAGES[step.kind].instruction}</p>
          {step.kind === 'transfer' && step.fresh === false && <div className="daily-message">This sentence has already appeared in your history. This take will be saved as practice, without a new transfer score.</div>}
          <div className="daily-voice-row">
            <div className="voice-current"><span className="voice-avatar" aria-hidden="true">{currentVoice ? voiceLabel(currentVoice).slice(0, 1) : '♪'}</span>
              <div><span className="voice-caption">This card’s voice</span><strong aria-label="Reference voice" data-voice-uri={voiceURI ?? ''}>{currentVoice ? voiceLabel(currentVoice) : 'No allowed voice'}</strong>
                <small>{currentVoice?.lang ?? 'Manage your voice pool'} · {voicePool.length > 1 ? `${voicePool.length} voices in rotation` : voicePool.length ? 'One voice left in your pool' : 'Restore a voice to listen'}</small></div></div>
            <div className="voice-card-actions">
              <button className="ghost small" disabled={working || voicePool.length < 2} onClick={anotherVoice}>Another voice</button>
              <button className="ghost small" disabled={working || !currentVoice} onClick={() => {
                if (!currentVoice) return
                silence(); setAudioError(null)
                updateVoicePreferences((previous) => excludeVoice(previous, currentVoice))
                setMessage(`${voiceLabel(currentVoice)} excluded. You can restore this voice in Manage voices.`)
              }}>Don’t use this voice</button>
              <button className="ghost small" aria-expanded={showVoices} disabled={working} onClick={manageVoices}>Manage voices</button>
            </div>
          </div>
          {showVoices && !working && <VoiceLibrary voices={voices} preferences={voicePreferences} selectedURI={voiceURI}
            onPreferences={(change) => { silence(); updateVoicePreferences(change) }} onClose={() => setShowVoices(false)} />}
          <div className="daily-sentence-actions">
            <button className="ghost small" disabled={working || editingSentence} onClick={() => { silence(); setEditingSentence(true) }}>Edit sentence{step.options ? 's' : ''}</button>
            <button className="ghost small" disabled={working} onClick={blacklistSentences}>Blacklist sentence{step.options ? 's' : ''}</button>
            <span className="daily-help">Blacklisted sentences won’t appear again.</span>
          </div>
          {editingSentence ? <DailySentenceEditor key={step.id} step={step} card={currentCard} dict={dict}
            onSave={saveSentences} onCancel={() => setEditingSentence(false)} /> : step.kind === 'listening' ? <div className="daily-listening">
            <button className="listen-ref-btn" onClick={() => playReference()} disabled={!voiceURI}>{speaking ? '■ Stop' : step.referenceHeard ? '♪ Listen again' : '♪ Play sentence'}</button>
            <div className="daily-listening-options" role="group" aria-label="Which sentence did you hear?">
              {step.options?.map((option, index) => <button key={option}
                className={`daily-listening-option ${firstEvent && index === step.answer ? 'correct' : ''} ${firstEvent?.choice === index && !firstEvent.correct ? 'incorrect' : ''}`}
                disabled={!step.referenceHeard || speaking || !!firstEvent} onClick={() => answer(index)}><span>{index === 0 ? 'A' : 'B'}</span>{option}</button>)}
            </div>
            {!step.referenceHeard && <p className="daily-help">Play the complete sentence to unlock your answer.</p>}
            {firstEvent && <div className="daily-listening-feedback" role="status">
              <strong>{firstEvent.correct ? 'You heard the contrast.' : 'Here is the contrast to listen for.'}</strong>
              <p>The reference said: {step.prompt}</p>
              <p>Listen for /{step.pair?.[0]}/ versus /{step.pair?.[1]}/. Replay either complete sentence to compare.</p>
              <div className="daily-auto-actions">{step.options?.map((option, index) => <button key={option} className="ghost small" disabled={speaking || !voiceURI}
                onClick={() => playReference(option, true)}>Hear {index === 0 ? 'A' : 'B'}</button>)}</div>
            </div>}
          </div> : <>
            <div className="daily-prompt-text">{step.prompt}</div>
            {lockedReference && <p className="daily-help">Reference unlocks after your first scored take. You can then listen and repeat freely.</p>}
            <AudioTransport practice={practice} size="large" referenceDisabled={lockedReference || !voiceURI}
              referencePlaying={speaking} onReference={() => playReference()} onRecord={record} />
            {scoredHere && <div className="daily-rating-box"><WordDiagnostics practice={practice} compact hideReplayButtons /></div>}
            {lastEvent && <div className={`daily-auto-result ${outcome?.retry ? 'retry' : ''}`} role="status">
              <div><strong>{outcome ? outcome.retry ? 'Another pass may help' : 'Ready to move on' : 'Your take is saved'}</strong>
                <span>{outcome?.reason ?? `First take: ${firstEvent.overallScore}/100. You can record again or continue.`}</span>
                {independent && <span>First-take score: {firstEvent.overallScore}/100. Further takes are extra practice.</span>}</div>
              <div className="daily-auto-score"><b>{lastEvent.overallScore}</b><small>latest line score</small></div>
            </div>}
          </>}
          {audioError && <div className="transport-error-banner" role="alert">{audioError}</div>}
          {!voicePool.length && <p className="daily-help">No allowed voice is available. Restore a voice in Manage voices, or skip listening and continue recording. Skips do not count as incorrect answers.</p>}
          <div className="daily-step-actions">
            {step.kind !== 'listening' && lastEvent && <button className="ghost" onClick={record} disabled={working || editingSentence}>Record again</button>}
            <span>{stepEvents.length > 1 ? `${stepEvents.length} takes saved` : 'Repeat as much as you find useful.'}</span>
          </div>
        </section>
        {!!routine?.notices.length && <details className="daily-method-details"><summary>Coverage for this session</summary>{routine.notices.map((notice) => <p key={notice}>{notice}</p>)}</details>}
      </> : <>
        <section className="daily-stats-grid">
          <div className="daily-stat-card"><span>Due targets</span><strong>{due}</strong><small>{daily.cards.length} in your deck</small></div>
          <div className="daily-stat-card"><span>Listening today</span><strong>{summary.listening.count ? `${summary.listening.correct}/${summary.listening.count}` : '—'}</strong><small>first answers correct</small></div>
          <div className="daily-stat-card"><span>New sentences</span><strong>{summary.transfer.average ?? '—'}</strong><small>{summary.transfer.count} first-take checks</small></div>
          <div className="daily-stat-card"><span>Recall after a break</span><strong>{summary.recall.average ?? '—'}</strong><small>{summary.recall.count} checks before listening</small></div>
        </section>
        <section className="daily-history-card daily-setup">
          <div><h2>Settle into your routine</h2><p>Two listening trials, two spoken contexts, and an unfamiliar sentence for each target. Later reviews also begin with recall. Pause whenever you need.</p></div>
          <label>Targets per session <select value={goal} onChange={(event) => mutate((state) => ({ ...state, preferences: { voiceURIs: [], goal: Number(event.target.value) } }))}>
            <option value={2}>2 · short session</option><option value={4}>4 · standard session</option><option value={6}>6 · extended session</option>
          </select></label>
          <div className="daily-voice-setup"><div><h3>A different speaker on each card</h3><p>{voicePool.length} allowed · {voicePreferences.excluded.length} excluded. Voices rotate automatically. Exclude a speaker whenever you dislike how they sound.</p></div>
            <button className="ghost small" aria-expanded={showVoices} onClick={manageVoices}>Manage voices</button></div>
          {showVoices && <VoiceLibrary voices={voices} preferences={voicePreferences} onPreferences={updateVoicePreferences} onClose={() => setShowVoices(false)} />}
        </section>
        <section className="daily-history-card">
          <div className="daily-section-heading"><div><span className="daily-eyebrow">First attempts and extra practice</span><h2>Daily history</h2></div></div>
          <p className="daily-help">Listening shows correct first answers. Speech columns show average first-take scores out of 100, with the number of checks in parentheses. New sentences and recall are recorded before reference playback. Different scoring systems are shown as “Mixed”, without averaging them together.</p>
          <div className="daily-history-table-wrap"><table className="daily-history-table">
            <thead><tr><th>Day</th><th>Listening</th><th>Practised speech</th><th>New sentences</th><th>Recall</th><th>Extra takes</th><th>Voices heard</th></tr></thead>
            <tbody>{historyDates.map((date) => {
              const day = routineSummary(daily.sessions, date)
              const metric = (value: { count: number; average: number | null; mixed: boolean }) => value.count ? `${value.mixed ? 'Mixed' : value.average} (${value.count})` : '—'
              return <tr key={date}><th>{date === today ? 'Today' : date}</th><td>{day.listening.count ? `${day.listening.correct}/${day.listening.count}` : '—'}</td>
                <td>{metric(day.production)}</td><td>{metric(day.transfer)}</td><td>{metric(day.recall)}</td><td>{day.repetitions}</td><td>{day.voices}</td></tr>
            })}</tbody>
          </table></div>
          {daily.sessions.slice(-7).reverse().map((item) => <details key={item.id} className="daily-session-detail">
            <summary>{item.dateKey} · {item.endedAt ? 'Completed' : 'Saved session'} · {item.routine?.events.length ?? item.reviewIds.length} results</summary>
            {item.routine ? <ul>{item.routine.events.map((event) => <li key={event.id}>
              <span>{STAGES[event.kind].title} · {eventLabel(event)}{event.referenceHeard ? ' · reference heard' : ''}</span>
              <p>{event.prompt}</p><small>{new Date(event.at).toLocaleTimeString()} {voices.find((voice) => voice.uri === event.voiceURI)?.name ?? event.voiceURI ?? ''}</small>
            </li>)}</ul> : <p>This earlier session has scheduling history only; listening and transfer were not measured.</p>}
          </details>)}
        </section>
        <section className="daily-deck-preview">
          <div className="daily-section-heading"><h2>Targets in rotation</h2><span>Up to two new targets per day</span></div>
          {!daily.cards.length && <p className="daily-empty-copy">Daily builds your deck from repeated weak sounds and pinned trouble words in Practice Studio.</p>}
          <div className="daily-card-list">{daily.cards.map((card) => <div key={card.id} className="daily-mini-card">
            <span className="daily-mini-label">{card.label}</span><span className="daily-mini-meta">{card.totalReviews} scheduled reviews</span><span className="daily-mini-due">{formatDue(card)}</span>
          </div>)}</div>
        </section>
        <details className="daily-method-details"><summary>Research and what these scores mean</summary>
          <p>This routine applies varied voices and contexts, listening feedback, and independent checks. Exercise counts and score thresholds are product choices. Synthetic references and automatic scores cannot establish how well other people understand your speech.</p>
          <p>Reading a new sentence checks transfer to new text. It does not measure spontaneous conversation. Repeat takes are useful practice; later recall provides evidence about retention.</p>
          <p><a href="https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/high-variability-phonetic-training-hvpt-a-metaanalysis-of-l2-perceptual-training-studies/6ABB8C1F32D88D53EA8D05A4565E76F6" target="_blank" rel="noreferrer">HVPT perception synthesis</a> · <a href="https://www.cambridge.org/core/journals/applied-psycholinguistics/article/does-perceptual-high-variability-phonetic-training-improve-l2-speech-production-a-metaanalysis-of-perceptionproduction-connection/E38D8F5CE65DC708137B0E95F97C6BC7" target="_blank" rel="noreferrer">Production and generalization synthesis</a></p>
          <p>History is saved in this browser. Clearing site data removes it. Speech events also keep the scorer and revision used for later comparisons.</p>
        </details>
      </>}
    </div>
  )
}
