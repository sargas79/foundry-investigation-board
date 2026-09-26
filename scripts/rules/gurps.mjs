/**
 * GURPS success-roll arithmetic (Basic Set, pp. B347–B348).
 *
 * Pure functions over numbers: the dice are rolled by the caller, so everything here can be tested
 * without Foundry and a roll can be replayed exactly from its history entry.
 */

/**
 * Judge a 3d6 roll against an effective skill.
 *
 * - Critical success: 3 or 4 always; 5 at effective skill 15+; 6 at 16+.
 * - Critical failure: 18 always; 17 at effective skill 15 or less; any failure by 10 or more.
 * - Otherwise a roll of 17 or 18 still fails, whatever the skill.
 *
 * @param {number} skill   Effective skill, after every modifier.
 * @param {number} total   The 3d6 total.
 * @returns {{total: number, skill: number, margin: number, success: boolean,
 *            critical: "success"|"failure"|null}}
 */
export function judgeRoll(skill, total) {
  const margin = skill - total;
  let critical = null;
  if ( (total <= 4) || ((total === 5) && (skill >= 15)) || ((total === 6) && (skill >= 16)) ) {
    critical = "success";
  }
  else if ( (total === 18) || ((total === 17) && (skill <= 15)) || (margin <= -10) ) {
    critical = "failure";
  }

  let success;
  if ( critical ) success = critical === "success";
  else if ( total >= 17 ) success = false;
  else success = margin >= 0;

  return {total, skill, margin, success, critical};
}

/* -------------------------------------------- */

/**
 * Parse a skill name as GURPS writes it: `Hidden Lore (Demons)`, `Current Affairs/TL8 (Business)`.
 * @param {string} raw
 * @returns {{name: string, spec: string}}
 */
export function parseSkillName(raw) {
  const text = String(raw ?? "").trim();
  const match = text.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  const base = (match ? match[1] : text).replace(/\/TL\s*\d+\S*$/i, "").trim();
  return {name: base, spec: match ? match[2].trim() : ""};
}

/* -------------------------------------------- */

/**
 * Normalise a skill or specialty name for comparison: case, trailing "!" of wildcard skills, and
 * spacing are not significant.
 * @param {string} text
 * @returns {string}
 */
export function skillKey(text) {
  return String(text ?? "").toLowerCase().replace(/!+$/, "").replace(/\s+/g, " ").trim();
}
