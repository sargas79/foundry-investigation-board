/**
 * Reference data for investigations under GURPS Monster Hunters 2: The Mission (pp. 5–11, 28).
 *
 * Everything the tracker offers the GM — what each deduction asks, what makes it hard, which skills
 * can make the roll and what each level of success reveals — lives here as plain data, so the window
 * and the tests read one source and a correction is a one-line edit.
 *
 * A skill requirement is `{name, spec?, mod?, note?}`:
 * - `spec` absent: any specialty will do (or none, for a skill that has no specialties)
 * - `spec` present: only that specialty
 * - `mod`: a penalty the book puts on using that skill for this deduction
 */

/** The five deductions, in the order the book gives them. */
export const DEDUCTIONS = ["who", "what", "when", "where", "why"];

/** Levels of success on a deduction roll, weakest first. */
export const TIERS = ["low", "mid", "high"];

/**
 * How a clue was obtained decides what it is worth (p. 5–6).
 * `bonus` is the default; a major clue is the GM's call, so it starts at +2 and can be raised.
 */
export const CLUE_WEIGHTS = {
  minor: {label: "Minor (+0)", bonus: 0},
  normal: {label: "Normal (+1)", bonus: 1},
  critical: {label: "Critical success (+2)", bonus: 2},
  major: {label: "Major (+2 or more)", bonus: 2}
};

/**
 * Wildcard skills from Monster Hunters 1: Champions, and the ordinary skills each may stand in for
 * when investigating (the "cheat sheet", p. 5). Only the skills a deduction roll can use are listed.
 */
export const WILDCARDS = {
  "detective": [
    "Administration", "Criminology", "Forensics", "Intelligence Analysis", "Observation",
    "Research", "Search", "Biology", "Chemistry", "Physics", "Streetwise"
  ],
  "lore": [
    "Hidden Lore", "Occultism", "Research", "Area Knowledge", "Biology", "Criminology",
    "Current Affairs", "Diagnosis", "Expert Skill", "Forensics", "History",
    "Intelligence Analysis", "Observation", "Physics", "Psychology", "Search", "Tactics",
    "Thaumatology", "Theology", "Veterinary"
  ],
  "science": [
    "Biology", "Chemistry", "Mathematics", "Physics", "Psychology", "Archaeology"
  ],
  "medic": ["Biology", "Diagnosis", "Physician", "Psychology"],
  "ten-hut": ["Area Knowledge", "Intelligence Analysis", "Tactics", "Strategy"],
  "talker": ["Savoir-Faire"]
};

/* -------------------------------------------- */
/*  Enemies                                     */
/* -------------------------------------------- */

/**
 * The kinds of foe, and the skills that identify them (What, p. 10) and find their lair (Where,
 * pp. 10–11). `human` marks foes with a place in society, which changes a few rolls: Psychology
 * finds a human's base, and What against a monster (not a human) can hand out a free "why" clue.
 */
export const ENEMIES = {
  cryptid: {
    label: "Cryptids",
    human: false,
    what: [
      {name: "Hidden Lore", spec: "Cryptozoology"},
      {name: "Biology", mod: -2},
      {name: "Veterinary", mod: -4}
    ]
  },
  demon: {
    label: "Demons",
    human: false,
    what: [{name: "Hidden Lore", spec: "Demons"}, {name: "Theology", spec: "Abrahamic"}]
  },
  spirit: {
    label: "Free-willed spirits",
    human: false,
    what: [
      {name: "Hidden Lore", spec: "Free Spirits"},
      {name: "Theology", spec: "Shamanic"},
      {name: "Theology", spec: "Voodoo"}
    ]
  },
  ghost: {
    label: "Ghosts",
    human: false,
    what: [{name: "Hidden Lore", spec: "Restless Undead"}, {name: "Theology", spec: "Shamanic"}]
  },
  lycanthrope: {
    label: "Lycanthropes",
    human: false,
    what: [{name: "Hidden Lore", spec: "Lycanthropes"}, {name: "Veterinary", mod: -4}]
  },
  mummy: {
    label: "Mummies",
    human: false,
    what: [{name: "Hidden Lore", spec: "Mummies"}],
    where: [{name: "Archaeology", note: "for a crypt or ancient structure"}]
  },
  angel: {
    label: "Outcast angels",
    human: false,
    what: [{name: "Hidden Lore", spec: "Angels"}, {name: "Theology", spec: "Abrahamic"}]
  },
  parasite: {
    label: "Parasites",
    human: false,
    what: [{name: "Diagnosis"}, {name: "Biology", mod: -4}],
    // A parasite has no lair: Where finds Patient Zero instead.
    where: [{name: "Biology"}, {name: "Physician", mod: -2}],
    whereReplaces: true
  },
  psi: {
    label: "Rogue psis",
    human: true,
    what: [
      {name: "Expert Skill", spec: "Psionics"},
      {name: "Psychology", note: "to recognise telepaths"},
      {name: "Physics", note: "psychokinetics or teleporters"}
    ]
  },
  witch: {
    label: "Rogue witches",
    human: true,
    what: [{name: "Thaumatology"}]
  },
  vampire: {
    label: "Vampires",
    human: false,
    what: [{name: "Hidden Lore", spec: "Vampires"}]
  },
  zombie: {
    label: "Zombies (or skeletons)",
    human: false,
    what: [{name: "Hidden Lore", spec: "Restless Undead"}, {name: "Theology", spec: "Voodoo"}]
  },
  mundane: {
    label: "Nothing supernatural",
    human: true,
    what: [{name: "Occultism", note: "to recognise that nothing supernatural is involved"}]
  }
};

