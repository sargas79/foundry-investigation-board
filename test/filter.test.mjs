import {assert, check, describe} from "./harness.mjs";

const CLUE = "investigation-board.clue";
const CONN = "investigation-board.connection";

/** A stand-in clue page. */
function clue(id, name, system = {}, lastModifiedBy = "u1") {
  return {
    id, name, type: CLUE, visible: true,
    _stats: {lastModifiedBy},
    system: {
      category: "other", reliability: "unverified", body: "", dismissed: false, ...system
    }
  };
}

/** A stand-in connection page. */
function connection(id, from, to) {
  return {
    id, type: CONN, visible: true,
    system: {from, to, touches(c) { return (this.from === c) || (this.to === c); }}
  };
}

/** A stand-in case holding the given pages. */
function journalOf(pages) {
  return {pages: {filter: fn => pages.filter(fn), get: id => pages.find(p => p.id === id)}};
}

/**
 * Checks for the board filter. The rule that matters is that filtering *dims* rather than hides —
 * these cover which clues and strings are counted as matching, which is what drives the dimming.
 */
export default async function testFilter() {
  const {EMPTY_FILTER, isActive, matches, applyFilter} =
    await import("../scripts/board/filter.mjs");

  describe("isActive");

  await check("an empty filter excludes nothing", () => {
    assert(isActive(EMPTY_FILTER) === false, "the empty filter was treated as active");
    assert(isActive({}) === false, "an absent filter was treated as active");
    assert(isActive({text: "   "}) === false, "whitespace should not count as a filter");
    assert(isActive({text: "watch"}) === true, "a search term should count");
    assert(isActive({category: "person"}) === true, "a category should count");
  });

  describe("matches");

  const watch = clue("a", "Broken Watch",
    {category: "physical", reliability: "verified", body: "<p>Stopped at <b>2:14</b>.</p>"}, "sam");

  await check("matches on name, case-insensitively", () => {
    assert(matches(watch, {text: "broken"}), "should match its name");
    assert(matches(watch, {text: "WATCH"}), "should ignore case");
    assert(!matches(watch, {text: "ledger"}), "should not match an absent word");
  });

  // Bodies are stored as HTML, so a naive search would match tag names and miss words split by
  // markup — searching for "2:14" must not be defeated by the <b> around it.
  await check("searches the body with its markup stripped", () => {
    assert(matches(watch, {text: "stopped"}), "should match body text");
    assert(matches(watch, {text: "2:14"}), "should match text wrapped in a tag");
    assert(!matches(watch, {text: "p>"}), "should not match the markup itself");
  });

  await check("filters by category, reliability and author", () => {
    assert(matches(watch, {category: "physical"}), "category should match");
    assert(!matches(watch, {category: "person"}), "the wrong category should not match");
    assert(matches(watch, {reliability: "verified"}), "reliability should match");
    assert(!matches(watch, {reliability: "debunked"}), "the wrong reliability should not match");
    assert(matches(watch, {author: "sam"}), "author should match");
    assert(!matches(watch, {author: "alex"}), "the wrong author should not match");
  });

  await check("combines terms, requiring all of them", () => {
    assert(matches(watch, {text: "watch", category: "physical"}), "both terms hold");
    assert(!matches(watch, {text: "watch", category: "person"}), "one term fails, so should not match");
  });

  describe("applyFilter");

  const pages = [
    clue("a", "Broken Watch", {category: "physical", reliability: "verified"}, "sam"),
    clue("b", "Mara Vale", {category: "person", reliability: "verified"}, "sam"),
    clue("c", "Ashwood Lane", {category: "location", reliability: "unverified"}, "alex"),
    clue("z", "Discarded", {category: "lead", dismissed: true}, "sam"),
    connection("s1", "a", "b"),
    connection("s2", "b", "c"),
    connection("s3", "a", "z")
  ];
  const journal = journalOf(pages);

  await check("counts only clues on the board", () => {
    const result = applyFilter(journal, EMPTY_FILTER);
    assert(result.total === 3, `total was ${result.total}, dismissed clues should not count`);
    assert(result.clues.size === 3, `${result.clues.size} clues matched an empty filter`);
  });

  // A string to something filtered out is a line to nowhere, so both ends must match.
  await check("keeps a string only when both its clues match", () => {
    const result = applyFilter(journal, {reliability: "verified"});
    assert(result.clues.has("a") && result.clues.has("b"), "both verified clues should match");
    assert(!result.clues.has("c"), "the unverified clue should not match");
    assert(result.connections.has("s1"), "the string between two matches should stay");
    assert(!result.connections.has("s2"), "a string to a filtered-out clue should dim");
  });

  await check("never keeps a string attached to a dismissed clue", () => {
    const result = applyFilter(journal, EMPTY_FILTER);
    assert(!result.connections.has("s3"), "a string to a dismissed clue was kept");
  });

  await check("a filter matching nothing leaves nothing bright", () => {
    const result = applyFilter(journal, {text: "nothing here matches this"});
    assert(result.clues.size === 0, `${result.clues.size} clues matched`);
    assert(result.connections.size === 0, `${result.connections.size} strings matched`);
    assert(result.total === 3, "the total should still report the whole board");
  });
}
