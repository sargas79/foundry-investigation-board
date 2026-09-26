import {judgeRoll, parseSkillName, skillKey} from "../rules/gurps.mjs";
import {CLUE_WEIGHTS, DEDUCTIONS, DEDUCTION_RULES, ENEMIES, TIERS, WILDCARDS} from "../rules/monster-hunters.mjs";

/**
 * The GM's deduction ledger for one case: pure data and the arithmetic over it.
 *
 * Nothing here touches Foundry, so the rules can be tested directly and every roll can be replayed
 * from its history entry. Where the ledger is stored — and why that keeps it from players — is
 * scripts/data/deduction-ledger.mjs.
 */

/** Bumped if the ledger's shape changes. */
export const LEDGER_VERSION = 1;

/** How many rolls the history keeps. Old ones go first; the best result is kept separately. */
export const HISTORY_LIMIT = 200;

/** Once-per-adventure uses that belong to one investigator: Lucky Guess, for those with Intuition (p. 6). */
export const ONCE_PER_ADVENTURE = ["lucky"];

/**
 * Once-per-adventure uses that belong to the whole team (p. 7): one Meditation clue however many
 * hunters share the insight, and one custom search program.
 */
export const TEAM_ONCE_PER_ADVENTURE = ["meditation", "program"];

/* -------------------------------------------- */
/*  Shape                                       */
/* -------------------------------------------- */

/**
 * A ledger with nothing in it, set up for the most common case: a monster that takes basic care.
 * @returns {object}
 */
export function emptyLedger() {
  return normalizeLedger({});
}

/* -------------------------------------------- */

/**
 * Fill in defaults and drop anything malformed, so every reader can trust the shape.
 * @param {unknown} raw
 * @returns {object}
 */
export function normalizeLedger(raw) {
  const src = (raw && (typeof raw === "object")) ? raw : {};
  // null and "" are "not set", not zero: Number(null) is 0, which would quietly zero a bonus.
  const num = (v, fallback = 0) => (((v === null) || (v === "") || !Number.isFinite(Number(v)))
    ? fallback : Number(v));
  const str = v => (typeof v === "string" ? v : "");
  const list = v => (Array.isArray(v) ? v : []);

  const deductions = {};
  for ( const type of DEDUCTIONS ) {
    const d = src.deductions?.[type] ?? {};
    const rules = DEDUCTION_RULES[type];
    const factors = {};
    for ( const factor of rules.factors ) {
      const chosen = d.factors?.[factor.id];
      factors[factor.id] = factor.options.some(o => o.id === chosen) ? chosen : defaultOption(type, factor);
    }
    deductions[type] = {
      factors,
      adjust: Math.trunc(num(d.adjust)),
      guess: !!d.guess,
      // Where only: Who succeeded by 5+ and the lair is the address on their papers (p. 9).
      confirmed: !!d.confirmed,
      best: normalizeBest(d.best)
    };
  }

  return {
    version: LEDGER_VERSION,
    enemy: (src.enemy in ENEMIES) ? src.enemy : "demon",
    deductions,
    clues: list(src.clues).filter(c => c && list(c.types).length).map(c => ({
      id: str(c.id) || randomId(),
      clueId: str(c.clueId) || null,
      label: str(c.label),
      types: list(c.types).filter(t => DEDUCTIONS.includes(t)),
      weight: (c.weight in CLUE_WEIGHTS) ? c.weight : "normal",
      bonus: Math.trunc(num(c.bonus, 1)),
      time: num(c.time)
    })).filter(c => c.types.length),
    confusion: Math.max(0, Math.trunc(num(src.confusion))),
    publicRecords: !!src.publicRecords,
    investigators: list(src.investigators).filter(i => i && str(i.uuid)).map(i => ({
      uuid: str(i.uuid),
      name: str(i.name),
      manual: Object.fromEntries(DEDUCTIONS
        .filter(t => Number.isFinite(Number(i.manual?.[t])) && (i.manual[t] !== "") && (i.manual[t] !== null))
        .map(t => [t, Math.trunc(Number(i.manual[t]))])),
      used: Object.fromEntries(ONCE_PER_ADVENTURE.map(k => [k, !!i.used?.[k]]))
    })),
    teamUsed: Object.fromEntries(TEAM_ONCE_PER_ADVENTURE.map(k => [k, !!src.teamUsed?.[k]])),
    sources: list(src.sources).filter(s => s && str(s.label)).map(s => ({
      id: str(s.id) || randomId(),
      label: str(s.label),
      kind: s.kind === "library" ? "library" : "standard",
      attempts: Math.max(0, Math.trunc(num(s.attempts)))
    })),
    history: list(src.history).filter(h => h && DEDUCTIONS.includes(h.type)).slice(-HISTORY_LIMIT),
    deadline: str(src.deadline),
    notes: str(src.notes)
  };
}