/**
 * Hidden Lore, Theology, Thaumatology and Expert Skill (Psionics) can be replaced by Occultism for
 * informational rolls (p. 8). Asking "what are we facing?" is a focused question, -4.
 */
export const OCCULTISM_FALLBACK = {name: "Occultism", mod: -4, note: "standing in for the lore skill"};

/* -------------------------------------------- */
/*  Deductions                                  */
/* -------------------------------------------- */

/**
 * Each deduction: what it asks, what sets its base difficulty, the skills that can roll it, and
 * what each level of success reveals.
 *
 * `factors` are the book's difficulty choices. Each is a list of options; the chosen options add
 * up, and the GM's free `adjust` covers everything the book asks to be judged case by case.
 *
 * `skills` is a function of the case's enemy, since What and Where depend on the foe.
 */
export const DEDUCTION_RULES = {
  who: {
    label: "Who",
    page: 9,
    question: "Does the foe have a human identity, or contacts within society? If not, there is nothing to deduce — but hand out the occasional \"who\" clue anyway, to keep the players guessing.",
    factors: [
      {
        id: "concealment",
        label: "How the foe hides",
        options: [
          {id: "open", label: "Makes no real attempt to hide", mod: -6},
          {id: "careful", label: "Takes reasonable precautions", mod: -8},
          {id: "serious", label: "Serious effort", mod: -10},
          {id: "paranoid", label: "True paranoia", mod: -12}
        ]
      }
    ],
    adjustHint: "Add half the identity's Status, rounded down (+2 for Status 5, -1 for Status -1). +1 for every full -5 points in Appearance, Supernatural or Unnatural Features, or in Compulsive Behaviors or Odious Personal Habits that give the secret away.",
    skills: () => [
      {name: "Streetwise", note: "to identify criminals"},
      {name: "Current Affairs", note: "for a legitimate cover identity (other specialties at -4)"},
      {name: "Area Knowledge", note: "local folk; -2 city, -4 state, -8 large nation"},
      {name: "Intelligence Analysis", note: "only with 3+ clues from public records", requires: "publicRecords"}
    ],
    results: {
      low: "Vague information about the foe's social position (\"someone of reasonable wealth, likely with ties to local government\").",
      mid: "Specific information, but not enough to positively identify them; legwork could narrow it down.",
      high: "A name, or everything needed to identify them. If their base is the address on their papers, Where is at +4 from now on."
    }
  },

  what: {
    label: "What",
    page: 10,
    question: "What sort of monster or rogue is behind this? With several kinds of enemy working together, roll for each.",
    factors: [
      {
        id: "caution",
        label: "How careful the foe is",
        options: [
          {id: "nonsapient", label: "Nonsapient creature", mod: -2},
          {id: "careless", label: "Intelligent, doesn't care about being caught", mod: -2},
          {id: "basic", label: "Intelligent, basic measures to cover tracks", mod: -4},
          {id: "fastidious", label: "Intelligent, fastidious measures", mod: -6}
        ]
      },
      {
        id: "commonness",
        label: "How common the foe is",
        options: [
          {id: "frequent", label: "Encountered frequently", mod: 0},
          {id: "unexpected", label: "Didn't know it existed in the area", mod: -2},
          {id: "unknown", label: "Didn't know it existed at all", mod: -6}
        ]
      }
    ],
    adjustHint: "-1 to -4 if the foe is acting unusually (a horned demon stabbing a victim instead of goring them).",
    skills: enemy => {
      const own = ENEMIES[enemy]?.what ?? [];
      return enemy === "mundane" ? own : [...own, OCCULTISM_FALLBACK];
    },
    results: {
      low: "The general class of foe (\"psi\", \"demon\") and a very rough count (\"less than 10\", \"10 to 25\").",
      mid: "Also some detail of the foe's capabilities: a psi's powers, what kind of free-willed spirit.",
      high: "The foe's true name if it is a powerful inhuman (the leader's or group's name, for several). If not, detailed abilities, or a free +2 \"why\" clue against monsters, or +2 \"who\" clue against humans."
    }
  },

  when: {
    label: "When",
    page: 10,
    question: "What's the timeline? Noticing patterns in the data to estimate when the enemy's goal comes due. See Time Constraints (p. 28) for why this matters.",
    factors: [
      {
        id: "timing",
        label: "How much timing matters",
        options: [
          {id: "irrelevant", label: "Timing isn't a factor at all", mod: -4},
          {id: "both", label: "Start and result both depend on timing", mod: -4},
          {id: "one", label: "Only one end keeps a schedule", mod: -6},
          {id: "none", label: "Nothing in the plan needs specific timing", mod: -8}
        ]
      },
      {
        id: "timeTravel",
        label: "Time warping or time travel",
        options: [
          {id: "no", label: "Not involved", mod: 0},
          {id: "yes", label: "Involved in any way", mod: -4}
        ]
      }
    ],
    adjustHint: "Once Why is known, any skill that bears directly on the plan can be used instead (Chemistry for a reaction, Thaumatology for spells, Theology for mystical alignments). Add a manual level for it on the Team tab.",
    skills: () => [
      {name: "Intelligence Analysis"},
      {name: "Computer Programming", note: "have the computer do it"},
      {name: "Computer Operation", mod: -4},
      {name: "Administration", note: "if the plan manipulates an organisation"},
      {name: "Tactics", note: "for upcoming attacks"}
    ],
    results: {
      low: "Any meaningful pattern in the existing data, which may predict further attacks, but nothing about big-picture deadlines.",
      mid: "Vague information about any deadline (\"this is going down sometime next week\"), or the realisation that there isn't one.",
      high: "As detailed a timeline as there is."
    }
  },

  where: {
    label: "Where",
    page: 10,
    question: "Where is the enemy's base of operations? Where the plot is coming together, or the monster's lair — not necessarily where it normally lives.",
    factors: [
      {
        id: "trail",
        label: "How hard the lair is to find",
        options: [
          {id: "easy", label: "Easily tracked, or cannot leave the lair", mod: -6},
          {id: "most", label: "Most foes", mod: -8},
          {id: "hidden", label: "Intelligent foe chose an unobvious location", mod: -10}
        ]
      },
      {
        id: "numbers",
        label: "How many foes",
        options: [
          {id: "n1", label: "1–2", mod: 0},
          {id: "n3", label: "3–4", mod: 1},
          {id: "n5", label: "5–8", mod: 2},
          {id: "n9", label: "9–16", mod: 3},
          {id: "n17", label: "17–32", mod: 4},
          {id: "n33", label: "33–64", mod: 5},
          {id: "n65", label: "65–128", mod: 6}
        ]
      }
    ],
    adjustHint: "A dormant swarm, horde or hive of identical monsters counts as one foe.",
    skills: enemy => {
      const foe = ENEMIES[enemy];
      const area = {name: "Area Knowledge", note: "covering the lair; -2 city, -4 state, -8 large nation"};
      if ( !foe ) return [area];
      if ( foe.whereReplaces ) return [...foe.where, area];
      // Humans (and the psis and witches among them) are found through their psychology.
      if ( foe.human ) return [{name: "Psychology"}, area];
      return [...foe.what, ...(foe.where ?? []), OCCULTISM_FALLBACK, area];
    },
    results: {
      low: "The general area, but not the specific location (\"somewhere on the northwest side of town\").",
      mid: "The same, plus a chance to pick up the trail from an optimal starting point (+1 to Tracking), get close enough to spot it with Observation, or find a minion heading that way to follow.",
      high: "The specific location, so the team can plan their own approach."
    }
  },

  why: {
    label: "Why",
    page: 11,
    question: "What is the motive driving all this? A master plan behind the attacks — or were the vampires simply hungry?",
    factors: [
      {
        id: "goal",
        label: "How complex the goal is",
        options: [
          {id: "primal", label: "No motivation past primal urges", mod: -4},
          {id: "simple", label: "Simple, obvious goal", mod: -6},
          {id: "complex", label: "More complex or subtle goal", mod: -8},
          {id: "illuminati", label: "Something to make the Illuminati proud", mod: -10}
        ]
      },
      {
        id: "removes",
        label: "Who does the dirty work",
        options: [
          {id: "r0", label: "The bad guys themselves", mod: 0},
          {id: "r1", label: "Through one remove", mod: -2},
          {id: "r2", label: "Through two removes", mod: -4},
          {id: "r3", label: "Through three removes", mod: -6}
        ]
      }
    ],
    adjustHint: "\"-10 or worse\" for an Illuminati-grade plan: take more here. A skill directly tied to the reason (Engineer (Psychotronics) for a psi-bomb) can be added as a manual level on the Team tab.",
    skills: enemy => {
      const foe = ENEMIES[enemy];
      const out = [
        {name: "Intelligence Analysis"},
        {name: "Psychology", note: "against intelligent foes"},
        {name: "Law", spec: "Criminal"},
        {name: "Law", spec: "Liturgical", note: "for religious crimes"},
        {name: "Criminology"}
      ];
      if ( foe && !foe.human ) {
        for ( const skill of foe.what ) {
          if ( skill.name === "Hidden Lore" ) out.push({...skill, mod: -3, note: "psychology of the inhuman"});
        }
      }
      return out;
    },
    results: {
      low: "What they're doing and vaguely what they want, but no master plan (or the realisation that there is none).",
      mid: "The rough outlines of the plan.",
      high: "The full plan or reason, barring anything the GM sees as impossible to deduce."
    }
  }
};

