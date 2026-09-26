import {DEDUCTION_RULES, ENEMIES} from "../rules/monster-hunters.mjs";
import {
  bestSkill,
  logClue,
  modifierBreakdown,
  recordRoll,
  resolveDeduction,
  signed,
  skillsFor
} from "./deductions.mjs";
import {actorSkills, readLedger, updateLedger} from "./deduction-ledger.mjs";

/**
 * Making deduction rolls and telling the GM what came of them.
 *
 * The rules are explicit that these rolls are secret (p. 9): the players must not learn the skills,
 * the penalties or even that a roll failed, and on a bad enough failure the GM is meant to lie. So
 * the dice are rolled here rather than in chat, and the result goes to the GMs as a whisper.
 */

/**
 * Roll one or more deductions for the team, record them and whisper the results to the GMs.
 *
 * @param {JournalEntry} journal
 * @param {string[]} types                 Which deductions to roll.
 * @param {object} [options]
 * @param {string} [options.reason]        Why the roll was made, for the card ("New clue: …").
 * @param {string[]} [options.only]        Roll only for these investigators (actor uuids).
 * @param {string} [options.use]           Mark this once-per-adventure use spent for them.
 * @returns {Promise<object[]>}            The history entries written.
 */
export async function rollDeductions(journal, types, {reason = "", only = null, use = null} = {}) {
  if ( !game.user.isGM || !types.length ) return [];
  const ledger = readLedger(journal);
  const team = ledger.investigators.filter(inv => !only || only.includes(inv.uuid));
  if ( !team.length ) {
    ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.DeductionsNoTeam", {localize: true});
    return [];
  }

  const entries = [];
  const sections = [];
  for ( const type of types ) {
    const parts = modifierBreakdown(ledger, type);
    const allowed = skillsFor(ledger, type);
    const rows = [];
    for ( const inv of team ) {
      const actor = fromUuidSync(inv.uuid);
      const name = actor?.name ?? inv.name;
      const skill = bestSkill(actorSkills(actor), allowed, inv.manual[type]);
      if ( !skill ) {
        rows.push({name, missing: true});
        continue;
      }
      const main = await new Roll("3d6").evaluate();
      let verify;
      if ( resolveDeduction({skill: skill.level, modifier: parts.total, roll: main.total}).needsVerify ) {
        verify = (await new Roll("3d6").evaluate()).total;
      }
      const result = resolveDeduction({skill: skill.level, modifier: parts.total, roll: main.total, verify});
      const entry = {
        id: foundry.utils.randomID(),
        time: Date.now(),
        type,
        reason,
        name,
        actorUuid: inv.uuid,
        skillLabel: skill.manual ? game.i18n.localize("INVESTIGATION_BOARD.DEDUCTIONS.ManualSkill") : skill.label,
        skill: skill.level,
        modifier: parts.total,
        effective: result.effective,
        roll: main.total,
        margin: result.main.margin,
        critical: result.main.critical,
        verify: result.verification?.total ?? null,
        outcome: result.outcome,
        tier: result.tier
      };
      entries.push(entry);
      rows.push({...entry, lucky: use === "lucky"});
    }
    sections.push({type, parts, rows});
  }

  const before = ledger.deductions.what.best?.tier;
  await updateLedger(journal, current => {
    let next = entries.reduce(recordRoll, current);
    if ( use ) {
      for ( const inv of next.investigators ) {
        if ( !only || only.includes(inv.uuid) ) inv.used[use] = true;
      }
    }
    // What by 5+ against a foe with no true name to learn hands out a free +2 clue (p. 10). The GM
    // decides whether the true name applies; the clue is logged so it can be removed if not.
    const whatHigh = entries.some(e => (e.type === "what") && (e.tier === "high"));
    if ( whatHigh && (before !== "high") ) {
      const human = ENEMIES[next.enemy]?.human;
      next = logClue(next, {
        label: game.i18n.localize(human
          ? "INVESTIGATION_BOARD.DEDUCTIONS.FreeWhoClue"
          : "INVESTIGATION_BOARD.DEDUCTIONS.FreeWhyClue"),
        types: [human ? "who" : "why"],
        weight: "major",
        bonus: 2
      });
    }
    return next;
  });

  await postCard(journal, sections, reason);
  return entries;
}

/* -------------------------------------------- */

/**
 * The whisper to the GMs: who rolled what, and what it means.
 * @param {JournalEntry} journal
 * @param {object[]} sections
 * @param {string} reason
 */
async function postCard(journal, sections, reason) {
  const esc = foundry.utils.escapeHTML;
  const loc = key => game.i18n.localize(`INVESTIGATION_BOARD.DEDUCTIONS.${key}`);
  const html = [`<div class="ib-deduction-card">`,
    `<header><strong>${esc(journal.name)}</strong>${reason ? `<span>${esc(reason)}</span>` : ""}</header>`];

  for ( const {type, parts, rows} of sections ) {
    const rules = DEDUCTION_RULES[type];
    html.push(`<h4>${esc(rules.label)} <span class="ib-dc-mod">${signed(parts.total)}</span></h4>`);
    html.push("<ul>");
    let bestTier = null;
    for ( const row of rows ) {
      if ( row.missing ) {
        html.push(`<li class="ib-dc-missing">${esc(row.name)}: ${loc("NoSkill")}</li>`);
        continue;
      }
      const outcome = describeOutcome(row, loc);
      if ( row.tier && (!bestTier || (["low", "mid", "high"].indexOf(row.tier) > ["low", "mid", "high"].indexOf(bestTier))) ) {
        bestTier = row.tier;
      }
      html.push(`<li class="ib-dc-${row.outcome}${row.tier ? ` ib-dc-${row.tier}` : ""}">`
        + `<span class="ib-dc-who">${esc(row.name)}</span>`
        + `<span class="ib-dc-skill">${esc(row.skillLabel)} ${row.skill} → ${row.effective}</span>`
        + `<span class="ib-dc-roll">${row.roll}${row.verify !== null ? ` / ${row.verify}` : ""}</span>`
        + `<span class="ib-dc-outcome">${outcome}</span></li>`);
    }
    html.push("</ul>");
    if ( bestTier ) html.push(`<p class="ib-dc-reveal">${esc(rules.results[bestTier])}</p>`);
    else if ( rows.some(r => r.outcome === "lie") ) html.push(`<p class="ib-dc-reveal ib-dc-lie">${loc("LieHint")}</p>`);
    else html.push(`<p class="ib-dc-reveal">${loc("NothingLearned")}</p>`);
  }
  html.push("</div>");

  await ChatMessage.create({
    speaker: {alias: game.i18n.localize("INVESTIGATION_BOARD.DEDUCTIONS.Title")},
    content: html.join(""),
    whisper: game.users.filter(u => u.isGM).map(u => u.id)
  });
}

/**
 * One investigator's result in words.
 * @param {object} row
 * @param {(key: string) => string} loc
 * @returns {string}
 */
export function describeOutcome(row, loc) {
  const margin = signed(row.margin);
  if ( row.outcome === "lie" ) return `${loc("CriticalFailure")} — ${loc("Lie")}`;
  if ( row.critical === "failure" ) return `${loc("CriticalFailure")} — ${loc("Verified")}`;
  if ( row.critical === "success" ) return `${loc("CriticalSuccess")} — ${loc(`Tier.${row.tier}`)}`;
  if ( row.tier ) return `${loc("SuccessBy")} ${margin} — ${loc(`Tier.${row.tier}`)}`;
  return `${loc("FailureBy")} ${margin}`;
}
