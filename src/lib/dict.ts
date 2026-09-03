/**
 * Loads the prebuilt CMUdict-derived pronunciation table.
 *
 * The file is ~2.8 MB of plain text, so it streams with progress rather than
 * blocking on one opaque fetch, and is parsed into a Map once per session.
 */

export type Dictionary = Map<string, string[]>

const DICT_URL = new URL('./dict/cmudict-ipa.txt', document.baseURI).href

export interface LoadProgress {
  loaded: number
  total: number
}

function parse(text: string): Dictionary {
  const dict: Dictionary = new Map()
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    dict.set(line.slice(0, tab), line.slice(tab + 1).split('|'))
  }
  return dict
}

let cached: Promise<Dictionary> | null = null

export function loadDictionary(onProgress?: (p: LoadProgress) => void): Promise<Dictionary> {
  cached ??= (async () => {
    const res = await fetch(DICT_URL)
    if (!res.ok) throw new Error(`Could not load the dictionary (${res.status})`)

    const total = Number(res.headers.get('content-length')) || 0

    // Without a body reader there is nothing to report progress from.
    if (!res.body || !onProgress) return parse(await res.text())

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let text = ''
    let loaded = 0

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      loaded += value.byteLength
      text += decoder.decode(value, { stream: true })
      onProgress({ loaded, total })
    }
    text += decoder.decode()

    return parse(text)
  })().catch((err) => {
    // A failed load should not poison every later attempt.
    cached = null
    throw err
  })

  return cached
}
