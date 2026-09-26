import {MODULE_ID, PAGE_TYPES, modulePath} from "../constants.mjs";
import {
  CLUE_RULES,
  CLUE_SOURCES,
  CLUE_WEIGHTS,
  DEDUCTIONS,
  DEDUCTION_RULES,
  ENEMIES,
  TIERS
} from "../rules/monster-hunters.mjs";
import {
  ONCE_PER_ADVENTURE,
  TEAM_ONCE_PER_ADVENTURE,
  bestSkill,
  deadHorsePenalty,
  modifierBreakdown,
  newAdventure,
  signed,
  skillsFor
} from "../data/deductions.mjs";
import {actorHasTrait, actorSkills, readLedger, updateLedger} from "../data/deduction-ledger.mjs";
import {declareClue, describeOutcome, rollDeductions} from "../data/deduction-rolls.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/**
 * The GM's deduction tracker for one case (GURPS Monster Hunters 2, pp. 5–11).
 *
 * Everything it shows comes from the case's ledger, which lives in the GM-only companion entry, so
 * the window is GM-only by nature and not merely by a check: a player has nothing to fill it with.
 *
 * Every field saves on change. The tracker is something a GM glances at and nudges mid-session;
 * a Save button would be one more thing to forget with the players waiting.
 */
export default class DeductionTracker extends HandlebarsApplicationMixin(ApplicationV2) {