/** The option a factor starts on: the book's middle-of-the-road choice. */
function defaultOption(type, factor) {
  const defaults = {
    concealment: "careful", caution: "basic", commonness: "frequent", timing: "one",
    timeTravel: "no", trail: "most", numbers: "n1", goal: "simple", removes: "r0"
  };
  const id = defaults[factor.id];
  return factor.options.some(o => o.id === id) ? id : factor.options[0].id;
}

function normalizeBest(best) {
  if ( !best || !TIERS.includes(best.tier) ) return null;
  return {
    tier: best.tier,
    margin: Number(best.margin) || 0,
    name: String(best.name ?? ""),
    time: Number(best.time) || 0
  };
}

function randomId() {
  return globalThis.foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2, 18);
}

/* -------------------------------------------- */
/*  Modifiers                                   */
/* -------------------------------------------- */

/**
 * The deduction's own difficulty: the chosen factors plus the GM's adjustment.
 * @param {object} ledger
 * @param {string} type
 * @returns {number}
 */
export function baseModifier(ledger, type) {
  const d = ledger.deductions[type];
  let total = d.adjust;
  for ( const factor of DEDUCTION_RULES[type].factors ) {
    total += factor.options.find(o => o.id === d.factors[factor.id])?.mod ?? 0;
  }
  return total;
}

/**
 * The cumulative bonus from clues declared for this deduction.
 * @param {object} ledger
 * @param {string} type
 * @returns {number}
 */
export function clueBonus(ledger, type) {
  return ledger.clues.reduce((sum, c) => sum + (c.types.includes(type) ? c.bonus : 0), 0);
}

/**
 * Everything that modifies a deduction roll, itemised.
 * @param {object} ledger
 * @param {string} type
 * @returns {{base: number, clues: number, clueCount: number, confusion: number, guess: number,
 *            confirmed: number, total: number}}
 */
export function modifierBreakdown(ledger, type) {
  const d = ledger.deductions[type];
  const parts = {
    base: baseModifier(ledger, type),
    clues: clueBonus(ledger, type),
    clueCount: ledger.clues.filter(c => c.types.includes(type)).length,
    confusion: -ledger.confusion,
    guess: d.guess ? 4 : 0,
    confirmed: ((type === "where") && d.confirmed) ? 4 : 0
  };
  parts.total = parts.base + parts.clues + parts.confusion + parts.guess + parts.confirmed;
  return parts;
}

/* -------------------------------------------- */
/*  Skills                                      */
/* -------------------------------------------- */

/**
 * The skills that may roll a deduction in this case, conditional ones filtered by the ledger.
 * @param {object} ledger
 * @param {string} type
 * @returns {object[]}
 */
export function skillsFor(ledger, type) {
  return DEDUCTION_RULES[type].skills(ledger.enemy)
    .filter(req => !req.requires || ledger[req.requires]);
}

/**
 * The best level an investigator can roll a deduction at, before the deduction's modifiers.
 *
 * Considers every allowed skill the character has, at the book's penalty for it, and any wildcard
 * skill that covers it. A level the GM entered by hand wins over all of them.
 *
 * @param {{name: string, spec: string, level: number}[]} known   The character's skills.
 * @param {object[]} allowed                                      From {@link skillsFor}.
 * @param {number|undefined} manual                                GM's override, if any.
 * @returns {{level: number, label: string, manual: boolean}|null}
 */