/* -------------------------------------------- */
/*  Reference                                   */
/* -------------------------------------------- */

/**
 * The rolls that turn up clues, for the tracker's quick reference. Condensed from pp. 6–9.
 * Each entry: where the clue comes from, what to roll, and what shifts it.
 */
export const CLUE_SOURCES = [
  {
    group: "Crime scenes (p. 6)",
    entries: [
      ["Corpses", "Diagnosis or Surgery (Veterinary for animals) for any non-obvious cause of death."],
      ["Forensics", "Forensics in a lab; a follow-up Biology or Chemistry may give another clue."],
      ["General analysis", "Criminology at the scene; critical success hints at the enemy's organisation or identity. Intelligence Analysis after several scenes."],
      ["Hidden items", "Search; a Quick Contest against Holdout or Smuggling if hidden with it."],
      ["Trails", "Tracking for numbers and direction; follow-up Hidden Lore at +4 (GM rolls secretly) for what was there. Veterinary may replace it for animals."],
      ["Cleaned up", "If the culprit used Housekeeping, every unopposed roll here becomes a Quick Contest against it."],
      ["Intuition", "Walking away from an unsearched scene: secret IQ roll for anyone with Intuition to sense something is there."]
    ]
  },
  {
    group: "Research (pp. 6–7)",
    entries: [
      ["Occult library", "Higher of Occultism, Research or the right Hidden Lore (Thaumatology for witches, Expert Skill (Psionics) for psis, Biology for experiments). +1 per 3 points in ancient written languages."],
      ["Religious library", "Theology; only some monsters, by the library's specialty."],
      ["Public library", "Research, or Current Affairs for headlines; -4 to supernatural questions."],
      ["Public records", "Higher of Administration or Research; access may be as hard as a crime scene."],
      ["Library quality", "+1 large university to +3 Library of Congress. Repeats at -2, not -4."],
      ["Time", "An hour per attempt; Speed-Reading halves it for books and records."],
      ["Grimoire sales", "-5 vague idea, -3 detailed description, 0 exact ritual. GM secretly adds (ritual bonus - 2) if one sold, less the seller's discretion and buyer's scary Reputation. Success: whether and when; by 5+ or critical: who."]
    ]
  },
  {
    group: "Computers (p. 7)",
    entries: [
      ["Web search", "Computer Operation (not Research). Only a minor clue; a critical gives the usual +2. Repeats at -2."],
      ["Hacking", "Computer Hacking at 0 personal, -2 corporate, -4 government, -8 black ops. Then Computer Operation or Research at -2 / 0 / +2 / +4."],
      ["Hacking failure", "Admin rolls Computer Operation (10 if unknown) + hacker's margin of failure to notice; critical finds the hacker."],
      ["Custom program", "Computer Programming, 1d hours: +1 to web search and hacking this investigation (+2 on a critical). Once per adventure."]
    ]
  },
  {
    group: "Asking the universe (p. 7)",
    entries: [
      ["Divination", "Path of Chance, Blessed, Prayer, Precognition. Repeats count as one source, whoever asks."],
      ["Meditation", "A new perspective counts as a clue (GM picks the type). Will-6 default: minor clue, normal on a critical. Once per adventure for the team."]
    ]
  },
  {
    group: "Occultism (p. 8)",
    entries: [
      ["Substitute", "For Expert Skill (Psionics), Hidden Lore, Theology or Thaumatology when asking for information."],
      ["Modifiers", "0 generalities, -2 concrete, -4 focused, -6 specific. Double any obscurity penalty."],
      ["Result", "Success gives a minor clue; critical a normal one."]
    ]
  },
  {
    group: "Social engineering (pp. 8–9)",
    entries: [
      ["Asking favours", "-1 to -5 for significant or dangerous help. Reputation applies."],
      ["Bribery", "$100 +1, $500 +2, $2,000 +3, $10,000 +4, times the mark's Wealth. Less than the minimum fails outright."],
      ["Making an impression", "Critical +2, success +1, failure -1, critical failure -2 to the Influence roll."],
      ["Contacts", "Appearance roll, then use the Contact's skill."],
      ["Word on the street", "Current Affairs or Streetwise; Carousing to impress. Critical failure: barroom brawl."],
      ["Interviews", "Interrogation (uncontested). Psychology with a surviving victim for another clue; -1 to -3 if traumatised."],
      ["Speaking with the dead", "Spirit Channeling or Spirit Communication; a ghost is present on 6 or less on 3d."],
      ["Manipulation", "Quick Contest vs Will: Diplomacy, Fast-Talk, Public Speaking, Savoir-Faire, Sex Appeal. Active help needs victory by 5+."],
      ["Arm-twisting", "Intimidation vs Will; critical failure means violence. Full interrogation: Interrogation vs Will per session; good cop/bad cop +1 or +2."],
      ["Monster underworlds", "Best Hidden Lore at -(team size), +1 per member with that lore or of that kind. Failure: social rolls at -margin; by 5+: attacked."]
    ]
  },
  {
    group: "Deduction rolls (p. 9)",
    entries: [
      ["Secret", "The GM rolls, using the highest applicable skill."],
      ["Correct guess", "+4 when the players guessed right and are rolling to confirm it."],
      ["Critical failure", "Roll again against the unmodified skill; if that fails too, the GM lies."],
      ["Buying success", "Character points can buy success, not critical success."],
      ["Obvious", "Blatant evidence needs no roll — but it may be a ruse."]
    ]
  }
];

/** The rules on clues themselves, shown beside the clue log. Condensed from pp. 5–6. */
export const CLUE_RULES = [
  ["Every clue", "The GM names the deduction(s) it helps. That deduction gets a cumulative +1 (+2 if found on a critical), and the GM rolls it for the whole team at once."],
  ["Critical failure", "Confuses the situation: every deduction is at a cumulative -1 for the rest of the adventure."],
  ["Minor clues", "Only somewhat related: +0, but still allows a deduction roll."],
  ["Major clues", "+2 or more to one deduction, or the usual +1 to several."],
  ["Nothing can be something", "A success that rules something out is a clue. A failure that doesn't test it is not."],
  ["Beating a dead horse", "Retrying the same source is at a cumulative -4 (-2 for libraries and web searches), until new information casts it in a new light."],
  ["Lucky guesses", "Once per adventure, an investigator with Intuition may roll a deduction without a clue. Serendipity can simply find a clue (GM picks the type)."],
  ["Freebies", "A nudge to frustrated players is not a clue and gives no bonus."]
];
