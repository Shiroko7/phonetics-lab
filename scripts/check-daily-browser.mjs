/** Isolated Chrome smoke test. Synthetic microphone, voices and scoring only.
 * Run with a local dev server: node scripts/check-daily-browser.mjs
 * Set CHROME_PATH / DAILY_TEST_URL when needed. No user browser data is used.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncCandidates } from '../src/lib/daily.ts'
import { ANALYSIS_REVISION } from '../src/lib/backend.ts'

const executable = process.env.CHROME_PATH ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync)
assert(executable, 'Set CHROME_PATH to a Chromium browser executable')
const url = process.env.DAILY_TEST_URL ?? 'http://127.0.0.1:5173/'
const liveVoices = process.argv.includes('--live-voices')
assert((await fetch(url)).ok, `Start the dev server at ${url} first`)
const profile = await mkdtemp(join(tmpdir(), 'phonetics-daily-test-'))
const chrome = spawn(executable, [
  '--headless=new', '--mute-audio', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { windowsHide: true, stdio: 'ignore' })
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let ws
let screenshotPath
let closeBrowser
try {
  let port
  for (let i = 0; i < 100 && !port; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0] } catch { await pause(100) }
  }
  assert(port, 'Chrome did not expose a test connection')
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  ws = new WebSocket(pages.find((page) => page.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
  let sequence = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
    if (!message.id) return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timeout)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, 15000)
    pending.set(id, { resolve, reject, timeout })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  closeBrowser = () => send('Browser.close')
  const waitFor = async (expression, label) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100) }
    throw new Error(`Timed out: ${label}\n${await evaluate('document.body.innerText')}`)
  }
  const click = async (text) => {
    await waitFor(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); return !!button && !button.disabled })()`, `enabled button: ${text}`)
    const found = await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); if (!button || button.disabled) return false; button.click(); return true })()`)
    assert(found, `Enabled button: ${text}`)
    await pause(60)
  }
  const current = `JSON.parse(localStorage.getItem('phonetics-lab:daily')).sessions.at(-1).routine`
  const preferences = `JSON.parse(localStorage.getItem('phonetics-lab:practice-policy-v1'))`
  const attempts = `JSON.parse(localStorage.getItem('phonetics-lab:attempts'))`
  const seeded = syncCandidates({ cards: [], reviews: [], sessions: [] }, [
    { id: 'sound:θ:s', kind: 'sound', label: '/θ/ → /s/', focusPhones: ['θ'], confusion: 's' },
  ])
  const init = `
    if (!localStorage.getItem('daily-test-seeded')) {
      localStorage.setItem('phonetics-lab:daily', ${JSON.stringify(JSON.stringify(seeded))});
      localStorage.setItem('daily-test-seeded', 'yes');
    }
    const voices = ['One','Two','Three','Four','Five','Six','Seven','Eight'].map(name => ({voiceURI:'test-'+name.toLowerCase(),name:'Test '+name,lang:'en-US',localService:true}));
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    const speech = new EventTarget();
    let speechTimer;
    speech.getVoices = () => voices;
    speech.cancel = () => clearTimeout(speechTimer);
    speech.speak = utterance => { speechTimer = setTimeout(() => window.__audioFailure ? utterance.onerror?.({error:'audio-busy'}) : utterance.onend?.(), 120); };
    Object.defineProperty(window, 'speechSynthesis', {value:speech});
    const realFetch = window.fetch.bind(window);
    const originalStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(when, offset, duration) {
      window.__lastSlice = { offset, duration };
      return originalStart.call(this, when, offset, duration);
    };
    window.fetch = async (input, options) => {
      const address = String(input);
      if (address === 'http://127.0.0.1:8000/tts/voices' && !${liveVoices}) return Response.json({voices:[]});
      if (address === 'http://127.0.0.1:8000/health') return Response.json({device:'test', cuda:false, gpu:null, torch:'test', phoneme_model:'test'});
      if (address === 'http://127.0.0.1:8000/analyze') {
        const expected = JSON.parse(options.body.get('expected'));
        if (!JSON.parse(options.body.get('words'))?.length) throw new Error('Word ownership was not sent');
        window.__firstWordEnd = JSON.parse(options.body.get('words'))[0].phones.length * .02;
        const phones = expected.map((phone, index) => ({index, expected:phone, verdict:window.__badTake && index % 3 === 0 ? 'wrong' : 'correct', heard:'k', score:window.__badTake && index % 3 === 0 ? 20 : (window.__phoneScore ?? 100), start:index*.02, end:(index+1)*.02}));
        return Response.json({revision:${ANALYSIS_REVISION}, phones, overall:Math.round(phones.reduce((sum,p) => sum+p.score, 0)/phones.length), free:[], device:'test'});
      }
      return realFetch(input, options);
    };
  `
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: init })
  await send('Page.navigate', { url })
  await waitFor(`document.body.innerText.includes('Daily Practice')`, 'app loads')
  await click('Daily Practice')
  await click('Manage voices')
  if (liveVoices) {
    await waitFor(`document.querySelector('.online-voice-notice')?.textContent.includes('free online voices available.')`, 'online catalogue loads')
    assert.match(await evaluate(`localStorage.getItem('phonetics-lab:voice')`), /edge:en-US-Brian/, 'Brian is the app default')
    await evaluate(`document.querySelector('button[aria-label="Preview Andrew"]').click()`)
    await waitFor(`document.querySelector('button[aria-label="Preview Andrew"]').textContent === 'Stop'`, 'Andrew preview starts')
    await waitFor(`document.querySelector('button[aria-label="Preview Andrew"]').textContent === 'Preview'`, 'Andrew audio finishes')
    assert.equal(await evaluate(`document.querySelector('[role="alert"]')?.textContent ?? null`), null, 'preview succeeds')
  }
  assert.equal(await evaluate(`document.querySelectorAll('.voice-library-item').length`), 5, 'catalogue shows only five voices at once')
  await click('More voices')
  assert(await evaluate(`document.querySelector('.voice-library-pagination').textContent.includes('2 /')`), 'catalogue is paginated')
  await click('Done')
  await click('Start today')
  await waitFor(`document.querySelectorAll('.daily-listening-option').length === 2`, 'listening exercise')
  assert(await evaluate(`(${current}).steps.every(step => !(step.options ?? [step.prompt]).some(text => text.includes('"')))`), 'no quoted-word carrier exercises in the plan')
  assert(await evaluate(`[...document.querySelectorAll('.daily-listening-option')].every(b => b.disabled)`), 'answers start locked')
  assert.equal(await evaluate(`document.querySelectorAll('.daily-voice-row select').length`), 0, 'no long dropdown on cards')
  assert(await evaluate(`(${current}).steps.slice(1).every((step, index) => step.voiceURI !== (${current}).steps[index].voiceURI)`), 'adjacent cards rotate speakers')
  if (!liveVoices) {
  await evaluate('window.__audioFailure = true')
  await click('♪ Play sentence')
  await waitFor(`!!document.querySelector('[role="alert"]')`, 'audio failure visible')
  assert(await evaluate(`[...document.querySelectorAll('.daily-listening-option')].every(b => b.disabled)`), 'failed playback never unlocks answers')
  await evaluate('window.__audioFailure = false')
  }
  await click('♪ Play sentence')
  await waitFor(`!document.querySelector('.daily-listening-option').disabled`, 'heard reference unlocks answer')
  const excludedURI = await evaluate(`document.querySelector('[aria-label="Reference voice"]').dataset.voiceUri`)
  await click('Don’t use this voice')
  await waitFor(`document.querySelector('[aria-label="Reference voice"]').dataset.voiceUri !== ${JSON.stringify(excludedURI)}`, 'disliked voice replaced immediately')
  assert(await evaluate(`[...document.querySelectorAll('.daily-listening-option')].every(b => b.disabled)`), 'changed reference must be heard before answering')
  assert(await evaluate(`(${current}).steps.every(step => step.voiceURI !== ${JSON.stringify(excludedURI)})`), 'excluded voice removed from future cards')
  await click('♪ Play sentence')
  await waitFor(`!document.querySelector('.daily-listening-option').disabled`, 'replacement playback unlocks answers')
  await evaluate(`document.querySelectorAll('.daily-listening-option')[1 - (${current}).steps[0].answer].click()`)
  await waitFor(`(${current}).events.length === 1`, 'first answer saved')
  assert.equal(await evaluate(`(${current}).events[0].correct`), false)
  const recordedAnswer = await evaluate(`(${current}).events[0]`)
  await click('Don’t use this voice')
  assert.deepEqual(await evaluate(`(${current}).events[0]`), recordedAnswer, 'excluding after answering cannot rewrite the answer or original speaker')
  const exclusions = await evaluate(`localStorage.getItem('phonetics-lab:voice-preferences')`)
  const prompt = await evaluate(`(${current}).steps[0].prompt`)
  await click('Pause session')
  await pause(100)
  assert(await evaluate(`document.body.innerText.includes('Resume session')`), 'pause stays paused')
  await click('Resume session')
  assert.equal(await evaluate(`(${current}).steps[0].prompt`), prompt, 'pause cannot reroll the trial')
  await send('Page.reload')
  await waitFor(`document.body.innerText.includes('Daily Practice')`, 'app reloads')
  await click('Daily Practice')
  await waitFor(`document.querySelectorAll('.daily-listening-option').length === 2`, 'session resumes')
  assert.equal(await evaluate(`localStorage.getItem('phonetics-lab:voice-preferences')`), exclusions, 'exclusions persist across reload')
  assert(await evaluate(`[...document.querySelectorAll('.daily-listening-option')].every(b => b.disabled)`), 'answered choices remain locked after reload')
  await click('Next card')
  assert.equal(await evaluate(`document.querySelector('[aria-label="Reference voice"]').dataset.voiceUri`), await evaluate(`(${current}).steps[1].voiceURI`), 'next voice is selected')
  await click('Skip this card')
  await waitFor(`!!document.querySelector('.record-btn')`, 'production exercise')
  const listenBox = await evaluate(`(() => { const a=document.querySelector('.listen-ref-btn').getBoundingClientRect(); const b=document.querySelector('.record-btn').getBoundingClientRect(); return a.x < b.x })()`)
  assert(listenBox, 'reference is left of record')
  const recordTake = async () => {
    await click('Record')
    await waitFor(`!!document.querySelector('.record-btn.recording')`, 'synthetic microphone starts')
    await pause(1200)
    await click('Stop & Score')
    await waitFor(`!!document.querySelector('.word-diagnostics-deck')`, 'word diagnostics after scoring')
  }
  await evaluate('window.__phoneScore = 73')
  await recordTake()
  assert.equal(await evaluate(`document.querySelector('.score-value').textContent`), '73', 'backend scores are displayed numerically')
  assert.equal(await evaluate(`document.querySelector('.word-score').textContent`), '73', 'word scores use the same scale')
  assert.equal(await evaluate(`${preferences}.threshold`), 80, 'default threshold is 80')
  assert(await evaluate(`document.querySelector('.slot-score').textContent === '73/100'`), 'individual phone score is visible')
  const firstProductionEvidence = await evaluate(`(${current}).events.find(event => event.kind === 'production')`)
  assert.equal(await evaluate(`${attempts}.at(-1).practiceFirst`), true, 'first-take provenance is saved')
  assert.equal(await evaluate(`${attempts}.at(-1).practiceSession`), await evaluate(`JSON.parse(localStorage.getItem('phonetics-lab:daily')).sessions.at(-1).id`))
  await click('Sounds acceptable to me')
  assert(await evaluate(`document.querySelector('.review-actions [role="status"]').textContent.includes('Original score preserved')`))
  assert.equal(await evaluate(`document.querySelector('.score-value').textContent`), '73')
  await click('Undo review choice')
  await click('Practise later')
  await waitFor(`Object.values(${preferences}.decisions).includes('later')`, 'practice choice saved')
  await click('Bad word cut')
  assert(await evaluate(`![...document.querySelectorAll('.inspection-audio-actions button')].some(b => b.textContent.includes('Yours'))`), 'bad cuts disable isolated replay')
  assert(await evaluate(`[...document.querySelectorAll('.phone-slot')].every(p => p.classList.contains('unscored'))`), 'bad cuts are unassessed, not pronunciation errors')
  await waitFor(`Object.values((${current}).practiceReviews ?? {}).some(choices => choices.includes('bad-cut'))`, 'Daily keeps review choice separate')
  assert.deepEqual(await evaluate(`(${current}).events.find(event => event.kind === 'production')`), firstProductionEvidence, 'review choices preserve original Daily evidence')
  await click('Undo review choice')
  await evaluate(`document.querySelector('.split-settings-btn').click()`)
  await waitFor(`!!document.querySelector('#practice-threshold')`, 'threshold settings')
  const setThreshold = async (value) => {
    await evaluate(`(() => { const input = document.querySelector('#practice-threshold'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${value}'); input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true})); })()`)
    await waitFor(`${preferences}.threshold === ${value}`, 'threshold persisted')
  }
  await setThreshold(70)
  assert(await evaluate(`[...document.querySelectorAll('.phone-slot')].every(p => p.classList.contains('correct'))`), 'threshold changes flags, not scores')
  assert.equal(await evaluate(`document.querySelector('.score-value').textContent`), '73')
  await setThreshold(80)
  await evaluate(`document.querySelector('.settings-drawer-header .close-btn').click()`)
  await click('▶ Yours')
  await waitFor(`window.__lastSlice?.duration > 0`, 'word slice started')
  const isolated = await evaluate('window.__lastSlice')
  const firstWordEnd = await evaluate('window.__firstWordEnd')
  assert(isolated.offset + isolated.duration <= firstWordEnd, 'isolated replay does not include padding or minimum-duration expansion')
  assert.equal(isolated.offset, 0, 'first word starts at its own boundary')
  await click('▶ In context')
  await waitFor(`window.__lastSlice.duration > ${isolated.duration}`, 'context intentionally includes neighboring words')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await pause(100)
  assert(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), 'diagnostics and replay controls fit on mobile')
  await evaluate(`document.querySelector('.word-diagnostics-deck').scrollIntoView({block:'start'})`)
  assert(await evaluate(`(() => {
    const card = document.querySelector('.word-inspection-card').getBoundingClientRect();
    return [...document.querySelectorAll('.inspection-audio-actions button')].every(button => {
      const box = button.getBoundingClientRect();
      return box.left >= card.left && box.right <= card.right;
    });
  })()`), 'all replay buttons stay inside the mobile word card')
  const diagnosticsScreenshot = await send('Page.captureScreenshot', { format: 'png' })
  const diagnosticsPath = join(tmpdir(), `phonetics-diagnostics-${Date.now()}.png`)
  await writeFile(diagnosticsPath, Buffer.from(diagnosticsScreenshot.data, 'base64'))
  console.log(`Diagnostics screenshot: ${diagnosticsPath}`)
  await evaluate(`document.querySelector('.review-actions').scrollIntoView({block:'center'})`)
  assert(await evaluate(`(() => { const card = document.querySelector('.review-actions').getBoundingClientRect(); return [...document.querySelectorAll('.review-actions button')].every(button => { const box = button.getBoundingClientRect(); return box.left >= card.left && box.right <= card.right; }); })()`), 'review controls fit inside mobile card')
  const reviewScreenshot = await send('Page.captureScreenshot', { format: 'png' })
  const reviewPath = join(tmpdir(), `phonetics-review-${Date.now()}.png`)
  await writeFile(reviewPath, Buffer.from(reviewScreenshot.data, 'base64'))
  console.log(`Review screenshot: ${reviewPath}`)
  await send('Emulation.clearDeviceMetricsOverride')
  await evaluate('window.__phoneScore = 100')
  const savedProduction = await evaluate(`(${current}).events.find(event => event.kind === 'production')`)
  const productionVoice = await evaluate(`document.querySelector('[aria-label="Reference voice"]').dataset.voiceUri`)
  await click('Another voice')
  await waitFor(`document.querySelector('[aria-label="Reference voice"]').dataset.voiceUri !== ${JSON.stringify(productionVoice)}`, 'another voice switches without advancing the card')
  await pause(100)
  assert.deepEqual(await evaluate(`(${current}).events.find(event => event.kind === 'production')`), savedProduction, 'switching voice preserves the recorded score and voice')
  assert(await evaluate(`!!document.querySelector('.word-diagnostics-deck')`), 'voice changes keep word-by-word diagnostics')
  await click('Next card')
  await click('Skip this card')
  await waitFor(`document.querySelector('.daily-exercise-heading')?.textContent === 'Try an unfamiliar sentence'`, 'transfer exercise')
  assert(await evaluate(`document.querySelector('.listen-ref-btn').disabled`), 'transfer reference is locked')
  await evaluate('window.__badTake = true')
  await recordTake()
  const firstScore = await evaluate(`(${current}).events.find(e => e.kind === 'transfer').overallScore`)
  assert(firstScore < 100, 'first transfer take has its own score')
  assert.equal(await evaluate(`document.querySelector('.listen-ref-btn').disabled`), false, 'reference unlocks after first take')
  await evaluate('window.__badTake = false')
  await recordTake()
  await waitFor(`(${current}).events.filter(e => e.kind === 'transfer').length === 2`, 'repeat saved')
  assert.equal(await evaluate(`document.querySelector('.score-value').textContent`), '100', '100 remains possible')
  assert.equal(await evaluate(`${attempts}.at(-1).practiceFirst`), false, 'retry is not first-take evidence')
  assert(await evaluate(`[...document.querySelectorAll('.slot-score')].every(p => p.textContent === '100/100')`), '100 phone scores stay intact')
  assert.equal(await evaluate(`(${current}).events.find(e => e.kind === 'transfer').overallScore`), firstScore, 'repeat cannot overwrite transfer result')
  await click('Sounds acceptable to me')
  const savedChoices = await evaluate(`${preferences}.decisions`)
  await click('Next card')
  await waitFor(`document.body.innerText.includes('Session complete.')`, 'session completes')
  assert(await evaluate(`document.querySelector('.daily-history-table').innerText.includes('1')`), 'history is populated')
  assert.deepEqual(errors, [], 'no browser exceptions')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await pause(100)
  assert(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), 'mobile page does not overflow')
  const screenshot = await send('Page.captureScreenshot', { format: 'png' })
  screenshotPath = join(tmpdir(), `phonetics-daily-${Date.now()}.png`)
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))

  // Resume a real-shaped legacy plan: replace pending carriers, preserve evidence.
  const oldPrompt = 'The storyteller used "think" while describing the journey.'
  const cardId = seeded.cards[0].id
  const past = { id: 'past', cardId, kind: 'production', prompt: oldPrompt }
  const savedEvent = { id: 'past-score', stepId: past.id, cardId, kind: 'production', prompt: oldPrompt,
    at: Date.now(), status: 'scored', first: true, overallScore: 83, rating: 'hard' }
  const legacyState = { ...seeded, sessions: [{ id: 'legacy-browser-test', startedAt: Date.now(),
    dateKey: await evaluate(`new Date().toLocaleDateString('en-CA')`), goal: 1, queue: [cardId], index: 0, reviewIds: [],
    routine: { version: 1, cursor: 1, notices: [], events: [savedEvent], steps: [past,
      { ...past, id: 'pending', referenceHeard: true, exposedAt: Date.now() }] },
  }] }
  await evaluate(`localStorage.setItem('phonetics-lab:daily', ${JSON.stringify(JSON.stringify(legacyState))})`)
  await send('Page.reload')
  await waitFor(`document.body.innerText.includes('Daily Practice')`, 'app reloads for legacy migration')
  await click('Daily Practice')
  await waitFor(`(${current}).steps[1]?.id === 'pending:context-v2'`, 'pending carrier migrated')
  assert.equal(await evaluate(`${preferences}.threshold`), 80, 'threshold survives reload')
  assert.deepEqual(await evaluate(`${preferences}.decisions`), savedChoices, 'review choices survive reload')
  assert.deepEqual(await evaluate(`(${current}).events`), [savedEvent], 'migration preserves recorded history')
  assert.equal(await evaluate(`(${current}).steps[0].prompt`), oldPrompt, 'historical prompt is not rewritten')
  assert(await evaluate(`document.body.innerText.includes((${current}).steps[1].prompt)`), 'replacement appears on the active card')
  assert.equal(await evaluate(`!!(${current}).steps[1].referenceHeard`), false, 'new reference is not counted as already heard')
  const beforeExcludingAll = await evaluate(`(${current}).events`)
  let restoredName, restoredURI
  for (let i = 0; i < 60; i++) {
    const voiceURI = await evaluate(`document.querySelector('[aria-label="Reference voice"]').dataset.voiceUri`)
    if (!voiceURI) break
    restoredURI = voiceURI
    restoredName = await evaluate(`document.querySelector('[aria-label="Reference voice"]').textContent`)
    await click('Don’t use this voice')
  }
  await waitFor(`document.querySelector('[aria-label="Reference voice"]').textContent === 'No allowed voice'`, 'excluding last voice does not resurrect a blocked speaker')
  assert.equal(await evaluate(`document.querySelector('.listen-ref-btn').disabled`), true, 'empty pool disables reference playback')
  await click('Manage voices')
  await evaluate(`[...document.querySelectorAll('.voice-library-tabs button')].find(button => button.textContent.startsWith('Excluded')).click()`)
  await evaluate(`(() => { const input = document.querySelector('input[aria-label="Search voices"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(restoredName)}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`)
  await waitFor(`document.querySelectorAll('.voice-library-item').length === 1`, 'excluded voices can be searched')
  await click('Restore')
  await waitFor(`document.querySelector('[aria-label="Reference voice"]').dataset.voiceUri === ${JSON.stringify(restoredURI)}`, 'restored speaker returns to rotation')
  assert.deepEqual(await evaluate(`(${current}).events`), beforeExcludingAll, 'voice preferences never rewrite scores')
  await click('Done')
  await evaluate(`document.querySelector('.split-settings-btn').click()`)
  await waitFor(`!!document.querySelector('.studio-voice-summary')`, 'compact Studio voice settings')
  assert.equal(await evaluate(`document.querySelectorAll('.settings-drawer-panel select').length`), 0, 'Studio has no long voice dropdown either')
  await click('Change voice')
  assert(await evaluate(`document.querySelectorAll('.settings-drawer-panel .voice-library-item').length <= 5`), 'Studio catalogue is bounded too')
  await evaluate(`document.querySelector('.settings-drawer-header .close-btn').click()`)
  await click('Manage voices')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await pause(100)
  assert(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), 'expanded voice library fits a mobile screen')
  await evaluate(`document.querySelector('.daily-voice-row').scrollIntoView()`)
  const voiceScreenshot = await send('Page.captureScreenshot', { format: 'png' })
  screenshotPath = join(tmpdir(), `phonetics-voices-${Date.now()}.png`)
  await writeFile(screenshotPath, Buffer.from(voiceScreenshot.data, 'base64'))
  assert.deepEqual(errors, [], 'no browser exceptions after migration')
  console.log(`Daily browser checks passed. ${liveVoices ? 'Live free online references' : 'Simulated references'}; synthetic microphone/scoring.\nScreenshot: ${screenshotPath}`)
} finally {
  await closeBrowser?.().catch(() => {})
  if (ws?.readyState === WebSocket.OPEN) ws.close()
  const exited = new Promise((resolve) => chrome.once('exit', resolve))
  if (chrome.exitCode === null) {
    await Promise.race([exited, pause(2000)])
    if (chrome.exitCode === null) chrome.kill()
  }
  // Only the exact directory created by mkdtemp for this isolated test.
  if (profile.startsWith(join(tmpdir(), 'phonetics-daily-test-'))) {
    await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }).catch(() => {})
  }
}
