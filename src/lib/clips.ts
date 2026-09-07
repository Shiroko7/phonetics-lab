/**
 * The recordings themselves, kept so an attempt can be heard again.
 *
 * The analysis of an attempt is small enough to live in `localStorage`; the
 * audio is not, and a blob URL dies with the page anyway. So the takes go into
 * IndexedDB keyed by the attempt's timestamp, which is what makes an entry in
 * the history list something you can play rather than only read.
 *
 * Every operation here is best-effort. Private windows, blocked site data and
 * full quotas all end the same way: no clip comes back, the history entry loses
 * its player, and nothing else about the app changes.
 */

const DB_NAME = 'phonetics-lab'
const DB_VERSION = 1
const STORE = 'clips'

export interface Clip {
  /** The `at` of the attempt this belongs to. */
  at: number
  blob: Blob
  durationMs: number
}

let db: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  db ??= new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      return resolve(null)
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'at' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return db
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return open().then(
    (handle) =>
      new Promise<T | null>((resolve) => {
        if (!handle) return resolve(null)
        try {
          const transaction = handle.transaction(STORE, mode)
          const request = work(transaction.objectStore(STORE))
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve(null)
          transaction.onabort = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

export function putClip(clip: Clip): Promise<void> {
  return run('readwrite', (store) => store.put(clip)).then(() => undefined)
}

export function getClip(at: number): Promise<Clip | null> {
  return run<Clip>('readonly', (store) => store.get(at) as IDBRequest<Clip>).then(
    (clip) => clip ?? null,
  )
}

/** Which attempts still have audio, so the history list knows what is playable. */
export function listClips(): Promise<Set<number>> {
  return run<IDBValidKey[]>('readonly', (store) => store.getAllKeys()).then(
    (keys) => new Set((keys ?? []).filter((key): key is number => typeof key === 'number')),
  )
}

/** Forget one take. */
export function deleteClip(at: number): Promise<void> {
  return run('readwrite', (store) => store.delete(at)).then(() => undefined)
}

/** Drop the audio of attempts that no longer exist. */
export async function pruneClips(keep: number[]): Promise<void> {
  const wanted = new Set(keep)
  for (const at of await listClips()) {
    if (!wanted.has(at)) await run('readwrite', (store) => store.delete(at))
  }
}

export async function clearClips(): Promise<void> {
  await run('readwrite', (store) => store.clear())
}
