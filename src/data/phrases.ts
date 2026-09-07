/**
 * Curated drill phrases, one sound at a time.
 *
 * A word on its own is a poor drill. *Thought* said in isolation is a
 * performance: the mouth has time to set itself, nothing runs into anything
 * else, and the sound comes out better than it ever does in speech. Put the
 * same vowel between two consonants inside a phrase and the habit reappears —
 * which is the whole point of practising it.
 *
 * So every drill here is a short phrase: long enough that the sound has to
 * survive a real rhythm, short enough to say in one breath and read without
 * losing your place. Each is written around one sound, or around a pair of
 * sounds a learner is likely to merge.
 *
 * `focus` is a claim about what a phrase was written *for*. What it actually
 * contains is measured against the dictionary when the bank is indexed, so the
 * two cannot quietly drift apart — the regression suite fails if a phrase stops
 * carrying the sound it advertises.
 *
 * The inventory covered is every phone that can be *expected*. Dictionary
 * transcriptions are canonical — no flapping, no glottalling — so /ɾ/ and /ʔ/
 * never appear in a target and need no drills of their own.
 */

export interface CuratedPhrase {
  /** The line to say. Ordinary English, ordinary punctuation. */
  text: string
  /** The sound or sounds the phrase was written to hammer. */
  focus: string[]
  /**
   * For a phrase built around a confusion, the two sounds it sets against each
   * other. Offered first when the learner's mistake is exactly that swap: the
   * contrast within one breath is what makes the difference audible.
   */
  pair?: [string, string]
}