export function bestSkill(known, allowed, manual) {
  if ( Number.isFinite(manual) ) return {level: manual, label: "manual", manual: true};

  let best = null;
  const consider = (level, label) => {
    if ( !Number.isFinite(level) ) return;
    if ( !best || (level > best.level) ) best = {level, label, manual: false};
  };

  for ( const req of allowed ) {
    const mod = req.mod ?? 0;
    const want = skillKey(req.name);
    const wantSpec = req.spec ? skillKey(req.spec) : null;
    const label = req.spec ? `${req.name} (${req.spec})` : req.name;
    for ( const skill of known ) {
      const name = skillKey(skill.name);
      if ( (name === want) && (!wantSpec || (skillKey(skill.spec) === wantSpec)) ) {
        const shown = skill.spec ? `${skill.name} (${skill.spec})` : skill.name;
        consider(skill.level + mod, mod ? `${shown} ${signed(mod)}` : shown);
      }
      // A wildcard covers the skill whatever its specialty.
      // Own keys only: a skill called "constructor" must not find Object.prototype's.
      else if ( Object.hasOwn(WILDCARDS, name) && WILDCARDS[name].some(covered => skillKey(covered) === want) ) {
        consider(skill.level + mod, `${skill.name}! for ${label}${mod ? ` ${signed(mod)}` : ""}`);
      }
    }
  }
  return best;
}

/**
 * Split a raw skill list (`{name, level}` with specialties in the name) into matchable entries.
 * @param {{name: string, level: number}[]} raw
 * @returns {{name: string, spec: string, level: number}[]}
 */
export function parseSkills(raw) {
  return raw
    .filter(s => s && Number.isFinite(Number(s.level)))
    .map(s => ({...parseSkillName(s.name), level: Number(s.level)}))
    .map(s => ({...s, name: s.name.replace(/!+$/, "")}));
}

