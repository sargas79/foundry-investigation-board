import fs from "node:fs";
import path from "node:path";
import {assert, check, describe} from "./harness.mjs";

const ROOT = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Every file under a directory matching an extension. */
function walk(dir, extension, found = []) {
  if ( !fs.existsSync(dir) ) return found;
  for ( const entry of fs.readdirSync(dir, {withFileTypes: true}) ) {
    const full = path.join(dir, entry.name);
    if ( entry.isDirectory() ) walk(full, extension, found);
    else if ( entry.name.endsWith(extension) ) found.push(full);
  }
  return found;
}

/**
 * Checks that every user-facing string is translatable and actually defined.
 *
 * A missing key shows the raw `INVESTIGATION_BOARD.Something` to the player rather than failing
 * loudly, so nothing else would catch it.
 */
export default async function testI18n() {
  const strings = JSON.parse(fs.readFileSync(path.join(ROOT, "lang/en.json"), "utf8"));
  const keys = new Set(Object.keys(strings));

  const sources = [
    ...walk(path.join(ROOT, "scripts"), ".mjs"),
    ...walk(path.join(ROOT, "templates"), ".hbs")
  ];
  const corpus = sources.map(f => ({file: path.relative(ROOT, f), text: fs.readFileSync(f, "utf8")}));

  describe("localization");

  await check("every key referenced in code or templates exists", () => {
    const missing = new Set();
    for ( const {file, text} of corpus ) {
      for ( const match of text.matchAll(/["'`](INVESTIGATION_BOARD\.[A-Za-z0-9_.]+)["'`]/g) ) {
        if ( !keys.has(match[1]) ) missing.add(`${match[1]} (${file})`);
      }
      // Handlebars: {{localize "KEY"}} is caught above; data-tooltip="KEY" is not quoted the same.
      for ( const match of text.matchAll(/data-tooltip="(INVESTIGATION_BOARD\.[A-Za-z0-9_.]+)"/g) ) {
        if ( !keys.has(match[1]) ) missing.add(`${match[1]} (${file})`);
      }
    }
    assert(missing.size === 0, `undefined keys:\n        ${[...missing].join("\n        ")}`);
  });

  await check("the sub-type labels Foundry needs are present", () => {
    for ( const type of ["clue", "connection"] ) {
      const key = `TYPES.JournalEntryPage.investigation-board.${type}`;
      assert(key in strings, `missing ${key}`);
    }
  });

  await check("no key is defined twice", () => {
    const raw = fs.readFileSync(path.join(ROOT, "lang/en.json"), "utf8");
    const seen = new Set();
    const duplicates = [];
    for ( const match of raw.matchAll(/^\s*"([^"]+)":/gm) ) {
      if ( seen.has(match[1]) ) duplicates.push(match[1]);
      seen.add(match[1]);
    }
    assert(duplicates.length === 0, `duplicated: ${duplicates.join(", ")}`);
  });

  await check("no string is left empty", () => {
    const empty = Object.entries(strings).filter(([, v]) => !String(v).trim()).map(([k]) => k);
    assert(empty.length === 0, `empty: ${empty.join(", ")}`);
  });

  // A format string whose placeholder is never supplied renders as literal braces to the player.
  await check("every placeholder is a plain named token", () => {
    const bad = [];
    for ( const [key, value] of Object.entries(strings) ) {
      for ( const match of String(value).matchAll(/\{([^}]*)\}/g) ) {
        if ( !/^[a-zA-Z][a-zA-Z0-9]*$/.test(match[1]) ) bad.push(`${key}: {${match[1]}}`);
      }
    }
    assert(bad.length === 0, `odd placeholders: ${bad.join(", ")}`);
  });

  describe("hard-coded text");

  // Catches user-facing English reaching a notification or dialog title without going through
  // localization, which is the easiest way for a string to escape translation.
  await check("notifications are localized rather than hard-coded", () => {
    const offenders = [];
    for ( const {file, text} of corpus ) {
      if ( !file.startsWith("scripts") ) continue;
      for ( const match of text.matchAll(/ui\.notifications\.\w+\(\s*(["'`])((?:(?!\1).)*)\1/g) ) {
        const literal = match[2];
        if ( !literal.startsWith("INVESTIGATION_BOARD.") ) offenders.push(`${file}: "${literal}"`);
      }
    }
    assert(offenders.length === 0, `hard-coded:\n        ${offenders.join("\n        ")}`);
  });
}