export const PHRASE_BANK: CuratedPhrase[] = [
  // ── Monophthongs ───────────────────────────────────────────────────────
  { text: 'Please keep these three clean sheets.', focus: ['i'] },
  { text: 'He needs a piece of sweet cheese.', focus: ['i'] },
  { text: 'Six little kids will finish this.', focus: ['ɪ'] },
  { text: 'The big ship is still in the river.', focus: ['ɪ'] },
  { text: 'Ten men sent the best letter.', focus: ['ɛ'] },
  { text: 'Let them get ready for breakfast.', focus: ['ɛ'] },
  { text: 'That cat sat on my black hat.', focus: ['æ'] },
  { text: 'Dad had a bad habit.', focus: ['æ'] },
  { text: 'Mom washed the pot and the box.', focus: ['ɑ'] },
  { text: 'The doctor got a job at the top.', focus: ['ɑ'] },
  { text: 'I thought I saw a tall dog.', focus: ['ɔ'] },
  { text: 'They called off the long talk.', focus: ['ɔ'] },
  { text: 'Look at the good book he took.', focus: ['ʊ'] },
  { text: 'She could put the wool here.', focus: ['ʊ'] },
  { text: 'Sue knew the truth too soon.', focus: ['u'] },
  { text: 'Choose a few new tunes.', focus: ['u'] },
  { text: 'My brother loves other summer months.', focus: ['ʌ'] },
  { text: 'The young cousin runs up front.', focus: ['ʌ'] },
  { text: 'A banana and a camera again.', focus: ['ə'] },
  { text: 'Around the corner, above the sofa.', focus: ['ə'] },
  { text: 'The problem is a matter of balance.', focus: ['ə'] },

  // ── Diphthongs ─────────────────────────────────────────────────────────
  { text: 'They came late to the same place.', focus: ['eɪ'] },
  { text: 'Wait and take the train today.', focus: ['eɪ'] },
  { text: 'I might buy five white ties.', focus: ['aɪ'] },
  { text: 'My wife likes to drive at night.', focus: ['aɪ'] },
  { text: 'The boy enjoyed a noisy toy.', focus: ['ɔɪ'] },
  { text: 'Avoid spoiling the royal choice.', focus: ['ɔɪ'] },
  { text: 'Most of the old boats go slowly.', focus: ['oʊ'] },
  { text: 'I know the road home.', focus: ['oʊ'] },
  { text: 'The loud crowd found the house.', focus: ['aʊ'] },
  { text: 'How about a mouse downtown?', focus: ['aʊ'] },

  // ── R-coloured ─────────────────────────────────────────────────────────
  { text: 'The nurse heard the first word.', focus: ['ɝ'] },
  { text: 'Her thirty birds were perfect.', focus: ['ɝ'] },
  { text: 'The teacher gave the doctor a letter.', focus: ['ɚ'] },
  { text: 'My father is a better farmer.', focus: ['ɚ'] },

  // ── Stops ──────────────────────────────────────────────────────────────
  { text: 'Peter kept a paper cup.', focus: ['p'] },
  { text: 'Please put the pepper on top.', focus: ['p'] },
  { text: 'Bob bought a big blue box.', focus: ['b'] },
  { text: 'The baby broke a bottle.', focus: ['b'] },
  { text: 'Take two tickets to the party.', focus: ['t'] },
  { text: 'It is time to start the test.', focus: ['t'] },
  { text: 'Dad did a good deed.', focus: ['d'] },
  { text: 'David decided to drive down.', focus: ['d'] },
  { text: 'The cook could cut the cake.', focus: ['k'] },
  { text: 'Keep the black car in the back.', focus: ['k'] },
  { text: 'The girl gave a good gift.', focus: ['ɡ'] },
  { text: 'Greg forgot to get the eggs.', focus: ['ɡ'] },

  // ── Affricates ─────────────────────────────────────────────────────────
  { text: 'Which church has cheap chairs?', focus: ['tʃ'] },
  { text: 'Rich children watch each match.', focus: ['tʃ'] },
  { text: 'John just changed the large jug.', focus: ['dʒ'] },
  { text: 'Jane enjoys orange juice.', focus: ['dʒ'] },

  // ── Fricatives ─────────────────────────────────────────────────────────
  { text: 'Find five fresh coffee cups.', focus: ['f'] },
  { text: 'My friend often feels afraid.', focus: ['f'] },
  { text: 'Victor loves to travel every evening.', focus: ['v'] },
  { text: 'Seven visitors have arrived.', focus: ['v'] },
  { text: 'I think both of them are healthy.', focus: ['θ'] },
  { text: 'Three thousand thin things.', focus: ['θ'] },
  { text: 'This, that, these and those.', focus: ['ð'] },
  { text: 'They gather with their mother.', focus: ['ð'] },
  { text: 'Sam sees six small stars.', focus: ['s'] },
  { text: 'Send us seven sets of keys.', focus: ['s'] },
  { text: 'Those roses were amazing.', focus: ['z'] },
  { text: 'His eyes are always busy.', focus: ['z'] },
  { text: 'She should wash the shirt.', focus: ['ʃ'] },
  { text: 'Sharon finished a special dish.', focus: ['ʃ'] },
  { text: 'The usual television version.', focus: ['ʒ'] },
  { text: 'Measure the pleasure of a vision.', focus: ['ʒ'] },
  { text: 'How happy he is to help!', focus: ['h'] },
  { text: 'Harry had a heavy hat.', focus: ['h'] },

  // ── Nasals, liquids and glides ─────────────────────────────────────────
  { text: 'My mom made some warm milk.', focus: ['m'] },
  { text: 'Many summer mornings seem calm.', focus: ['m'] },
  { text: 'Nine new nurses need money.', focus: ['n'] },
  { text: 'No one knows the answer now.', focus: ['n'] },
  { text: 'He is singing and running along.', focus: ['ŋ'] },
  { text: 'The young king is bringing something.', focus: ['ŋ'] },
  { text: 'Lucy will call a little later.', focus: ['l'] },
  { text: 'I like the yellow lamp.', focus: ['l'] },
  { text: 'Robert wrote a very rare report.', focus: ['ɹ'] },
  { text: 'The red arrow is right over there.', focus: ['ɹ'] },
  { text: 'We will walk when it warms.', focus: ['w'] },
  { text: 'Why would we wait a week?', focus: ['w'] },
  { text: 'Yes, you can use it yourself.', focus: ['j'] },
  { text: 'Did you see the new uniform yet?', focus: ['j'] },

  // ── Contrasts: the sounds most often merged ────────────────────────────
  { text: 'The cop cut the copper cup.', focus: ['ɑ', 'ʌ'], pair: ['ɑ', 'ʌ'] },
  { text: 'My son sang for the sun.', focus: ['ʌ', 'æ'], pair: ['ʌ', 'æ'] },
  { text: 'The young man called for a small cup.', focus: ['ɔ', 'ʌ'], pair: ['ɔ', 'ʌ'] },
  { text: 'My young son loves a long song.', focus: ['ɔ', 'ʌ'], pair: ['ɔ', 'ʌ'] },
  { text: 'He took two good shoes.', focus: ['u', 'ʊ'], pair: ['u', 'ʊ'] },
  { text: 'You should choose two new tools.', focus: ['u', 'ʊ'], pair: ['u', 'ʊ'] },
  { text: 'Please sit in this seat.', focus: ['i', 'ɪ'], pair: ['i', 'ɪ'] },
  { text: 'These ships will leave this evening.', focus: ['i', 'ɪ'], pair: ['i', 'ɪ'] },
  { text: 'He said his dad had a bad bed.', focus: ['æ', 'ɛ'], pair: ['æ', 'ɛ'] },
  { text: 'That cat cut the black bug.', focus: ['æ', 'ʌ'], pair: ['æ', 'ʌ'] },
  { text: 'They said they made the bed.', focus: ['eɪ', 'ɛ'], pair: ['eɪ', 'ɛ'] },
  { text: 'I know the law is old.', focus: ['oʊ', 'ɔ'], pair: ['oʊ', 'ɔ'] },
  { text: 'The boy will buy a toy tie.', focus: ['ɔɪ', 'aɪ'], pair: ['ɔɪ', 'aɪ'] },
  { text: 'The nurse and her father were there.', focus: ['ɝ', 'ɚ'], pair: ['ɝ', 'ɚ'] },
  { text: 'A cup of tea and a piece of cake.', focus: ['ə', 'ʌ'], pair: ['ə', 'ʌ'] },
  { text: 'I think this sink is thick.', focus: ['θ', 's'], pair: ['θ', 's'] },
  { text: 'Think about the tenth tent.', focus: ['θ', 't'], pair: ['θ', 't'] },
  { text: 'The other day my mother had dinner.', focus: ['ð', 'd'], pair: ['ð', 'd'] },
  { text: 'They dared to leave the door open.', focus: ['ð', 'd'], pair: ['ð', 'd'] },
  { text: 'Victor will vote about the boat.', focus: ['v', 'b'], pair: ['v', 'b'] },
  { text: 'Five fine vans arrived safely.', focus: ['v', 'f'], pair: ['v', 'f'] },
  { text: 'We drove west in a van.', focus: ['w', 'v'], pair: ['w', 'v'] },
  { text: 'Larry rarely reads long letters.', focus: ['l', 'ɹ'], pair: ['l', 'ɹ'] },
  { text: 'The red light looks really bright.', focus: ['l', 'ɹ'], pair: ['l', 'ɹ'] },
  { text: 'The thin king is thinking.', focus: ['n', 'ŋ'], pair: ['n', 'ŋ'] },
  { text: 'Please choose the cheap shoes.', focus: ['ʃ', 'tʃ'], pair: ['ʃ', 'tʃ'] },
  { text: 'She sells these sea shells.', focus: ['s', 'ʃ'], pair: ['s', 'ʃ'] },
  { text: 'That prize has a nice price.', focus: ['z', 's'], pair: ['z', 's'] },
  { text: 'Yes, the young judge is joking.', focus: ['j', 'dʒ'], pair: ['j', 'dʒ'] },
  { text: 'The usual pleasure of a shower.', focus: ['ʒ', 'ʃ'], pair: ['ʒ', 'ʃ'] },
  { text: 'Peter bought a big paper bag.', focus: ['p', 'b'], pair: ['p', 'b'] },
  { text: 'The good cook got a gold cup.', focus: ['k', 'ɡ'], pair: ['k', 'ɡ'] },
  { text: 'He had a hat and an apple.', focus: ['h'], pair: ['h', 'ə'] },
]