/** Format a modifier with its sign. */
export function signed(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

/* -------------------------------------------- */
/*  Rolling                                     */
/* -------------------------------------------- */

/**
 * Which level of success a result reached, if any.
 * @param {{success: boolean, margin: number, critical: string|null}} result
 * @returns {"low"|"mid"|"high"|null}
 */
export function tierOf(result) {
  if ( !result?.success ) return null;
  if ( (result.critical === "success") || (result.margin >= 5) ) return "high";
  if ( result.margin >= 3 ) return "mid";
  return "low";
}

/**
 * Resolve one deduction roll (p. 9).
 *
 * On a critical failure the GM rolls again against the *unmodified* skill — the "verification
 * roll". If that fails too, the GM gives false information; otherwise it is an ordinary failure.
 *
 * @param {object} args
 * @param {number} args.skill       The skill level before the deduction's modifiers.
 * @param {number} args.modifier    The deduction's total modifier.
 * @param {number} args.roll        The 3d6 total of the deduction roll.
 * @param {number} [args.verify]    The 3d6 total of the verification roll, if one is needed.
 * @returns {{effective: number, main: object, verification: object|null, needsVerify: boolean,
 *            outcome: "success"|"failure"|"lie", tier: string|null}}
 */
export function resolveDeduction({skill, modifier, roll, verify}) {
  const effective = skill + modifier;
  const main = judgeRoll(effective, roll);
  const needsVerify = main.critical === "failure";
  let verification = null;
  let outcome = main.success ? "success" : "failure";
  if ( needsVerify && Number.isFinite(verify) ) {
    verification = judgeRoll(skill, verify);
    if ( !verification.success ) outcome = "lie";
  }
  return {effective, main, verification, needsVerify, outcome, tier: tierOf(main)};
}

/**
 * Record a resolved roll in the ledger: history, and the deduction's best result so far.
 * Returns a new ledger; the one passed in is not changed.
 * @param {object} ledger
 * @param {object} entry   `{type, name, tier, margin, ...}` as written to history.
 * @returns {object}
 */
export function recordRoll(ledger, entry) {
  const next = structuredClone(ledger);
  next.history = [...next.history, entry].slice(-HISTORY_LIMIT);
  if ( entry.tier ) {
    const d = next.deductions[entry.type];
    const rank = t => TIERS.indexOf(t);
    const better = !d.best || (rank(entry.tier) > rank(d.best.tier))
      || ((rank(entry.tier) === rank(d.best.tier)) && (entry.margin > d.best.margin));
    if ( better ) d.best = {tier: entry.tier, margin: entry.margin, name: entry.name, time: entry.time};
  }
  return next;
}

/* -------------------------------------------- */
/*  Clues and sources                           */
/* -------------------------------------------- */

/**
 * Add a clue to the ledger, or replace the entry for the same board clue.
 * @param {object} ledger
 * @param {{clueId?: string|null, label: string, types: string[], weight: string, bonus?: number}} clue
 * @param {number} [time]
 * @returns {object}
 */
export function logClue(ledger, {clueId = null, label, types, weight, bonus}, time = Date.now()) {
  const next = structuredClone(ledger);
  const entry = {
    id: randomId(),
    clueId,
    label: String(label ?? ""),
    types: DEDUCTIONS.filter(t => types.includes(t)),
    weight: (weight in CLUE_WEIGHTS) ? weight : "normal",
    bonus: Math.trunc(Number.isFinite(Number(bonus)) ? Number(bonus) : CLUE_WEIGHTS[weight]?.bonus ?? 1),
    time
  };
  next.clues = next.clues.filter(c => !clueId || (c.clueId !== clueId));
  if ( entry.types.length ) next.clues.push(entry);
  return next;
}

/**
 * The ledger entry for a board clue, if it has been declared.
 * @param {object} ledger
 * @param {string} clueId
 * @returns {object|undefined}
 */
export function clueEntry(ledger, clueId) {
  return ledger.clues.find(c => c.clueId === clueId);
}

/**
 * Whether an update would change a clue's Who / What / When / Where / Why stamp.
 * @param {object} system          The clue's current system data.
 * @param {object} [changes]       The `system` part of the update.
 * @returns {boolean}
 */
export function changesStamp(system, changes) {
  if ( !changes || !("deductions" in changes) ) return false;
  const before = [...(system?.deductions ?? [])].sort().join();
  const after = [...(changes.deductions ?? [])].sort().join();
  return before !== after;
}

/**
 * The penalty on the next attempt at a source (Beating a Dead Horse, pp. 6–7).
 * @param {{kind: string, attempts: number}} source
 * @returns {number}
 */
export function deadHorsePenalty(source) {
  return -source.attempts * (source.kind === "library" ? 2 : 4);
}

/**
 * Start a new adventure on the same case: confusion and once-per-adventure uses reset, the
 * clues and results stay.
 * @param {object} ledger
 * @returns {object}
 */
export function newAdventure(ledger) {
  const next = structuredClone(ledger);
  next.confusion = 0;
  for ( const inv of next.investigators ) {
    inv.used = Object.fromEntries(ONCE_PER_ADVENTURE.map(k => [k, false]));
  }
  next.teamUsed = Object.fromEntries(TEAM_ONCE_PER_ADVENTURE.map(k => [k, false]));
  return next;
}

/* -------------------------------------------- */
/*  Transfer                                    */
/* -------------------------------------------- */

/**
 * The ledger as it travels in an export file: clue ids become indexes into the file's clue list,
 * since ids are rewritten on import. Investigators are world-specific and do not travel.
 * @param {object} ledger
 * @param {Map<string, number>} indexOf   Clue id to its index in the export.
 * @returns {object}
 */
export function portableLedger(ledger, indexOf) {
  const out = structuredClone(ledger);
  out.clues = out.clues.map(({clueId, ...rest}) => ({
    ...rest,
    clueIndex: (clueId && indexOf.has(clueId)) ? indexOf.get(clueId) : null
  }));
  out.investigators = [];
  out.history = out.history.map(({actorUuid, ...rest}) => rest);
  return out;
}

/**
 * Restore a ledger from an export file.
 * @param {object} data        As written by {@link portableLedger}.
 * @param {string[]} clueIds   The new ids of the imported clues, by index.
 * @returns {object}
 */
export function restoreLedger(data, clueIds) {
  const src = structuredClone(data ?? {});
  src.clues = (Array.isArray(src.clues) ? src.clues : []).map(({clueIndex, ...rest}) => ({
    ...rest,
    clueId: Number.isInteger(clueIndex) ? (clueIds[clueIndex] ?? null) : null
  }));
  return normalizeLedger(src);
}
