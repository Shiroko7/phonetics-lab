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

import { FANTASY_DRILL_PHRASES } from './fantasyContent.ts'

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
  /*
   * Original contextual lines, written for this drill bank rather than copied
   * from a source. Their texture borrows from public-domain fantasy/adventure
   * and modern report-like prose: a concrete setting, a clear action, and a
   * reason for the sentence to exist. The target sound must still survive in
   * connected speech, which is why these replace isolated-word examples.
   */
  { text: 'The thief thought the southern gate was unlocked.', focus: ['θ'], pair: ['θ', 's'] },
  { text: 'Three sailors crossed the southern sea before sunset.', focus: ['θ'], pair: ['θ', 's'] },
  { text: 'The silver key slid beneath the loose stone.', focus: ['s'] },
  { text: 'The keeper believed the beacon would guide us home.', focus: ['i'] },
  { text: 'The little griffin slipped beneath the bridge.', focus: ['ɪ'] },
  { text: 'The black cat sprang across the cracked tablet.', focus: ['æ'] },
  { text: 'The messenger left a red feather beside the desk.', focus: ['ɛ'] },
  { text: 'The scholar marked the map with a dark star.', focus: ['ɑ'] },
  { text: 'The old lord brought a torch through the hall.', focus: ['ɔ'] },
  { text: 'The cook could put the wooden bowl away.', focus: ['ʊ'] },
  { text: 'The moon moved through the blue mist.', focus: ['u'] },
  { text: 'The young hunter hurried under the summer rain.', focus: ['ʌ'] },
  { text: 'A forgotten letter appeared beneath the paper.', focus: ['ə'] },
  { text: 'The pale dragon waited beside the broken gate.', focus: ['eɪ'] },
  { text: 'I might find the hidden sign by midnight.', focus: ['aɪ'] },
  { text: 'The royal envoy avoided the noisy tavern.', focus: ['ɔɪ'] },
  { text: 'The old road curved below the lonely tower.', focus: ['oʊ'] },
  { text: 'The proud scout found a route around the mountain.', focus: ['aʊ'] },
  { text: 'The merchant heard a distant warning near the frontier.', focus: ['ɝ'] },
  { text: 'The traveler entered the darker chamber at sunset.', focus: ['ɚ'] },
  { text: 'The pale prince placed a map beside the plate.', focus: ['p'] },
  { text: 'A blue banner broke loose above the bridge.', focus: ['b'] },
  { text: 'The captain lifted the lantern toward the tower.', focus: ['t'] },
  { text: 'The guard drew a dagger from the drawer.', focus: ['d'] },
  { text: 'The cart crossed the cracked cobblestone road.', focus: ['k'] },
  { text: 'The gatekeeper gathered green glass from the garden.', focus: ['ɡ'] },
  { text: 'The fox followed a faint footprint through the frost.', focus: ['f'] },
  { text: 'The river curved around the village wall.', focus: ['v'] },
  { text: 'The weather turned warmer as they crossed the heath.', focus: ['ð'] },
  { text: "The wizard's pages rustled as the candles dimmed.", focus: ['z'] },
  { text: 'She pushed the shining shell beneath the shelf.', focus: ['ʃ'] },
  { text: "The treasure's unusual vision confused the guide.", focus: ['ʒ'] },
  { text: 'The watchman chose a chair beside the chimney.', focus: ['tʃ'] },
  { text: "The judge searched the giant's jacket.", focus: ['dʒ'] },
  { text: 'The moonlit messenger moved through the marsh.', focus: ['m'] },
  { text: 'No one knew when the northern bell would ring.', focus: ['n'] },
  { text: 'The king was waiting among the long grass.', focus: ['ŋ'] },
  { text: 'The little lantern lit the lower landing.', focus: ['l'] },
  { text: 'The ranger rode toward the red ridge.', focus: ['ɹ'] },
  { text: 'We watched the white wings rise above the water.', focus: ['w'] },
  { text: 'The young sailor used a yellow map.', focus: ['j'] },
  { text: 'The hidden hero held his breath.', focus: ['h'] },
  { text: 'By dawn, the party had mapped the northern passage.', focus: ['d'] },
  { text: 'The healer warned that the potion would not last.', focus: ['w'] },
  { text: 'After the signal faded, the scouts returned to camp.', focus: ['s'] },
  { text: 'The archive recorded three unusual changes in the valley.', focus: ['tʃ'] },
  { text: 'The system displayed a warning before the bridge collapsed.', focus: ['d'] },
  { text: 'The report found a small but meaningful change.', focus: ['f'] },
  { text: 'The council agreed to postpone the final decision.', focus: ['ə'] },

  // ── Monophthongs ───────────────────────────────────────────────────────
  // /i/
  { text: 'Please keep these three clean sheets.', focus: ['i'] },
  { text: 'He needs a piece of sweet cheese.', focus: ['i'] },
  { text: 'We see green trees reach deep.', focus: ['i'] },
  { text: 'Steve leaves the team each week.', focus: ['i'] },
  { text: 'She believes we need real peace.', focus: ['i'] },
  { text: 'Feel free to speak with me.', focus: ['i'] },
  { text: 'Three Greek teachers meet for tea.', focus: ['i'] },

  // /ɪ/
  { text: 'Six little kids will finish this.', focus: ['ɪ'] },
  { text: 'The big ship is still in the river.', focus: ['ɪ'] },
  { text: 'This silver ring will fit him.', focus: ['ɪ'] },
  { text: 'Quickly listen to the simple music.', focus: ['ɪ'] },
  { text: 'Tim sits with his twin sister.', focus: ['ɪ'] },
  { text: 'Did Bill miss his morning flight?', focus: ['ɪ'] },
  { text: 'Winter brings brisk chill into cities.', focus: ['ɪ'] },

  // /ɛ/
  { text: 'Ten men sent the best letter.', focus: ['ɛ'] },
  { text: 'Let them get ready for breakfast.', focus: ['ɛ'] },
  { text: 'Tell seven friends to help self.', focus: ['ɛ'] },
  { text: 'Send every guest red fresh bread.', focus: ['ɛ'] },
  { text: 'Ken met ten clever French chefs.', focus: ['ɛ'] },
  { text: 'Never forget seven precious lessons today.', focus: ['ɛ'] },
  { text: 'Twelve red desks stood empty.', focus: ['ɛ'] },

  // /æ/
  { text: 'That cat sat on my black hat.', focus: ['æ'] },
  { text: 'Dad had a bad habit.', focus: ['æ'] },
  { text: 'The happy man ran back fast.', focus: ['æ'] },
  { text: 'Pack that black bag and jacket.', focus: ['æ'] },
  { text: 'Ann has an apple and candy.', focus: ['æ'] },
  { text: 'Dan smashed a flat glass pan.', focus: ['æ'] },
  { text: 'That actor can catch rapid passes.', focus: ['æ'] },

  // /ɑ/
  { text: 'Mom washed the pot and the box.', focus: ['ɑ'] },
  { text: 'The doctor got a job at the top.', focus: ['ɑ'] },
  { text: 'Tom dropped hot coffee on socks.', focus: ['ɑ'] },
  { text: 'Stop the clock on that spot.', focus: ['ɑ'] },
  { text: 'A calm cop watched the lot.', focus: ['ɑ'] },
  { text: 'John locked the box upon shock.', focus: ['ɑ'] },
  { text: 'Father got a modern solid watch.', focus: ['ɑ'] },

  // /ɔ/
  { text: 'I thought I saw a tall dog.', focus: ['ɔ'] },
  { text: 'They called off the long talk.', focus: ['ɔ'] },
  { text: 'Paul bought a small autumn lawn.', focus: ['ɔ'] },
  { text: 'The lawyer saw a broad hawk.', focus: ['ɔ'] },
  { text: 'All four daughters walked along lawn.', focus: ['ɔ'] },
  { text: 'Dawn brought a warm soft fog.', focus: ['ɔ'] },
  { text: 'George taught us all about loss.', focus: ['ɔ'] },

  // /ʊ/
  { text: 'Look at the good book he took.', focus: ['ʊ'] },
  { text: 'She could put the wool here.', focus: ['ʊ'] },
  { text: 'He shook the wooden sugar bowl.', focus: ['ʊ'] },
  { text: 'Put that butcher cook in kitchen.', focus: ['ʊ'] },
  { text: 'The wolf stood by wooden brook.', focus: ['ʊ'] },
  { text: 'Could you push that full cart?', focus: ['ʊ'] },
  { text: 'Look at your good foot soldier.', focus: ['ʊ'] },

  // /u/
  { text: 'Sue knew the truth too soon.', focus: ['u'] },
  { text: 'Choose a few new tunes.', focus: ['u'] },
  { text: 'Move the blue canoe into pool.', focus: ['u'] },
  { text: 'Ruth chewed fresh fruit at noon.', focus: ['u'] },
  { text: 'Two cool rules govern this school.', focus: ['u'] },
  { text: 'Who threw the shoe into river?', focus: ['u'] },
  { text: 'Smooth music blew through the room.', focus: ['u'] },

  // /ʌ/
  { text: 'My brother loves other summer months.', focus: ['ʌ'] },
  { text: 'The young cousin runs up front.', focus: ['ʌ'] },
  { text: 'Some funny ducks jumped in mud.', focus: ['ʌ'] },
  { text: 'Judge the lovely sunny Sunday public.', focus: ['ʌ'] },
  { text: 'Nothing touches the tough young hunter.', focus: ['ʌ'] },
  { text: 'Cut some butter above the cup.', focus: ['ʌ'] },
  { text: 'Double the fun among funny brothers.', focus: ['ʌ'] },

  // /ə/
  { text: 'A banana and a camera again.', focus: ['ə'] },
  { text: 'Around the corner, above the sofa.', focus: ['ə'] },
  { text: 'The problem is a matter of balance.', focus: ['ə'] },
  { text: 'About eleven animals appear upon canvas.', focus: ['ə'] },
  { text: 'Another famous doctor arrived in cinema.', focus: ['ə'] },
  { text: 'Collect the data around the sofa.', focus: ['ə'] },
  { text: 'Accept the second attempt with balance.', focus: ['ə'] },
  { text: 'A sudden dragon attacked seven nations.', focus: ['ə'] },

  // ── Diphthongs ─────────────────────────────────────────────────────────
  // /eɪ/
  { text: 'They came late to the same place.', focus: ['eɪ'] },
  { text: 'Wait and take the train today.', focus: ['eɪ'] },
  { text: 'Make great shapes with green clay.', focus: ['eɪ'] },
  { text: 'Eight brave neighbors paint the gate.', focus: ['eɪ'] },
  { text: 'Play a daily game with Jane.', focus: ['eɪ'] },
  { text: 'Stay away from the dangerous lake.', focus: ['eɪ'] },
  { text: 'Explain the basic nature of trade.', focus: ['eɪ'] },

  // /aɪ/
  { text: 'I might buy five white ties.', focus: ['aɪ'] },
  { text: 'My wife likes to drive at night.', focus: ['aɪ'] },
  { text: 'Nine wild lions climb high hills.', focus: ['aɪ'] },
  { text: 'Find the right size bright light.', focus: ['aɪ'] },
  { text: 'Try to fly by Friday night.', focus: ['aɪ'] },
  { text: 'Write five lines about kind minds.', focus: ['aɪ'] },
  { text: 'Quiet nights hide bright white skies.', focus: ['aɪ'] },

  // /ɔɪ/
  { text: 'The boy enjoyed a noisy toy.', focus: ['ɔɪ'] },
  { text: 'Avoid spoiling the royal choice.', focus: ['ɔɪ'] },
  { text: 'Point out the moist fertile soil.', focus: ['ɔɪ'] },
  { text: 'Join the joyous choir in voice.', focus: ['ɔɪ'] },
  { text: 'Boil the olive oil with soy.', focus: ['ɔɪ'] },
  { text: 'Loyal boys avoid noisy toxic toys.', focus: ['ɔɪ'] },
  { text: 'Destroy the poison coil with joy.', focus: ['ɔɪ'] },

  // /oʊ/
  { text: 'Most of the old boats go slowly.', focus: ['oʊ'] },
  { text: 'I know the road home.', focus: ['oʊ'] },
  { text: 'Close the cold yellow stone window.', focus: ['oʊ'] },
  { text: 'Show the gold bowl to Joe.', focus: ['oʊ'] },
  { text: 'Smoke rose over the frozen ocean.', focus: ['oʊ'] },
  { text: 'Nobody knows how roses grow slowly.', focus: ['oʊ'] },
  { text: 'Hold both coats below the porch.', focus: ['oʊ'] },

  // /aʊ/
  { text: 'The loud crowd found the house.', focus: ['aʊ'] },
  { text: 'How about a mouse downtown?', focus: ['aʊ'] },
  { text: 'Count out loud around town now.', focus: ['aʊ'] },
  { text: 'Brown cows plow down around mountain.', focus: ['aʊ'] },
  { text: 'Our proud sour brown hound howls.', focus: ['aʊ'] },
  { text: 'Shout out loud about our town.', focus: ['aʊ'] },
  { text: 'Doubt clouded the proud southern crown.', focus: ['aʊ'] },

  // ── R-coloured ─────────────────────────────────────────────────────────
  // /ɝ/
  { text: 'The nurse heard the first word.', focus: ['ɝ'] },
  { text: 'Her thirty birds were perfect.', focus: ['ɝ'] },
  { text: 'Early workers earn great modern shirts.', focus: ['ɝ'] },
  { text: 'Turn left near third purple church.', focus: ['ɝ'] },
  { text: 'Learn to serve every thirsty person.', focus: ['ɝ'] },
  { text: 'The nervous girl learned early words.', focus: ['ɝ'] },
  { text: 'Further research confirms the worst surge.', focus: ['ɝ'] },

  // /ɚ/
  { text: 'The teacher gave the doctor a letter.', focus: ['ɚ'] },
  { text: 'My father is a better farmer.', focus: ['ɚ'] },
  { text: 'Summer weather triggers faster winter rivers.', focus: ['ɚ'] },
  { text: 'The painter ordered sugar and butter.', focus: ['ɚ'] },
  { text: 'Every sister shares a smaller pitcher.', focus: ['ɚ'] },
  { text: 'Consider the danger of wild tiger.', focus: ['ɚ'] },
  { text: 'Another silver mirror broke after supper.', focus: ['ɚ'] },

  // ── Stops ──────────────────────────────────────────────────────────────
  // /p/
  { text: 'Peter kept a paper cup.', focus: ['p'] },
  { text: 'Please put the pepper on top.', focus: ['p'] },
  { text: 'Push past people to reach park.', focus: ['p'] },
  { text: 'Proper soup needs purple potato pieces.', focus: ['p'] },
  { text: 'Open plastic packets promptly upon pickup.', focus: ['p'] },
  { text: 'Pick up pencil, paper and pen.', focus: ['p'] },
  { text: 'Play piano quietly during simple party.', focus: ['p'] },

  // /b/
  { text: 'Bob bought a big blue box.', focus: ['b'] },
  { text: 'The baby broke a bottle.', focus: ['b'] },
  { text: 'Bring bold brown bears back before.', focus: ['b'] },
  { text: 'Bill built bright black wooden boats.', focus: ['b'] },
  { text: 'Busy bees buzz above blue bells.', focus: ['b'] },
  { text: 'Bring back both basic biology books.', focus: ['b'] },
  { text: 'Bright brass buttons bind broad belt.', focus: ['b'] },

  // /t/
  { text: 'Take two tickets to the party.', focus: ['t'] },
  { text: 'It is time to start the test.', focus: ['t'] },
  { text: 'Tell twenty tall tourists to wait.', focus: ['t'] },
  { text: 'Trust truth to taste completely sweet.', focus: ['t'] },
  { text: 'Tonight try ten tough little tasks.', focus: ['t'] },
  { text: 'Total silence settled over the city.', focus: ['t'] },
  { text: 'Start the tractor toward total center.', focus: ['t'] },

  // /d/
  { text: 'Dad did a good deed.', focus: ['d'] },
  { text: 'David decided to drive down.', focus: ['d'] },
  { text: 'Dan danced during dark dirty days.', focus: ['d'] },
  { text: 'Deep dark valleys divide dual deserts.', focus: ['d'] },
  { text: 'Doctor Davis delivered detailed digital data.', focus: ['d'] },
  { text: 'Draw double dots on wooden doors.', focus: ['d'] },
  { text: 'Dogs dig deep dirt during day.', focus: ['d'] },

  // /k/
  { text: 'The cook could cut the cake.', focus: ['k'] },
  { text: 'Keep the black car in the back.', focus: ['k'] },
  { text: 'Kind kings keep cool clear crystals.', focus: ['k'] },
  { text: 'Cook cold cabbage in copper kettles.', focus: ['k'] },
  { text: 'Quick kids climb across rocky cliffs.', focus: ['k'] },
  { text: 'Carry clean cups to clear kitchen.', focus: ['k'] },
  { text: 'Black cats catch clever quick mice.', focus: ['k'] },

  // /ɡ/
  { text: 'The girl gave a good gift.', focus: ['ɡ'] },
  { text: 'Greg forgot to get the eggs.', focus: ['ɡ'] },
  { text: 'Great green gardens grow good grapes.', focus: ['ɡ'] },
  { text: 'Gary gave golden gifts to guests.', focus: ['ɡ'] },
  { text: 'Go get green grass along gate.', focus: ['ɡ'] },
  { text: 'Grand guests gain great gentle glory.', focus: ['ɡ'] },
  { text: 'Girls giggle happily in green grove.', focus: ['ɡ'] },

  // ── Affricates ─────────────────────────────────────────────────────────
  // /tʃ/
  { text: 'Which church has cheap chairs?', focus: ['tʃ'] },
  { text: 'Rich children watch each match.', focus: ['tʃ'] },
  { text: 'Choose charming chicken with cheddar cheese.', focus: ['tʃ'] },
  { text: 'Charlie chased cheap cheerful chipmunks carefully.', focus: ['tʃ'] },
  { text: 'Teach each child to catch chocolate.', focus: ['tʃ'] },
  { text: 'Much cheerful chatter touched the beach.', focus: ['tʃ'] },
  { text: 'Watch teachers check each child gently.', focus: ['tʃ'] },

  // /dʒ/
  { text: 'John just changed the large jug.', focus: ['dʒ'] },
  { text: 'Jane enjoys orange juice.', focus: ['dʒ'] },
  { text: 'James joined joyful jazz judges June.', focus: ['dʒ'] },
  { text: 'Generous giants jump past jungle gym.', focus: ['dʒ'] },
  { text: 'Judge George managed huge bridge projects.', focus: ['dʒ'] },
  { text: 'Gentle jokes generate genuine joyous energy.', focus: ['dʒ'] },
  { text: 'Danger emerged from the dark jail.', focus: ['dʒ'] },

  // ── Fricatives ─────────────────────────────────────────────────────────
  // /f/
  { text: 'Find five fresh coffee cups.', focus: ['f'] },
  { text: 'My friend often feels afraid.', focus: ['f'] },
  { text: 'Four fast foxes fought for food.', focus: ['f'] },
  { text: 'Frank feeds fat friendly flying fish.', focus: ['f'] },
  { text: 'Famous figures face fierce future fights.', focus: ['f'] },
  { text: 'Follow five footprints through flat forest.', focus: ['f'] },
  { text: 'Fresh flowers fell from fifty floors.', focus: ['f'] },

  // /v/
  { text: 'Victor loves to travel every evening.', focus: ['v'] },
  { text: 'Seven visitors have arrived.', focus: ['v'] },
  { text: 'Vivid silver velvet covers valuable vases.', focus: ['v'] },
  { text: 'Vote for several brave brave volunteers.', focus: ['v'] },
  { text: 'Every vibrant village leaves heavy vibes.', focus: ['v'] },
  { text: 'Never deceive eleven devoted clever drivers.', focus: ['v'] },
  { text: 'Active voters value very diverse views.', focus: ['v'] },

  // /θ/
  { text: 'I think both of them are healthy.', focus: ['θ'] },
  { text: 'Three thousand thin things.', focus: ['θ'] },
  { text: 'Thank the author for third chapter.', focus: ['θ'] },
  { text: 'Nothing is worth more than truth.', focus: ['θ'] },
  { text: 'Both brothers thought of everything today.', focus: ['θ'] },
  { text: 'Keith threw three thick brown stones.', focus: ['θ'] },
  { text: 'Thirty thirsty thieves ran south quickly.', focus: ['θ'] },
  { text: 'Healthy teeth need fresh sweet breath.', focus: ['θ'] },

  // /ð/
  { text: 'This, that, these and those.', focus: ['ð'] },
  { text: 'They gather with their mother.', focus: ['ð'] },
  { text: 'Breathe the smooth air together daily.', focus: ['ð'] },
  { text: 'My brother and father went there.', focus: ['ð'] },
  { text: 'Neither of them liked the weather.', focus: ['ð'] },
  { text: 'Without them we would rather stay.', focus: ['ð'] },
  { text: 'Another feather fell upon the leather.', focus: ['ð'] },
  { text: 'They bathe together in northern rivers.', focus: ['ð'] },

  // /s/
  { text: 'Sam sees six small stars.', focus: ['s'] },
  { text: 'Send us seven sets of keys.', focus: ['s'] },
  { text: 'Simple steps solve several silly problems.', focus: ['s'] },
  { text: 'Sweet soft songs soothe sad souls.', focus: ['s'] },
  { text: 'Seven sisters slept beside silent stream.', focus: ['s'] },
  { text: 'Stand still outside this sunny street.', focus: ['s'] },
  { text: 'Start seven small safe summer schools.', focus: ['s'] },

  // /z/
  { text: 'Those roses were amazing.', focus: ['z'] },
  { text: 'His eyes are always busy.', focus: ['z'] },
  { text: 'Zebras graze beside buzzing yellow bees.', focus: ['z'] },
  { text: 'Lazy lizards snooze along pleasant breeze.', focus: ['z'] },
  { text: 'Music pleases wise busy business men.', focus: ['z'] },
  { text: 'Freeze fresh pies on frozen trays.', focus: ['z'] },
  { text: 'These crazy puzzles amaze clever cousins.', focus: ['z'] },

  // /ʃ/
  { text: 'She should wash the shirt.', focus: ['ʃ'] },
  { text: 'Sharon finished a special dish.', focus: ['ʃ'] },
  { text: 'Show surely shall shine upon ocean.', focus: ['ʃ'] },
  { text: 'Short shadows shelter shy sheep nicely.', focus: ['ʃ'] },
  { text: 'Fresh fish dishes surely satisfy wishes.', focus: ['ʃ'] },
  { text: 'Shoot short shapes through sharp shadows.', focus: ['ʃ'] },
  { text: 'She showed special shiny Russian shoes.', focus: ['ʃ'] },

  // /ʒ/
  { text: 'The usual television version.', focus: ['ʒ'] },
  { text: 'Measure the pleasure of a vision.', focus: ['ʒ'] },
  { text: 'Treasure visual pleasure in casual leisure.', focus: ['ʒ'] },
  { text: 'Casual decisions lead to visual illusion.', focus: ['ʒ'] },
  { text: 'Measure Asian confusion with unusual precision.', focus: ['ʒ'] },
  { text: 'Pleasure arrives through visual television arts.', focus: ['ʒ'] },
  { text: 'Unusual exposure created sudden beige illusion.', focus: ['ʒ'] },

  // /h/
  { text: 'How happy he is to help!', focus: ['h'] },
  { text: 'Harry had a heavy hat.', focus: ['h'] },
  { text: 'Henry holds his huge horse here.', focus: ['h'] },
  { text: 'Humble heroes have huge warm hearts.', focus: ['h'] },
  { text: 'He hoped his home had heat.', focus: ['h'] },
  { text: 'Hold his hand behind high hills.', focus: ['h'] },
  { text: 'Happy horses hunt healthy green hay.', focus: ['h'] },

  // ── Nasals, liquids and glides ─────────────────────────────────────────
  // /m/
  { text: 'My mom made some warm milk.', focus: ['m'] },
  { text: 'Many summer mornings seem calm.', focus: ['m'] },
  { text: 'Most modern men make much money.', focus: ['m'] },
  { text: 'Music moves million minds more mighty.', focus: ['m'] },
  { text: 'Mom met many modern museum members.', focus: ['m'] },
  { text: 'Make more memories in calm autumn.', focus: ['m'] },
  { text: 'Major motions move small metal machines.', focus: ['m'] },

  // /n/
  { text: 'Nine new nurses need money.', focus: ['n'] },
  { text: 'No one knows the answer now.', focus: ['n'] },
  { text: 'Noisy neighbors notice nine nice notes.', focus: ['n'] },
  { text: 'Never notice ninety nine green needles.', focus: ['n'] },
  { text: 'None knew natural northern nation news.', focus: ['n'] },
  { text: 'New nations need noble novel names.', focus: ['n'] },
  { text: 'Nick noticed nine normal northern nights.', focus: ['n'] },

  // /ŋ/
  { text: 'He is singing and running along.', focus: ['ŋ'] },
  { text: 'The young king is bringing something.', focus: ['ŋ'] },
  { text: 'Strong birds sing along long spring.', focus: ['ŋ'] },
  { text: 'Ringing bells bring charming spring feelings.', focus: ['ŋ'] },
  { text: 'Young kings hang among strong strings.', focus: ['ŋ'] },
  { text: 'Walking along brings pleasant strong feeling.', focus: ['ŋ'] },
  { text: 'Going fishing during spring is amazing.', focus: ['ŋ'] },

  // /l/
  { text: 'Lucy will call a little later.', focus: ['l'] },
  { text: 'I like the yellow lamp.', focus: ['l'] },
  { text: 'Little children play along lovely lake.', focus: ['l'] },
  { text: 'Late July always brings clear light.', focus: ['l'] },
  { text: 'Leave eleven clean plates on table.', focus: ['l'] },
  { text: 'Long lonely lines fill the hall.', focus: ['l'] },
  { text: 'Look closely at the tall glass.', focus: ['l'] },

  // /ɹ/
  { text: 'Robert wrote a very rare report.', focus: ['ɹ'] },
  { text: 'The red arrow is right over there.', focus: ['ɹ'] },
  { text: 'Green trees grow across round rocks.', focus: ['ɹ'] },
  { text: 'Three brave runners reached the road.', focus: ['ɹ'] },
  { text: 'Drive round the grand orange bridge.', focus: ['ɹ'] },
  { text: 'Bright stars bring great rich pride.', focus: ['ɹ'] },
  { text: 'Every spring rain restores our river.', focus: ['ɹ'] },

  // /w/
  { text: 'We will walk when it warms.', focus: ['w'] },
  { text: 'Why would we wait a week?', focus: ['w'] },
  { text: 'Wild winter winds wipe warm waves.', focus: ['w'] },
  { text: 'Will William watch white water waves?', focus: ['w'] },
  { text: 'We want wonderful water every week.', focus: ['w'] },
  { text: 'Where were wild wolves walking Wednesday?', focus: ['w'] },
  { text: 'Warm winds whisper welcome words weekly.', focus: ['w'] },

  // /j/
  { text: 'Yes, you can use it yourself.', focus: ['j'] },
  { text: 'Did you see the new uniform yet?', focus: ['j'] },
  { text: 'Young students yearn for youth yesterday.', focus: ['j'] },
  { text: 'You yielded your yellow yarn yesterday.', focus: ['j'] },
  { text: 'Yet you say yes every year.', focus: ['j'] },
  { text: 'Young York lawyers use yellow yachts.', focus: ['j'] },
  { text: 'Yes you joined unique youthful yoga.', focus: ['j'] },

  // ── Contrasts: the sounds most often merged ────────────────────────────
  { text: 'The cop cut the copper cup.', focus: ['ɑ', 'ʌ'], pair: ['ɑ', 'ʌ'] },
  { text: 'Tom took some luck with lock.', focus: ['ɑ', 'ʌ'], pair: ['ɑ', 'ʌ'] },
  { text: 'Shut the hot shop up front.', focus: ['ɑ', 'ʌ'], pair: ['ɑ', 'ʌ'] },
  { text: 'My son sang for the sun.', focus: ['ʌ', 'æ'], pair: ['ʌ', 'æ'] },
  { text: 'The cat cut the black bug.', focus: ['æ', 'ʌ'], pair: ['æ', 'ʌ'] },
  { text: 'That young hunter had bad luck.', focus: ['æ', 'ʌ'], pair: ['æ', 'ʌ'] },
  { text: 'The young man called for a small cup.', focus: ['ɔ', 'ʌ'], pair: ['ɔ', 'ʌ'] },
  { text: 'My young son loves a long song.', focus: ['ɔ', 'ʌ'], pair: ['ɔ', 'ʌ'] },
  { text: 'He took two good shoes.', focus: ['u', 'ʊ'], pair: ['u', 'ʊ'] },
  { text: 'You should choose two new tools.', focus: ['u', 'ʊ'], pair: ['u', 'ʊ'] },
  { text: 'A fool fell in a full pool.', focus: ['u', 'ʊ'], pair: ['u', 'ʊ'] },
  { text: 'Pull two good tools from room.', focus: ['u', 'ʊ'], pair: ['u', 'ʊ'] },
  { text: 'Please sit in this seat.', focus: ['i', 'ɪ'], pair: ['i', 'ɪ'] },
  { text: 'These ships will leave this evening.', focus: ['i', 'ɪ'], pair: ['i', 'ɪ'] },
  { text: 'Eat this piece of crisp fish.', focus: ['i', 'ɪ'], pair: ['i', 'ɪ'] },
  { text: 'Feel free to fill this bin.', focus: ['i', 'ɪ'], pair: ['i', 'ɪ'] },
  { text: 'He said his dad had a bad bed.', focus: ['æ', 'ɛ'], pair: ['æ', 'ɛ'] },
  { text: 'Send that sad man ten pens.', focus: ['æ', 'ɛ'], pair: ['æ', 'ɛ'] },
  { text: 'Tell Dan that red apples fell.', focus: ['æ', 'ɛ'], pair: ['æ', 'ɛ'] },
  { text: 'They said they made the bed.', focus: ['eɪ', 'ɛ'], pair: ['eɪ', 'ɛ'] },
  { text: 'I know the law is old.', focus: ['oʊ', 'ɔ'], pair: ['oʊ', 'ɔ'] },
  { text: 'The boy will buy a toy tie.', focus: ['ɔɪ', 'aɪ'], pair: ['ɔɪ', 'aɪ'] },
  { text: 'The nurse and her father were there.', focus: ['ɝ', 'ɚ'], pair: ['ɝ', 'ɚ'] },
  { text: 'A cup of tea and a piece of cake.', focus: ['ə', 'ʌ'], pair: ['ə', 'ʌ'] },
  { text: 'I think this sink is thick.', focus: ['θ', 's'], pair: ['θ', 's'] },
  { text: 'Six thin thieves saw some moss.', focus: ['θ', 's'], pair: ['θ', 's'] },
  { text: 'The path has grass and moss.', focus: ['θ', 's'], pair: ['θ', 's'] },
  { text: 'Sam thought something sank south.', focus: ['θ', 's'], pair: ['θ', 's'] },
  { text: 'Think about the tenth tent.', focus: ['θ', 't'], pair: ['θ', 't'] },
  { text: 'Tom threw three tin cups today.', focus: ['θ', 't'], pair: ['θ', 't'] },
  { text: 'Two thirsty twins took three toys.', focus: ['θ', 't'], pair: ['θ', 't'] },
  { text: 'The other day my mother had dinner.', focus: ['ð', 'd'], pair: ['ð', 'd'] },
  { text: 'They dared to leave the door open.', focus: ['ð', 'd'], pair: ['ð', 'd'] },
  { text: 'Dan said that these days differ.', focus: ['ð', 'd'], pair: ['ð', 'd'] },
  { text: 'Do not bother that dark dog.', focus: ['ð', 'd'], pair: ['ð', 'd'] },
  { text: 'Victor will vote about the boat.', focus: ['v', 'b'], pair: ['v', 'b'] },
  { text: 'Bob drove a big brown van.', focus: ['v', 'b'], pair: ['v', 'b'] },
  { text: 'Bring best velvet blankets back quickly.', focus: ['v', 'b'], pair: ['v', 'b'] },
  { text: 'Five fine vans arrived safely.', focus: ['v', 'f'], pair: ['v', 'f'] },
  { text: 'Few fans viewed that vast valley.', focus: ['v', 'f'], pair: ['v', 'f'] },
  { text: 'Five fine vases fell very fast.', focus: ['v', 'f'], pair: ['v', 'f'] },
  { text: 'We drove west in a van.', focus: ['w', 'v'], pair: ['w', 'v'] },
  { text: 'Will Victor visit West Virginia warmly?', focus: ['w', 'v'], pair: ['w', 'v'] },
  { text: 'Warm velvet vest worn with wonder.', focus: ['w', 'v'], pair: ['w', 'v'] },
  { text: 'Larry rarely reads long letters.', focus: ['l', 'ɹ'], pair: ['l', 'ɹ'] },
  { text: 'The red light looks really bright.', focus: ['l', 'ɹ'], pair: ['l', 'ɹ'] },
  { text: 'Clean river rocks roll round lakes.', focus: ['l', 'ɹ'], pair: ['l', 'ɹ'] },
  { text: 'Long roads lead right to lake.', focus: ['l', 'ɹ'], pair: ['l', 'ɹ'] },
  { text: 'The thin king is thinking.', focus: ['n', 'ŋ'], pair: ['n', 'ŋ'] },
  { text: 'The singer won a long song contest.', focus: ['n', 'ŋ'], pair: ['n', 'ŋ'] },
  { text: 'Running and winning bring pleasant king feelings.', focus: ['n', 'ŋ'], pair: ['n', 'ŋ'] },
  { text: 'Please choose the cheap shoes.', focus: ['ʃ', 'tʃ'], pair: ['ʃ', 'tʃ'] },
  { text: 'She sells these sea shells.', focus: ['s', 'ʃ'], pair: ['s', 'ʃ'] },
  { text: 'Sue should save six silver shoes.', focus: ['s', 'ʃ'], pair: ['s', 'ʃ'] },
  { text: 'Show some simple signs of shine.', focus: ['s', 'ʃ'], pair: ['s', 'ʃ'] },
  { text: 'That prize has a nice price.', focus: ['z', 's'], pair: ['z', 's'] },
  { text: 'His sister loves sweet rose music.', focus: ['z', 's'], pair: ['z', 's'] },
  { text: 'Seven buzzards saw several wise kings.', focus: ['z', 's'], pair: ['z', 's'] },
  { text: 'Yes, the young judge is joking.', focus: ['j', 'dʒ'], pair: ['j', 'dʒ'] },
  { text: 'Jane took the chain into town.', focus: ['tʃ', 'dʒ'], pair: ['tʃ', 'dʒ'] },
  { text: 'Catch the jet near the church.', focus: ['tʃ', 'dʒ'], pair: ['tʃ', 'dʒ'] },
  { text: 'The usual pleasure of a shower.', focus: ['ʒ', 'ʃ'], pair: ['ʒ', 'ʃ'] },
  { text: 'Peter bought a big paper bag.', focus: ['p', 'b'], pair: ['p', 'b'] },
  { text: 'Please bring purple bags back promptly.', focus: ['p', 'b'], pair: ['p', 'b'] },
  { text: 'Put big brown boots past park.', focus: ['p', 'b'], pair: ['p', 'b'] },
  { text: 'Ten tall dancers did two dances.', focus: ['t', 'd'], pair: ['t', 'd'] },
  { text: 'David took two dry dates down.', focus: ['t', 'd'], pair: ['t', 'd'] },
  { text: 'Tell Dan to drive today.', focus: ['t', 'd'], pair: ['t', 'd'] },
  { text: 'The good cook got a gold cup.', focus: ['k', 'ɡ'], pair: ['k', 'ɡ'] },
  { text: 'Get cold cabbage from green garden.', focus: ['k', 'ɡ'], pair: ['k', 'ɡ'] },
  { text: 'Greg kept clean green cups close.', focus: ['k', 'ɡ'], pair: ['k', 'ɡ'] },
  { text: 'He had a hat and an apple.', focus: ['h'], pair: ['h', 'ə'] },
  ...FANTASY_DRILL_PHRASES,
]
