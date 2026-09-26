import {assert, check, describe} from "./harness.mjs";

/**
 * Checks the Monster Hunters deduction rules: the GURPS success roll, the deduction modifiers, skill
 * matching and the ledger's bookkeeping.
 *
 * The critical thresholds are the part most worth pinning down — they shift with skill, and a GM
 * trusts the tracker precisely so as not to have to remember them.
 */
export default async function testDeductions() {
  const {judgeRoll, parseSkillName} = await import("../scripts/rules/gurps.mjs");
  const {DEDUCTIONS, DEDUCTION_RULES, ENEMIES} = await import("../scripts/rules/monster-hunters.mjs");
  const D = await import("../scripts/data/deductions.mjs");

  describe("GURPS success rolls");

  await check("3 and 4 are always critical successes, even at skill 0", () => {
    assert(judgeRoll(0, 3).critical === "success", "3 at skill 0");
    assert(judgeRoll(0, 4).critical === "success" && judgeRoll(0, 4).success, "4 at skill 0");
  });

  await check("5 is critical at skill 15+, 6 at 16+", () => {
    assert(judgeRoll(15, 5).critical === "success", "5 at 15");
    assert(judgeRoll(14, 5).critical === null, "5 at 14 is ordinary");
    assert(judgeRoll(16, 6).critical === "success", "6 at 16");
    assert(judgeRoll(15, 6).critical === null, "6 at 15 is ordinary");
  });

  await check("18 always critically fails; 17 only at skill 15 or less", () => {
    assert(judgeRoll(25, 18).critical === "failure", "18 at 25");
    assert(judgeRoll(15, 17).critical === "failure", "17 at 15");
    const at16 = judgeRoll(16, 17);
    assert(at16.critical === null && !at16.success, "17 at 16 is an ordinary failure");
  });

  await check("failing by 10 or more is a critical failure", () => {
    assert(judgeRoll(2, 12).critical === "failure", "margin -10");
    assert(judgeRoll(3, 12).critical === null, "margin -9");
  });

  await check("margin is skill minus roll", () => {
    const r = judgeRoll(12, 9);
    assert(r.success && r.margin === 3, JSON.stringify(r));
  });

  await check("skill names split into base and specialty, dropping tech level", () => {
    const a = parseSkillName("Hidden Lore (Demons)");
    assert(a.name === "Hidden Lore" && a.spec === "Demons", JSON.stringify(a));
    const b = parseSkillName("Current Affairs/TL8 (Business)");
    assert(b.name === "Current Affairs" && b.spec === "Business", JSON.stringify(b));
    const c = parseSkillName("Computer Operation/TL8");
    assert(c.name === "Computer Operation" && c.spec === "", JSON.stringify(c));
  });

  describe("deduction reference data");

  await check("every deduction has factors, skills for every enemy and three result levels", () => {
    for ( const type of DEDUCTIONS ) {
      const rules = DEDUCTION_RULES[type];
      assert(rules.factors.length && rules.factors.every(f => f.options.length), `${type} factors`);
      for ( const enemy of Object.keys(ENEMIES) ) {
        assert(rules.skills(enemy).length > 0, `${type} has no skill against ${enemy}`);
      }
      assert(rules.results.low && rules.results.mid && rules.results.high, `${type} results`);
    }
  });

  await check("Where uses Psychology against humans and the lore skill against monsters", () => {
    const human = DEDUCTION_RULES.where.skills("witch").map(s => s.name);
    assert(human.includes("Psychology") && !human.includes("Thaumatology"), human.join());
    const monster = DEDUCTION_RULES.where.skills("vampire");
    assert(monster.some(s => (s.name === "Hidden Lore") && (s.spec === "Vampires")), "vampire lore");
  });

  await check("a parasite has no lair: Where looks for Patient Zero", () => {
    const names = DEDUCTION_RULES.where.skills("parasite").map(s => s.name);
    assert(names.includes("Biology") && names.includes("Physician"), names.join());
  });

  describe("deduction modifiers");

  await check("an empty ledger starts on the book's middle options", () => {
    const ledger = D.emptyLedger();
    assert(D.baseModifier(ledger, "who") === -8, `who ${D.baseModifier(ledger, "who")}`);
    assert(D.baseModifier(ledger, "what") === -4, `what ${D.baseModifier(ledger, "what")}`);
    assert(D.baseModifier(ledger, "where") === -8, `where ${D.baseModifier(ledger, "where")}`);
  });

  await check("factors add up with the GM's adjustment", () => {
    const ledger = D.normalizeLedger({deductions: {
      what: {factors: {caution: "fastidious", commonness: "unknown"}, adjust: -2}
    }});
    assert(D.baseModifier(ledger, "what") === -14, `got ${D.baseModifier(ledger, "what")}`);
  });

  await check("clues are cumulative and only count for their own deductions", () => {
    let ledger = D.emptyLedger();
    ledger = D.logClue(ledger, {label: "shaman", types: ["what"], weight: "normal"});
    ledger = D.logClue(ledger, {label: "news", types: ["what"], weight: "critical"});
    ledger = D.logClue(ledger, {label: "report", types: ["what", "when", "where"], weight: "major", bonus: 1});
    assert(D.clueBonus(ledger, "what") === 4, `what ${D.clueBonus(ledger, "what")}`);
    assert(D.clueBonus(ledger, "when") === 1, `when ${D.clueBonus(ledger, "when")}`);
    assert(D.clueBonus(ledger, "who") === 0, `who ${D.clueBonus(ledger, "who")}`);
  });

  await check("a minor clue allows a roll but adds nothing", () => {
    const ledger = D.logClue(D.emptyLedger(), {label: "web", types: ["who"], weight: "minor"});
    const parts = D.modifierBreakdown(ledger, "who");
    assert(parts.clues === 0 && parts.clueCount === 1, JSON.stringify(parts));
  });

  await check("confusion, a confirmed guess and a known address all feed the total", () => {
    const ledger = D.normalizeLedger({
      confusion: 2,
      deductions: {where: {guess: true, confirmed: true}}
    });
    const parts = D.modifierBreakdown(ledger, "where");
    assert(parts.total === -8 - 2 + 4 + 4, JSON.stringify(parts));
    assert(D.modifierBreakdown(D.normalizeLedger({deductions: {who: {confirmed: true}}}), "who").confirmed === 0,
      "the address bonus is Where's alone");
  });

  await check("re-declaring a board clue replaces its entry", () => {
    let ledger = D.logClue(D.emptyLedger(), {clueId: "c1", label: "x", types: ["who"], weight: "normal"});
    ledger = D.logClue(ledger, {clueId: "c1", label: "x", types: ["why"], weight: "critical"});
    assert(ledger.clues.length === 1 && ledger.clues[0].types[0] === "why", JSON.stringify(ledger.clues));
    ledger = D.logClue(ledger, {clueId: "c1", label: "x", types: [], weight: "normal"});
    assert(ledger.clues.length === 0, "no types removes it");
  });

  describe("skill matching");

  const known = D.parseSkills([
    {name: "Hidden Lore (Demons)", level: 13},
    {name: "Biology/TL8", level: 14},
    {name: "Current Affairs/TL8 (Business)", level: 11},
    {name: "Lore!", level: 12}
  ]);

  await check("the right specialty is required where the book names one", () => {
    const vampire = D.bestSkill(known.filter(s => s.name !== "Lore"),
      DEDUCTION_RULES.what.skills("vampire"));
    // No Hidden Lore (Vampires): falls back to Occultism, which this character lacks.
    assert(vampire === null, JSON.stringify(vampire));
    const demon = D.bestSkill(known.filter(s => s.name !== "Lore"), DEDUCTION_RULES.what.skills("demon"));
    assert(demon.level === 13, JSON.stringify(demon));
  });

  await check("the book's penalty for a skill is applied", () => {
    const cryptid = D.bestSkill(known.filter(s => s.name !== "Lore"), DEDUCTION_RULES.what.skills("cryptid"));
    assert(cryptid.level === 12 && cryptid.label.includes("-2"), JSON.stringify(cryptid));
  });

  await check("a wildcard skill covers the skills on its list", () => {
    const vampire = D.bestSkill(known, DEDUCTION_RULES.what.skills("vampire"));
    assert(vampire.level === 12 && vampire.label.startsWith("Lore!"), JSON.stringify(vampire));
  });

  await check("a skill named like an Object member is just a skill", () => {
    const odd = D.parseSkills([{name: "Constructor", level: 12}, {name: "toString", level: 11}]);
    assert(D.bestSkill(odd, DEDUCTION_RULES.who.skills()) === null, "matched something");
  });

  await check("a manual level wins", () => {
    const best = D.bestSkill(known, DEDUCTION_RULES.who.skills(), 7);
    assert(best.level === 7 && best.manual, JSON.stringify(best));
  });

  await check("Intelligence Analysis only counts for Who with 3+ public-records clues", () => {
    const off = D.skillsFor(D.emptyLedger(), "who").map(s => s.name);
    const on = D.skillsFor(D.normalizeLedger({publicRecords: true}), "who").map(s => s.name);
    assert(!off.includes("Intelligence Analysis") && on.includes("Intelligence Analysis"), `${off} / ${on}`);
  });

  describe("reading a GURPS Game Aid character");

  const {actorSkills, actorHasTrait} = await import("../scripts/data/deduction-ledger.mjs");

  // The shape GGA stores: keyed lists, containers nesting under `contains`, a computed `level`
  // and the `import` level as a string. A container has a name but no level of its own.
  const hunter = {
    system: {
      skills: {
        "00000": {name: "Occult", level: 0, contains: {
          "00001": {name: "Hidden Lore (Vampires)", level: 14, import: "14"},
          "00002": {name: "Occultism", level: 0, import: "12"}
        }},
        "00003": {name: "Intelligence Analysis/TL8", level: 11, import: "11"},
        "00004": {name: "Detective!", level: 13, import: "13"}
      },
      ads: {"00000": {name: "Intuition"}, "00001": {name: "Wealth (Comfortable)"}}
    },
    items: []
  };

  await check("skills are read from nested containers, falling back to the imported level", () => {
    const skills = actorSkills(hunter);
    const lore = skills.find(s => s.name === "Hidden Lore");
    assert(lore?.spec === "Vampires" && lore.level === 14, JSON.stringify(lore));
    assert(skills.find(s => s.name === "Occultism")?.level === 12, "import level not used");
    assert(!skills.some(s => s.name === "Occult"), "a container was read as a skill");
  });

  await check("a wildcard on the sheet rolls the deductions it covers", () => {
    const why = D.bestSkill(actorSkills(hunter), D.skillsFor(D.emptyLedger(), "why"));
    assert(why.level === 13 && why.label.startsWith("Detective!"), JSON.stringify(why));
  });

  await check("advantages are found by name, ignoring their level", () => {
    assert(actorHasTrait(hunter, "Intuition"), "Intuition not found");
    assert(!actorHasTrait(hunter, "Serendipity"), "found an advantage that is not there");
    assert(actorSkills(null).length === 0, "a missing actor should have no skills");
  });

  describe("resolving a deduction");

  await check("success levels: 0-2, 3-4, 5+ or critical", () => {
    assert(D.resolveDeduction({skill: 14, modifier: -4, roll: 9}).tier === "low", "by 1");
    assert(D.resolveDeduction({skill: 14, modifier: -4, roll: 7}).tier === "mid", "by 3");
    assert(D.resolveDeduction({skill: 14, modifier: -4, roll: 5}).tier === "high", "by 5");
    assert(D.resolveDeduction({skill: 4, modifier: -6, roll: 4}).tier === "high", "critical at -2");
  });

  await check("a critical failure asks for a verification roll against the unmodified skill", () => {
    const honest = D.resolveDeduction({skill: 13, modifier: -8, roll: 18, verify: 12});
    assert(honest.needsVerify && honest.outcome === "failure", JSON.stringify(honest));
    const lie = D.resolveDeduction({skill: 13, modifier: -8, roll: 18, verify: 14});
    assert(lie.outcome === "lie", JSON.stringify(lie));
  });

  await check("the best result is kept, and a worse one does not replace it", () => {
    let ledger = D.emptyLedger();
    ledger = D.recordRoll(ledger, {type: "what", name: "A", tier: "mid", margin: 3, time: 1});
    ledger = D.recordRoll(ledger, {type: "what", name: "B", tier: "low", margin: 1, time: 2});
    ledger = D.recordRoll(ledger, {type: "what", name: "C", tier: null, margin: -4, time: 3});
    assert(ledger.deductions.what.best.name === "A" && ledger.history.length === 3,
      JSON.stringify(ledger.deductions.what.best));
  });

  describe("sources and adventures");

  await check("a repeat costs -4 per attempt, -2 at a library", () => {
    assert(D.deadHorsePenalty({kind: "standard", attempts: 2}) === -8, "standard");
    assert(D.deadHorsePenalty({kind: "library", attempts: 2}) === -4, "library");
  });

  await check("a new adventure clears confusion and once-per-adventure uses, not clues", () => {
    let ledger = D.normalizeLedger({
      confusion: 3,
      investigators: [{uuid: "Actor.a", name: "A", used: {lucky: true}}],
      teamUsed: {meditation: true, program: true}
    });
    ledger = D.logClue(ledger, {label: "x", types: ["who"], weight: "normal"});
    const next = D.newAdventure(ledger);
    assert(next.confusion === 0 && !next.investigators[0].used.lucky && next.clues.length === 1,
      JSON.stringify(next));
    assert(!next.teamUsed.meditation && !next.teamUsed.program, "team-wide uses were not cleared");
  });

  // Meditation and the search program are one per adventure for the whole team (p. 7).
  await check("meditation and the search program belong to the team, Lucky Guess to each hunter", () => {
    assert(D.ONCE_PER_ADVENTURE.join() === "lucky", D.ONCE_PER_ADVENTURE.join());
    assert(D.TEAM_ONCE_PER_ADVENTURE.join() === "meditation,program", D.TEAM_ONCE_PER_ADVENTURE.join());
    const ledger = D.normalizeLedger({teamUsed: {meditation: true}});
    assert(ledger.teamUsed.meditation && !ledger.teamUsed.program, JSON.stringify(ledger.teamUsed));
  });

  await check("a clue with no bonus recorded falls back to its weight, not to zero", () => {
    const ledger = D.normalizeLedger({clues: [{label: "x", types: ["who"], weight: "normal", bonus: null}]});
    assert(ledger.clues[0].bonus === 1, `bonus was ${ledger.clues[0].bonus}`);
  });

  describe("ledger transfer");

  await check("clue references survive an export and import by index", () => {
    let ledger = D.logClue(D.emptyLedger(), {clueId: "old2", label: "x", types: ["who"], weight: "normal"});
    ledger = D.logClue(ledger, {label: "free", types: ["why"], weight: "minor"});
    ledger.investigators = [{uuid: "Actor.x", name: "X", manual: {}, used: {}}];
    const portable = D.portableLedger(ledger, new Map([["old1", 0], ["old2", 1]]));
    assert(portable.investigators.length === 0, "investigators are world-specific");
    const restored = D.restoreLedger(JSON.parse(JSON.stringify(portable)), ["new1", "new2"]);
    assert(restored.clues[0].clueId === "new2" && restored.clues[1].clueId === null,
      JSON.stringify(restored.clues));
  });
}
