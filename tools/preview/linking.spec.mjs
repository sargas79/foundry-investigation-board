/**
 * In-page checks for linking clues and cutting strings.
 *
 *   node tools/preview-server.mjs   →   open /tools/preview/case.html   →   runLinkingTests()
 *
 * The page records every link the controller asks for and every page it deletes, so these assert
 * on the documents a gesture would write rather than only on what appears on screen.
 */
export async function runLinkingTests({interactions, journal, view, viewport, caseApi}) {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push({name, ok: true}); }
    catch (err) { results.push({name, ok: false, error: err.message}); }
  };
  const assert = (cond, msg) => { if ( !cond ) throw new Error(msg); };
  const settle = (ms = 70) => new Promise(r => setTimeout(r, ms));

  const cardEl = id => document.querySelector(`.ib-clue[data-clue-id="${id}"]`);
  const centreOf = id => {
    const r = cardEl(id).getBoundingClientRect();
    return {x: r.left + (r.width / 2), y: r.top + (r.height / 2)};
  };
  const pointer = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, {
    pointerId: 71, isPrimary: true, bubbles: true, cancelable: true, button: 0,
    buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y
  }));
  const strings = () => [...document.querySelectorAll(".ib-string")].map(e => e.dataset.connectionId);
  const attempts = () => window.__linkAttempts;
  const deleted = () => window.__deleted;

  /**
   * Find a point on some string that no card is covering, so a click there really lands on it.
   *
   * Whether any given string is exposed depends on how the board happens to be laid out and how
   * big the pane is, so this frames the whole case first and, failing that, zooms out — otherwise
   * the check passes or fails on the window size rather than on the behaviour it is testing.
   */
  const findClickableString = () => {
    const attempt = () => {
      const world = document.querySelector(".ib-board-world").getBoundingClientRect();
      const scale = view.transform.scale;
      for ( const group of document.querySelectorAll(".ib-string") ) {
        const hit = group.querySelector(".ib-string-hit");
        const length = hit.getTotalLength();
        if ( !length ) continue;
        for ( let u = 0.06; u <= 0.94; u += 0.01 ) {
          const p = hit.getPointAtLength(length * u);
          const x = world.left + (p.x * scale);
          const y = world.top + (p.y * scale);
          if ( document.elementFromPoint(x, y) === hit ) {
            return {id: group.dataset.connectionId, el: hit, x, y};
          }
        }
      }
      return null;
    };

    const bounds = caseApi.clueBounds(caseApi.getClues(journal));
    for ( const prepare of [
      () => view.reset(),
      () => { if ( bounds ) view.fit(bounds); },
      () => { if ( bounds ) view.fit(bounds); view.zoomBy(0.75); },
      () => { view.reset(); view.zoomBy(0.5); }
    ] ) {
      prepare();
      const found = attempt();
      if ( found ) return found;
    }
    return null;
  };

  // With the pane collapsed the page has no layout at all, every elementFromPoint answers null,
  // and the hit-testing checks below fail for a reason that has nothing to do with the board.
  if ( !window.innerHeight || !viewport.getBoundingClientRect().height ) {
    return {
      passed: 0,
      failed: 1,
      results: [{
        name: "preconditions",
        error: "the preview pane has no layout — open or widen it and run again"
      }]
    };
  }

  view.reset();
  await settle(50);

  /* --- Making a string --------------------------------------------------- */

  await check("the tool ties two clues together on two clicks", async () => {
    window.__linkAttempts = [];
    interactions.setLinkMode(true);
    assert(interactions.linkMode, "the tool did not turn on");

    const a = centreOf("a");
    pointer(cardEl("a"), "pointerdown", a.x, a.y);
    pointer(viewport, "pointerup", a.x, a.y);
    assert(interactions.isLinking, "no string was started");
    assert(!!document.querySelector(".ib-string-pending"), "no string was drawn to follow the pointer");

    const c = centreOf("c");
    pointer(cardEl("c"), "pointerdown", c.x, c.y);
    pointer(viewport, "pointerup", c.x, c.y);
    await settle();

    assert(!interactions.isLinking, "still linking after the second click");
    assert(!document.querySelector(".ib-string-pending"), "the pending string was left behind");
    const last = attempts().at(-1);
    assert(last?.fromId === "a" && last?.toId === "c" && last.ok,
      `attempt was ${JSON.stringify(last)}`);
    interactions.setLinkMode(false);
  });

  await check("the pending string follows the pointer, and Escape abandons it", async () => {
    interactions.setLinkMode(true);
    const a = centreOf("a");
    pointer(cardEl("a"), "pointerdown", a.x, a.y);
    pointer(viewport, "pointerup", a.x, a.y);
    const before = document.querySelector(".ib-string-pending").getAttribute("d");
    pointer(viewport, "pointermove", a.x + 220, a.y + 160);
    const after = document.querySelector(".ib-string-pending").getAttribute("d");
    assert(before !== after, "the pending string did not follow the pointer");

    viewport.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
    await settle(30);
    assert(!interactions.isLinking, "Escape did not abandon the string");
    assert(!document.querySelector(".ib-string-pending"), "the pending string survived Escape");
    // The first Escape only drops the half-drawn string; the tool is still on for another go.
    assert(interactions.linkMode, "Escape should not also switch the tool off");
    interactions.setLinkMode(false);
  });

  // The shortcut: no tool, just drag from the pin to the other clue.
  await check("dragging from a pin links without the tool", async () => {
    window.__linkAttempts = [];
    const pin = cardEl("b").querySelector(".ib-pin");
    const pr = pin.getBoundingClientRect();
    pointer(pin, "pointerdown", pr.left + (pr.width / 2), pr.top + (pr.height / 2));
    assert(interactions.isLinking, "the pin drag did not start a string");

    const e = centreOf("e");
    pointer(viewport, "pointermove", e.x, e.y);
    pointer(viewport, "pointerup", e.x, e.y);
    await settle();

    const last = attempts().at(-1);
    assert(last?.fromId === "b" && last?.toId === "e", `attempt was ${JSON.stringify(last)}`);
    assert(!interactions.linkMode, "the shortcut should not leave the tool switched on");
  });

  await check("releasing a pin drag over bare cork abandons the string", async () => {
    window.__linkAttempts = [];
    const pin = cardEl("a").querySelector(".ib-pin");
    const pr = pin.getBoundingClientRect();
    const r = viewport.getBoundingClientRect();
    pointer(pin, "pointerdown", pr.left + (pr.width / 2), pr.top + (pr.height / 2));
    pointer(viewport, "pointermove", r.left + 12, r.bottom - 12);
    pointer(viewport, "pointerup", r.left + 12, r.bottom - 12);
    await settle();
    assert(attempts().length === 0, "a string was made from a drop on bare cork");
    assert(!interactions.isLinking, "the gesture did not end");
  });

  await check("a clue cannot be strung to itself", () => {
    const check = caseApi.canConnect(journal, "a", "a");
    assert(check.ok === false, "a self-link was allowed");
    assert(check.reason.includes("LinkToSelf"), `reason was ${check.reason}`);
  });

  // A string has no direction, so the same pair must be refused whichever way round it is drawn.
  await check("the same pair cannot be strung twice, in either direction", () => {
    const existing = caseApi.getConnections(journal)[0];
    const {from, to} = existing.system;
    assert(caseApi.canConnect(journal, from, to).ok === false, "the same pair was allowed again");
    assert(caseApi.canConnect(journal, to, from).ok === false, "the reversed pair was allowed");
  });

  /* --- Cutting a string --------------------------------------------------- */

  await check("clicking a string selects it, and clears any clue selection", async () => {
    interactions.select("a");
    const target = findClickableString();
    assert(!!target, "no string had a point a card was not covering");
    pointer(target.el, "pointerdown", target.x, target.y);
    pointer(viewport, "pointerup", target.x, target.y);
    assert(interactions.selectedString === target.id,
      `selected ${interactions.selectedString}, expected ${target.id}`);
    assert(interactions.selected === null, "the clue stayed selected too");
    assert(document.querySelector(".ib-string.selected")?.dataset.connectionId === target.id,
      "the string was not marked selected");
  });

  // Unlinking is not destructive: the clues at either end must survive.
  await check("Delete cuts the selected string and leaves both clues", async () => {
    window.__deleted = [];
    const target = strings()[0];
    const connection = journal.pages.get(target);
    const {from, to} = connection.system;
    const before = strings().length;

    interactions.selectString(target);
    viewport.dispatchEvent(new KeyboardEvent("keydown", {key: "Delete", bubbles: true, cancelable: true}));
    await settle(90);

    assert(deleted().includes(target), `deleted ${JSON.stringify(deleted())}`);
    assert(!strings().includes(target), "the string is still drawn");
    assert(strings().length === (before - 1), `expected ${before - 1} strings, got ${strings().length}`);
    assert(!!journal.pages.get(from) && !!journal.pages.get(to), "cutting a string destroyed a clue");
  });

  await check("right-clicking a string offers to cut it", async () => {
    const target = findClickableString();
    assert(!!target, "no string was exposed to right-click");
    target.el.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: target.x, clientY: target.y
    }));
    await settle(40);
    const menu = document.querySelector(".ib-card-menu");
    assert(!!menu, "no menu appeared");
    assert(menu.querySelectorAll("button").length === 1,
      `a string menu should offer one action, got ${menu.querySelectorAll("button").length}`);

    window.__deleted = [];
    menu.querySelector("button").click();
    await settle(90);
    assert(deleted().includes(target.id), `cutting did not delete it: ${JSON.stringify(deleted())}`);
  });

  await check("Escape clears a string selection", async () => {
    const target = strings()[0];
    interactions.selectString(target);
    viewport.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
    await settle(30);
    assert(interactions.selectedString === null, "the string is still selected");
  });

  const failed = results.filter(r => !r.ok);
  return {
    passed: results.length - failed.length,
    failed: failed.length,
    results: failed.length ? failed : results.map(r => r.name)
  };
}
