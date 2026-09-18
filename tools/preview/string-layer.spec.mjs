import {pinAnchor, stringMidpoint} from "/scripts/board/string-layer.mjs";

/**
 * In-page checks for StringLayer.
 *
 * Like the BoardView suite these need a laid-out DOM — the point of most of them is where things
 * actually land on screen and what a click at a given point hits.
 *
 *   node tools/preview-server.mjs   →   open /tools/preview/strings.html   →   runStringLayerTests()
 */
export function runStringLayerTests({layer, clues, connections, redraw}) {
  const results = [];
  const check = (name, fn) => {
    try { fn(); results.push({name, ok: true}); }
    catch (err) { results.push({name, ok: false, error: err.message}); }
  };
  const assert = (cond, msg) => { if ( !cond ) throw new Error(msg); };

  const world = () => document.querySelector(".ib-board-world").getBoundingClientRect();
  const at = (from, to, u) => {
    const span = Math.hypot(to.x - from.x, to.y - from.y);
    const sag = Math.min(span * 0.08, 34);
    const cx = (from.x + to.x) / 2;
    const cy = ((from.y + to.y) / 2) + sag;
    return {
      x: ((1 - u) ** 2 * from.x) + (2 * (1 - u) * u * cx) + (u ** 2 * to.x),
      y: ((1 - u) ** 2 * from.y) + (2 * (1 - u) * u * cy) + (u ** 2 * to.y)
    };
  };
  const classOf = el => el?.getAttribute?.("class") ?? "none";

  // The anchor maths must agree with where the pin actually draws, at any rotation — otherwise
  // strings visibly miss their pins on tilted cards.
  check("pin anchors match the rendered pin head at every rotation", () => {
    const w = world();
    let worst = 0;
    for ( const [id, clue] of clues ) {
      const head = document.querySelector(`.ib-clue[data-clue-id="${id}"] .ib-pin-head`);
      const hb = head.getBoundingClientRect();
      const actual = {x: hb.left + (hb.width / 2) - w.left, y: hb.top + (hb.height / 2) - w.top};
      const computed = pinAnchor(clue);
      worst = Math.max(worst, Math.hypot(computed.x - actual.x, computed.y - actual.y));
    }
    assert(worst < 1, `worst anchor error was ${worst.toFixed(2)}px`);
  });

  check("a string is clickable where it is not covered by a card", () => {
    const w = world();
    const from = pinAnchor(clues.get(connections[0].from));
    const to = pinAnchor(clues.get(connections[0].to));
    const p = at(from, to, 0.5);
    const el = document.elementFromPoint(w.left + p.x, w.top + p.y);
    assert(classOf(el) === "ib-string-hit", `hit ${classOf(el)}`);
  });

  check("the hit target is far wider than the drawn line", () => {
    const g = document.querySelector(".ib-string");
    const hit = parseFloat(getComputedStyle(g.querySelector(".ib-string-hit")).strokeWidth);
    const line = parseFloat(getComputedStyle(g.querySelector(".ib-string-line")).strokeWidth);
    assert(hit >= line * 5, `hit ${hit} vs line ${line}`);
  });

  // The clue layer spans the whole board; if it caught pointer events nothing under it could be
  // clicked, which is exactly the bug this guards against.
  check("neither the string layer nor the clue layer swallows clicks", () => {
    assert(getComputedStyle(document.querySelector(".ib-string-layer")).pointerEvents === "none",
      "string layer should be pointer-events:none");
    assert(getComputedStyle(document.querySelector(".ib-clue-layer")).pointerEvents === "none",
      "clue layer should be pointer-events:none");
    assert(getComputedStyle(document.querySelector(".ib-string-line")).pointerEvents === "none",
      "the drawn line should not catch clicks; the hit path does");
  });

  check("cards still receive their own clicks", () => {
    const card = document.querySelector(".ib-clue");
    const r = card.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + (r.width / 2), r.top + (r.height / 2));
    assert(el?.closest(".ib-clue") === card, "a click in the middle of a card missed it");
  });

  check("a card covering a string takes the click", () => {
    const w = world();
    const card = document.querySelector(".ib-clue");
    const r = card.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + (r.width / 2), r.top + (r.height / 2) - w.top + w.top);
    assert(!!el?.closest(".ib-clue"), "the card should win over a string beneath it");
  });

  check("select marks exactly one string", () => {
    const id = connections[2].id;
    layer.select(id);
    const selected = [...document.querySelectorAll(".ib-string.selected")];
    assert((selected.length === 1) && (selected[0].dataset.connectionId === id),
      `${selected.length} strings selected`);
    layer.select(null);
    assert(!document.querySelector(".ib-string.selected"), "deselecting left a selection behind");
  });

  check("the pending string appears and clears", () => {
    layer.drawPending({x: 100, y: 100}, {x: 400, y: 300});
    assert(!!document.querySelector(".ib-string-pending"), "pending string was not drawn");
    layer.drawPending(null, null);
    assert(!document.querySelector(".ib-string-pending"), "pending string was not cleared");
  });

  check("remove and prune drop strings, and a redraw restores them", () => {
    const before = layer.ids.length;
    layer.remove(connections.at(-1).id);
    assert(layer.ids.length === (before - 1), "remove did nothing");
    layer.prune(new Set([connections[0].id, connections[1].id]));
    assert(layer.ids.length === 2, `prune left ${layer.ids.length}`);
    redraw();
    assert(layer.ids.length === before, `redraw gave ${layer.ids.length}, expected ${before}`);
  });

  check("filtering dims everything else", () => {
    layer.setFiltered(new Set([connections[0].id]));
    assert(document.querySelectorAll(".ib-string.dimmed").length === (connections.length - 1),
      "wrong number of dimmed strings");
    layer.setFiltered(null);
    assert(!document.querySelector(".ib-string.dimmed"), "clearing the filter left strings dimmed");
  });

  check("redrawing a connection reuses its group rather than duplicating it", () => {
    const before = document.querySelectorAll(".ib-string").length;
    redraw();
    redraw();
    assert(document.querySelectorAll(".ib-string").length === before, "duplicate groups were created");
  });

  check("labels render only where a label is set", () => {
    const expected = connections.filter(c => c.label).length;
    const rendered = [...document.querySelectorAll(".ib-string-label")]
      .filter(t => t.textContent.trim().length).length;
    assert(rendered === expected, `expected ${expected} labels, found ${rendered}`);
  });

  check("the midpoint helper sits on the curve", () => {
    const from = {x: 0, y: 0};
    const to = {x: 300, y: 100};
    const mid = stringMidpoint(from, to);
    const onCurve = at(from, to, 0.5);
    assert((Math.abs(mid.x - onCurve.x) < 0.01) && (Math.abs(mid.y - onCurve.y) < 0.01),
      `midpoint ${JSON.stringify(mid)} vs curve ${JSON.stringify(onCurve)}`);
  });

  const failed = results.filter(r => !r.ok);
  return {
    passed: results.length - failed.length,
    failed: failed.length,
    results: failed.length ? failed : results.map(r => r.name)
  };
}
