/**
 * In-page checks for BoardView.
 *
 * BoardView needs a real laid-out DOM (it reads `getBoundingClientRect`), so these run in the
 * preview page rather than in Node alongside the data-model tests:
 *
 *   node tools/preview-server.mjs   →   open /tools/preview/board.html   →   runBoardViewTests()
 *
 * The page exposes the result on `window.__boardViewResults` as well as returning it.
 */

/**
 * Run the suite against the live view.
 * @param {import("../../scripts/board/board-view.mjs").default} view
 * @param {HTMLElement} viewport
 */
export function runBoardViewTests(view, viewport) {
  const results = [];
  const check = (name, fn) => {
    try { fn(); results.push({name, ok: true}); }
    catch (err) { results.push({name, ok: false, error: err.message}); }
  };
  const near = (a, b, tol = 0.001) => Math.abs(a - b) <= tol;
  const assert = (cond, msg) => { if ( !cond ) throw new Error(msg); };

  const rect = () => viewport.getBoundingClientRect();
  const pointer = (type, clientX, clientY, button = 0) => viewport.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1, isPrimary: true, bubbles: true, cancelable: true,
      button, buttons: type === "pointerup" ? 0 : 1, clientX, clientY
    })
  );

  check("reset returns to origin at 100%", () => {
    view.setTransform({x: 40, y: 40, scale: 2});
    view.reset();
    const t = view.transform;
    assert((t.x === 0) && (t.y === 0) && (t.scale === 1), `got ${JSON.stringify(t)}`);
  });

  check("panBy accumulates", () => {
    view.reset();
    view.panBy(100, 50);
    view.panBy(-30, 10);
    const t = view.transform;
    assert((t.x === 70) && (t.y === 60), `got ${JSON.stringify(t)}`);
  });

  check("zoom clamps to the supported range", () => {
    view.reset();
    view.zoomBy(10_000);
    assert(view.transform.scale === 3, `max clamp gave ${view.transform.scale}`);
    view.reset();
    view.zoomBy(0.000_1);
    assert(view.transform.scale === 0.2, `min clamp gave ${view.transform.scale}`);
  });

  check("screenToBoard and boardToScreen round-trip", () => {
    view.setTransform({x: 55, y: -22, scale: 1.7});
    const s = view.boardToScreen(300, 200);
    const b = view.screenToBoard(s.x, s.y);
    assert(near(b.x, 300) && near(b.y, 200), `got ${b.x}, ${b.y}`);
  });

  // The important one: zooming must not slide the board out from under the cursor.
  check("zoom keeps the point under the cursor fixed", () => {
    view.reset();
    const r = rect();
    const cx = r.left + 250;
    const cy = r.top + 180;
    const before = view.screenToBoard(cx, cy);
    view.zoomBy(1.5, cx, cy);
    const after = view.screenToBoard(cx, cy);
    assert(near(after.x, before.x, 0.01) && near(after.y, before.y, 0.01),
      `drifted by ${(after.x - before.x).toFixed(3)}, ${(after.y - before.y).toFixed(3)}`);
  });

  check("zoom in then out returns to the original view", () => {
    view.reset();
    const r = rect();
    const cx = r.left + 310;
    const cy = r.top + 240;
    view.zoomBy(1.12, cx, cy);
    view.zoomBy(1 / 1.12, cx, cy);
    const t = view.transform;
    assert(near(t.x, 0, 0.01) && near(t.y, 0, 0.01) && near(t.scale, 1, 0.0001),
      `got ${JSON.stringify(t)}`);
  });

  check("dragging empty cork pans the board", () => {
    view.reset();
    const r = rect();
    pointer("pointerdown", r.left + 400, r.top + 400);
    pointer("pointermove", r.left + 600, r.top + 300);
    const moved = view.transform;
    pointer("pointerup", r.left + 600, r.top + 300);
    assert((moved.x === 200) && (moved.y === -100), `panned to ${moved.x}, ${moved.y}`);
    assert(view.isPanning === false, "pan gesture should end on pointerup");
  });

  check("a drag starting on a card does not pan the board", () => {
    view.reset();
    const card = document.createElement("div");
    card.className = "ib-clue";
    Object.assign(card.style, {position: "absolute", left: "0", top: "0", width: "80px", height: "80px"});
    viewport.querySelector(".ib-clue-layer").append(card);
    const cardRect = card.getBoundingClientRect();
    card.dispatchEvent(new PointerEvent("pointerdown", {
      pointerId: 2, isPrimary: true, bubbles: true, cancelable: true, button: 0, buttons: 1,
      clientX: cardRect.left + 10, clientY: cardRect.top + 10
    }));
    const panning = view.isPanning;
    card.remove();
    assert(panning === false, "the view should ignore drags that start on a card");
  });

  check("middle-click pans even when starting on a card", () => {
    view.reset();
    const card = document.createElement("div");
    card.className = "ib-clue";
    Object.assign(card.style, {position: "absolute", left: "0", top: "0", width: "80px", height: "80px"});
    viewport.querySelector(".ib-clue-layer").append(card);
    const cardRect = card.getBoundingClientRect();
    card.dispatchEvent(new PointerEvent("pointerdown", {
      pointerId: 3, isPrimary: true, bubbles: true, cancelable: true, button: 1, buttons: 4,
      clientX: cardRect.left + 10, clientY: cardRect.top + 10
    }));
    const panning = view.isPanning;
    pointer("pointerup", cardRect.left + 10, cardRect.top + 10, 1);
    card.remove();
    assert(panning === true, "middle-drag should pan from anywhere");
  });

  check("fit frames content without zooming past 100%", () => {
    view.fit({x: 0, y: 0, width: 50, height: 50});
    assert(view.transform.scale <= 1, `fit zoomed to ${view.transform.scale}`);
    view.fit({x: -120, y: 60, width: 920, height: 460});
    assert(view.transform.scale < 1, "a large area should zoom out to fit");
  });

  check("center reports the middle of the visible area", () => {
    view.reset();
    const r = rect();
    const c = view.center;
    assert(near(c.x, Math.round(r.width / 2), 1) && near(c.y, Math.round(r.height / 2), 1),
      `got ${JSON.stringify(c)}`);
  });

  view.reset();

  const failed = results.filter(r => !r.ok);
  return {
    passed: results.length - failed.length,
    failed: failed.length,
    results: failed.length ? results : results.map(r => r.name)
  };
}