  /** Open trackers, by case id, so a ledger change can refresh the right one. */
  static #open = new Map();

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "ib-deductions"],
    tag: "div",
    window: {
      title: "INVESTIGATION_BOARD.DEDUCTIONS.Title",
      icon: "fa-solid fa-magnifying-glass",
      resizable: true
    },
    position: {width: 760, height: 720},
    actions: {
      selectTab: DeductionTracker.#onSelectTab,
      rollTeam: DeductionTracker.#onRollTeam,
      logFreeClue: DeductionTracker.#onLogFreeClue,
      removeClue: DeductionTracker.#onRemoveClue,
      confusion: DeductionTracker.#onConfusion,
      addParty: DeductionTracker.#onAddParty,
      removeInvestigator: DeductionTracker.#onRemoveInvestigator,
      luckyGuess: DeductionTracker.#onLuckyGuess,
      addSource: DeductionTracker.#onAddSource,
      sourceAttempt: DeductionTracker.#onSourceAttempt,
      removeSource: DeductionTracker.#onRemoveSource,
      newAdventure: DeductionTracker.#onNewAdventure,
      clearHistory: DeductionTracker.#onClearHistory
    }
  };

  /** @override */
  static PARTS = {
    body: {template: modulePath("templates/deduction-tracker.hbs"), scrollable: [".ib-dt-body"]}
  };

  /** The tabs, in order. */
  static TAB_IDS = ["deductions", "clues", "team", "sources", "log", "reference"];

  /* -------------------------------------------- */

  /**
   * @param {object} options
   * @param {string} options.caseId
   */
  constructor({caseId, ...options} = {}) {
    super({id: `investigation-board-deductions-${caseId}`, ...options});
    this.caseId = caseId;
  }

  /** The tab on show. */
  #tab = "deductions";

  /** The case this tracker belongs to. */
  get currentCase() {
    return game.journal.get(this.caseId) ?? null;
  }

  /** @override */
  get title() {
    return game.i18n.format("INVESTIGATION_BOARD.DEDUCTIONS.TitleFor", {name: this.currentCase?.name ?? ""});
  }

  /* -------------------------------------------- */

  /**
   * Open the tracker for a case, or bring an open one forward.
   * @param {JournalEntry} journal
   * @returns {Promise<DeductionTracker>|undefined}
   */
  static open(journal) {
    if ( !game.user.isGM || !journal ) return;
    const existing = this.#open.get(journal.id);
    if ( existing ) return existing.render({force: true});
    const app = new this({caseId: journal.id});
    this.#open.set(journal.id, app);
    return app.render({force: true});
  }

  /**
   * Re-render the tracker for a case, if one is open.
   * @param {string} caseId
   */
  static refresh(caseId) {
    const app = this.#open.get(caseId);
    if ( app?.rendered ) app.render();
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    if ( DeductionTracker.#open.get(this.caseId) === this ) DeductionTracker.#open.delete(this.caseId);
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const journal = this.currentCase;
    if ( !journal ) return Object.assign(context, {missing: true});

    const ledger = readLedger(journal);
    const loc = key => game.i18n.localize(`INVESTIGATION_BOARD.DEDUCTIONS.${key}`);
    // Each sheet is read once per render, not once per deduction and column.
    const team = ledger.investigators.map(inv => {
      const actor = fromUuidSync(inv.uuid);
      return {inv, actor, skills: actorSkills(actor)};
    });

    const deductions = DEDUCTIONS.map(type => {
      const rules = DEDUCTION_RULES[type];
      const d = ledger.deductions[type];
      const parts = modifierBreakdown(ledger, type);
      const allowed = skillsFor(ledger, type);
      return {
        type,
        label: rules.label,
        page: rules.page,
        question: rules.question,
        adjust: d.adjust,
        adjustHint: rules.adjustHint,
        guess: d.guess,
        confirmed: d.confirmed,
        showConfirmed: type === "where",
        whoNamed: (type === "where") && (ledger.deductions.who.best?.tier === "high"),
        factors: rules.factors.map(factor => ({
          id: factor.id,
          label: factor.label,
          options: factor.options.map(o => ({
            id: o.id,
            label: `${o.label} (${signed(o.mod)})`,
            selected: d.factors[factor.id] === o.id
          }))
        })),
        parts: {
          base: signed(parts.base),
          clues: signed(parts.clues),
          clueCount: parts.clueCount,
          confusion: signed(parts.confusion),
          guess: parts.guess ? signed(parts.guess) : null,
          confirmed: parts.confirmed ? signed(parts.confirmed) : null,
          total: signed(parts.total)
        },
        best: d.best ? {...d.best, label: loc(`Tier.${d.best.tier}`)} : null,
        results: TIERS.map(tier => ({
          tier,
          label: loc(`Tier.${tier}`),
          text: rules.results[tier],
          reached: !!d.best && (TIERS.indexOf(d.best.tier) >= TIERS.indexOf(tier))
        })),
        skills: allowed.map(s => [
          s.spec ? `${s.name} (${s.spec})` : s.name,
          s.mod ? signed(s.mod) : "",
          s.note ? `— ${s.note}` : ""
        ].filter(Boolean).join(" ")),
        team: team.map(({inv, actor, skills}) => {
          const skill = bestSkill(skills, allowed, inv.manual[type]);
          return {
            name: actor?.name ?? inv.name,
            skill: skill ? (skill.manual ? loc("ManualSkill") : skill.label) : loc("NoSkill"),
            level: skill?.level ?? null,
            effective: skill ? skill.level + parts.total : null
          };
        })
      };
    });

    const board = journal.pages;
    const clues = ledger.clues.map(c => ({
      id: c.id,
      label: c.clueId ? (board.get(c.clueId)?.name ?? loc("MissingClue")) : c.label,
      onBoard: !!c.clueId,
      types: c.types.map(t => DEDUCTION_RULES[t].label).join(", "),
      bonus: signed(c.bonus),
      weight: CLUE_WEIGHTS[c.weight]?.label ?? c.weight
    })).reverse();

    const investigators = team.map(({inv, actor, skills}) => ({
      uuid: inv.uuid,
      name: actor?.name ?? inv.name,
      img: actor?.img ?? "icons/svg/mystery-man.svg",
      missing: !actor,
      intuition: actorHasTrait(actor, "Intuition"),
      serendipity: actorHasTrait(actor, "Serendipity"),
      skillCount: skills.length,
      manual: DEDUCTIONS.map(type => ({
        type,
        label: DEDUCTION_RULES[type].label,
        value: inv.manual[type] ?? "",
        auto: bestSkill(skills, skillsFor(ledger, type))?.level ?? "—"
      })),
      used: ONCE_PER_ADVENTURE.map(key => ({key, label: loc(`Use.${key}`), checked: inv.used[key]})),
      luckySpent: inv.used.lucky
    }));
    const teamUsed = TEAM_ONCE_PER_ADVENTURE.map(key => ({
      key, label: loc(`Use.${key}`), checked: ledger.teamUsed[key]
    }));

    const sources = ledger.sources.map((s, index) => ({
      ...s,
      index,
      next: signed(deadHorsePenalty(s)),
      library: s.kind === "library"
    }));

    const history = ledger.history.slice().reverse().map(h => ({
      when: new Date(h.time).toLocaleString(),
      type: DEDUCTION_RULES[h.type]?.label ?? h.type,
      reason: h.reason,
      name: h.name,
      skill: `${h.skillLabel} ${h.skill} → ${h.effective}`,
      roll: h.verify !== null && h.verify !== undefined ? `${h.roll} / ${h.verify}` : h.roll,
      outcome: describeOutcome(h, loc),
      css: h.outcome === "lie" ? "lie" : (h.tier ?? "fail")
    }));

    return Object.assign(context, {
      caseName: journal.name,
      tab: this.#tab,
      tabs: DeductionTracker.TAB_IDS.map(id => ({id, label: loc(`Tab.${id}`), active: id === this.#tab})),
      enemies: Object.entries(ENEMIES).map(([id, e]) => ({id, label: e.label, selected: id === ledger.enemy})),
      publicRecords: ledger.publicRecords,
      confusion: ledger.confusion,
      deadline: ledger.deadline,
      notes: ledger.notes,
      deductions,
      clueTypes: DEDUCTIONS.map(type => ({type, label: DEDUCTION_RULES[type].label})),
      weights: Object.entries(CLUE_WEIGHTS).map(([id, w]) => ({id, label: w.label})),
      clues,
      investigators,
      teamUsed,
      sources,
      history,
      clueRules: CLUE_RULES,
      clueSources: CLUE_SOURCES
    });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // Delegated once on the window, since every render replaces the fields inside it.
    this.element.addEventListener("change", event => this.#onFieldChange(event));
    this.element.addEventListener("dragover", event => {
      if ( event.target.closest(".ib-dt-team") ) event.preventDefault();
    });
    this.element.addEventListener("drop", event => this.#onDrop(event));
  }

  /* -------------------------------------------- */

  /**
   * Save a field the moment it changes. Each field names its place in the ledger in
   * `data-ledger`, e.g. `deductions.who.factors.concealment` or `investigators.0.manual.what`.
   * @param {Event} event
   */
  #onFieldChange(event) {
    const input = event.target.closest("[data-ledger]");
    const journal = this.currentCase;
    if ( !input || !journal ) return;
    const path = input.dataset.ledger;
    // Team fields name their investigator by actor, not by position, so a list that changed since
    // this render can never send the value to someone else.
    const who = input.dataset.investigator;
    let value;
    if ( input.type === "checkbox" ) value = input.checked;
    else if ( input.type === "number" ) value = input.value === "" ? null : Number(input.value);
    else value = input.value;
    updateLedger(journal, ledger => {
      if ( !who ) return void foundry.utils.setProperty(ledger, path, value);
      const inv = ledger.investigators.find(i => i.uuid === who);
      if ( inv ) foundry.utils.setProperty(inv, path, value);
    });
  }

  /**
   * Add actors dropped on the Team tab.
   * @param {DragEvent} event
   */
  async #onDrop(event) {
    if ( !event.target.closest(".ib-dt-team") ) return;
    event.preventDefault();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if ( data?.type !== "Actor" || !data.uuid ) return;
    const actor = await fromUuid(data.uuid);
    if ( actor ) await this.#addInvestigators([actor]);
  }

  /**
   * Put characters on the team, skipping any already there.
   * @param {Actor[]} actors
   */
  async #addInvestigators(actors) {
    const journal = this.currentCase;
    if ( !journal ) return;
    await updateLedger(journal, ledger => {
      for ( const actor of actors ) {
        if ( ledger.investigators.some(i => i.uuid === actor.uuid) ) continue;
        ledger.investigators.push({uuid: actor.uuid, name: actor.name, manual: {}, used: {}});
      }
    });
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** @this {DeductionTracker} */
  static async #onSelectTab(_event, target) {
    this.#tab = DeductionTracker.TAB_IDS.includes(target.dataset.tab) ? target.dataset.tab : "deductions";
    await this.render();
  }

  /** Roll one deduction for the whole team. @this {DeductionTracker} */
  static async #onRollTeam(_event, target) {
    const journal = this.currentCase;
    if ( !journal ) return;
    await rollDeductions(journal, [target.dataset.type], {
      reason: game.i18n.localize("INVESTIGATION_BOARD.DEDUCTIONS.ReasonManual")
    });
  }

  /**
   * Declare a clue that isn't on the board (an interview, a phone call) and roll for it.
   * @this {DeductionTracker}
   */
  static async #onLogFreeClue(_event, target) {
    const journal = this.currentCase;
    const form = target.closest(".ib-dt-clue-form");
    if ( !journal || !form ) return;
    const label = form.querySelector("[name=label]").value.trim();
    const types = [...form.querySelectorAll("[name=types]:checked")].map(i => i.value);
    const weight = form.querySelector("[name=weight]").value;
    const bonusRaw = form.querySelector("[name=bonus]").value;
    const roll = form.querySelector("[name=roll]").checked;
    if ( !types.length ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.DeductionsPickType", {localize: true});
      return;
    }
    await declareClue(journal, {
      label: label || game.i18n.localize("INVESTIGATION_BOARD.DEDUCTIONS.UnnamedClue"),
      types, weight, bonus: bonusRaw, roll
    });
  }

  /**
   * Take a clue back out of the ledger. A clue from the board loses its stamp too.
   * @this {DeductionTracker}
   */
  static async #onRemoveClue(_event, target) {
    const journal = this.currentCase;
    if ( !journal ) return;
    const id = target.dataset.id;
    const entry = readLedger(journal).clues.find(c => c.id === id);
    await updateLedger(journal, ledger => {
      ledger.clues = ledger.clues.filter(c => c.id !== id);
    });
    const page = entry?.clueId ? journal.pages.get(entry.clueId) : null;
    if ( page?.type === PAGE_TYPES.CLUE ) await page.update({system: {deductions: []}});
  }

  /** A critical failure while digging for clues: -1 to everything, or take one back. @this {DeductionTracker} */
  static async #onConfusion(_event, target) {
    const journal = this.currentCase;
    if ( !journal ) return;
    const step = Number(target.dataset.step) || 0;
    await updateLedger(journal, ledger => {
      ledger.confusion = Math.max(0, ledger.confusion + step);
    });
  }

  /** Add every player's assigned character. @this {DeductionTracker} */
  static async #onAddParty() {
    const actors = game.users.filter(u => !u.isGM && u.character).map(u => u.character);
    if ( !actors.length ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.DeductionsNoParty", {localize: true});
      return;
    }
    await this.#addInvestigators(actors);
  }

  /** @this {DeductionTracker} */
  static async #onRemoveInvestigator(_event, target) {
    const journal = this.currentCase;
    if ( !journal ) return;
    await updateLedger(journal, ledger => {
      ledger.investigators = ledger.investigators.filter(i => i.uuid !== target.dataset.uuid);
    });
  }

  /**
   * An investigator with Intuition rolls one deduction without a clue, once per adventure.
   * @this {DeductionTracker}
   */
  static async #onLuckyGuess(_event, target) {
    const journal = this.currentCase;
    if ( !journal ) return;
    const uuid = target.dataset.uuid;
    const type = target.closest(".ib-dt-investigator")?.querySelector("[name=luckyType]")?.value;
    if ( !DEDUCTIONS.includes(type) ) return;
    // Once per adventure, and only with Intuition (p. 6).
    const inv = readLedger(journal).investigators.find(i => i.uuid === uuid);
    if ( inv?.used.lucky ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.DeductionsLuckySpent", {localize: true});
      return;
    }
    if ( !actorHasTrait(fromUuidSync(uuid), "Intuition") ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.DeductionsLuckyNeedsIntuition", {localize: true});
      return;
    }
    await rollDeductions(journal, [type], {
      reason: game.i18n.localize("INVESTIGATION_BOARD.DEDUCTIONS.ReasonLucky"),
      only: [uuid],
      use: "lucky"
    });
  }

  /** @this {DeductionTracker} */
  static async #onAddSource(_event, target) {
    const journal = this.currentCase;
    const form = target.closest(".ib-dt-source-form");
    const label = form?.querySelector("[name=label]").value.trim();
    if ( !journal || !label ) return;
    const kind = form.querySelector("[name=kind]").value;
    await updateLedger(journal, ledger => {
      ledger.sources.push({id: foundry.utils.randomID(), label, kind, attempts: 1});
    });
  }

  /** Another go at a source, or a reset when new information puts it in a new light. @this {DeductionTracker} */
  static async #onSourceAttempt(_event, target) {
    const journal = this.currentCase;
    if ( !journal ) return;
    const step = Number(target.dataset.step);
    await updateLedger(journal, ledger => {
      const source = ledger.sources.find(s => s.id === target.dataset.id);
      if ( source ) source.attempts = step === 0 ? 0 : Math.max(0, source.attempts + step);
    });
  }

  /** @this {DeductionTracker} */
  static async #onRemoveSource(_event, target) {
    const journal = this.currentCase;
    if ( !journal ) return;
    await updateLedger(journal, ledger => {
      ledger.sources = ledger.sources.filter(s => s.id !== target.dataset.id);
    });
  }

  /** Clear confusion and once-per-adventure uses; clues and results stay. @this {DeductionTracker} */
  static async #onNewAdventure() {
    const journal = this.currentCase;
    if ( !journal ) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: {title: "INVESTIGATION_BOARD.DEDUCTIONS.NewAdventure"},
      content: `<p>${game.i18n.localize("INVESTIGATION_BOARD.DEDUCTIONS.NewAdventureConfirm")}</p>`,
      rejectClose: false
    });
    if ( ok ) await updateLedger(journal, newAdventure);
  }

  /** @this {DeductionTracker} */
  static async #onClearHistory() {
    const journal = this.currentCase;
    if ( !journal ) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: {title: "INVESTIGATION_BOARD.DEDUCTIONS.ClearHistory"},
      content: `<p>${game.i18n.localize("INVESTIGATION_BOARD.DEDUCTIONS.ClearHistoryConfirm")}</p>`,
      rejectClose: false
    });
    if ( ok ) await updateLedger(journal, ledger => { ledger.history = []; });
  }
}
