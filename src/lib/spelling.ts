/**
 * British spellings mapped onto the American forms CMUdict actually lists.
 *
 * Every candidate produced here is checked against the dictionary before it is
 * used, so over-generating is harmless — "wise" may propose "wize", but nothing
 * will match it and the word falls through to the next stage of the cascade.
 */

const SUBSTITUTIONS: [RegExp, string][] = [
  [/isation$/, 'ization'],
  [/isations$/, 'izations'],
  [/ise$/, 'ize'],
  [/ised$/, 'ized'],
  [/ises$/, 'izes'],
  [/ising$/, 'izing'],
  [/yse$/, 'yze'],
  [/ysed$/, 'yzed'],
  [/ysing$/, 'yzing'],
  [/our$/, 'or'],
  [/ours$/, 'ors'],
  [/ourite$/, 'orite'],
  [/oured$/, 'ored'],
  [/ouring$/, 'oring'],
  [/tre$/, 'ter'],
  [/tres$/, 'ters'],
  [/bre$/, 'ber'],
  [/ce$/, 'se'],
  [/logue$/, 'log'],
  [/logues$/, 'logs'],
  [/mme$/, 'm'],
  [/ae/, 'e'],
  [/oe/, 'e'],
]

/**
 * Irregular pairs the suffix rules cannot reach. Stems only — inflected forms
 * are handled by rewriting the stem and letting morphology take it from there.
 */
const IRREGULAR: Record<string, string> = {
  plough: 'plow', ploughs: 'plows', ploughed: 'plowed', ploughing: 'plowing',
  ploughman: 'plowman', draught: 'draft', draughts: 'drafts', gaol: 'jail',
  kerb: 'curb', tyre: 'tire', tyres: 'tires', pyjamas: 'pajamas',
  aluminium: 'aluminum', grey: 'gray', greyer: 'grayer', storey: 'story',
  storeys: 'stories', cheque: 'check', cheques: 'checks', moustache: 'mustache',
  jewellery: 'jewelry', mould: 'mold', moulds: 'molds', moulded: 'molded',
  smoulder: 'smolder', sceptic: 'skeptic', sceptical: 'skeptical',
  speciality: 'specialty', axe: 'ax', doughnut: 'donut', kilometre: 'kilometer',
  litre: 'liter', litres: 'liters', metre: 'meter', metres: 'meters',
}

/** Undo the doubled l of travelling, cancelled, modelling. */
function undoubleL(word: string): string | null {
  return /ll(ed|ing|er|ers|est)$/.test(word) ? word.replace(/ll(?=(ed|ing|er|ers|est)$)/, 'l') : null
}

/** Plausible American respellings of a word, in rough order of likelihood. */
export function americanVariants(word: string): string[] {
  const out = new Set<string>()

  const irregular = IRREGULAR[word]
  if (irregular) out.add(irregular)

  for (const [pattern, replacement] of SUBSTITUTIONS) {
    if (pattern.test(word)) out.add(word.replace(pattern, replacement))
  }

  const single = undoubleL(word)
  if (single) out.add(single)

  out.delete(word)
  return [...out]
}
