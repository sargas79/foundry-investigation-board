const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Where a card's pushpin sits in the card's own coordinates.
 *
 * The pin element is 28px tall and offset 11px above the card's top edge, and its head is centred
 * 9/30 of the way down its viewBox — so the head lands slightly above the card. Cards rotate about
 * `50% 8px` (see the stylesheet), which is what {@link pinAnchor} rotates around.
 */
const PIN = {
  /** Distance of the pin head above the card's rotation origin. */
  offsetFromOrigin: 10.6,
  /** The rotation origin's y in card coordinates. */
  originY: 8
};

/**
 * The board-space point where a clue's string should attach.
 *
 * Computed from the clue's stored geometry rather than measured from the DOM: during a drag the
 * document hasn't been written yet, so the caller passes the live position, and reading layout for
 * every string on every pointer move would be far too expensive.
 *
 * @param {{x: number, y: number, width: number, rotation: number}} clue
 * @returns {{x: number, y: number}}
 */
export function pinAnchor(clue) {
  const theta = ((clue.rotation ?? 0) * Math.PI) / 180;
  return {
    x: clue.x + (clue.width / 2) + (PIN.offsetFromOrigin * Math.sin(theta)),
    y: clue.y + PIN.originY - (PIN.offsetFromOrigin * Math.cos(theta))
  };
}

/* -------------------------------------------- */

/**
 * The path for a string between two anchors, with the slight sag of a real length of twine.
 *
 * The sag grows with span but is capped, so short strings stay taut and long ones droop without
 * sweeping halfway down the board.
 *
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @returns {string}
 */
export function stringPath(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const span = Math.hypot(dx, dy);
  const sag = Math.min(span * 0.08, 34);
  const mx = (from.x + to.x) / 2;
  const my = ((from.y + to.y) / 2) + sag;
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

/**
 * The midpoint of a sagging string, where its label and scissors button go.
 * For a quadratic Bezier at t=0.5 that is the average of the ends and the control point, weighted.
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @returns {{x: number, y: number}}
 */
export function stringMidpoint(from, to) {
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  const sag = Math.min(span * 0.08, 34);
  const cx = (from.x + to.x) / 2;
  const cy = ((from.y + to.y) / 2) + sag;
  return {
    x: (0.25 * from.x) + (0.5 * cx) + (0.25 * to.x),
    y: (0.25 * from.y) + (0.5 * cy) + (0.25 * to.y)
  };
}

/* -------------------------------------------- */

/**
 * Draws and maintains the strings between clues.
 *
 * Each connection renders as two overlapping paths: a wide transparent one that catches clicks —
 * a 2px line is almost impossible to hit deliberately — and the visible twine on top.
 */
export default class StringLayer {

  /**
   * @param {SVGSVGElement} svg   The `.ib-string-layer` element inside the board's world.
   */
  constructor(svg) {
    this.svg = svg;
    this.#ensureDefs();
  }

  /**
   * Rendered groups, keyed by connection id.
   * @type {Map<string, SVGGElement>}
   */
  #groups = new Map();

  /* -------------------------------------------- */

  /** Install the shared drop-shadow filter once. */
  #ensureDefs() {
    if ( this.svg.querySelector("defs.ib-string-defs") ) return;
    const defs = document.createElementNS(SVG_NS, "defs");
    defs.setAttribute("class", "ib-string-defs");
    defs.innerHTML = `
      <filter id="ib-string-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="1" dy="2" stdDeviation="1.4" flood-color="#000" flood-opacity="0.45"/>
      </filter>
    `;
    this.svg.prepend(defs);
  }

  /* -------------------------------------------- */

  /**
   * Draw or update one connection.
   * @param {string} id                                        Connection page id.
   * @param {{x: number, y: number}} from                      Anchor of the first clue.
   * @param {{x: number, y: number}} to                        Anchor of the second clue.
   * @param {{color?: string, style?: string, label?: string}} [options]
   * @returns {SVGGElement}
   */
  draw(id, from, to, {color = "red", style = "solid", label = ""} = {}) {
    let group = this.#groups.get(id);
    if ( !group ) {
      group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("class", "ib-string");
      group.dataset.connectionId = id;

      const hit = document.createElementNS(SVG_NS, "path");
      hit.setAttribute("class", "ib-string-hit");

      const line = document.createElementNS(SVG_NS, "path");
      line.setAttribute("class", "ib-string-line");
      line.setAttribute("filter", "url(#ib-string-shadow)");

      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("class", "ib-string-label");
      text.setAttribute("text-anchor", "middle");

      group.append(hit, line, text);
      this.svg.append(group);
      this.#groups.set(id, group);
    }

    const d = stringPath(from, to);
    group.querySelector(".ib-string-hit").setAttribute("d", d);
    group.querySelector(".ib-string-line").setAttribute("d", d);
    group.dataset.style = style;
    group.style.setProperty("--ib-string-color", `var(--ib-pin-${color}, ${color})`);

    const text = group.querySelector(".ib-string-label");
    if ( label ) {
      const mid = stringMidpoint(from, to);
      text.setAttribute("x", mid.x.toFixed(1));
      text.setAttribute("y", (mid.y - 6).toFixed(1));
      text.textContent = label;
      text.removeAttribute("hidden");
    }
    else {
      text.textContent = "";
      text.setAttribute("hidden", "");
    }

    return group;
  }

  /* -------------------------------------------- */

  /**
   * Draw a provisional string that follows the cursor while a link is being made.
   * @param {{x: number, y: number}|null} from   Anchor of the clue being linked from.
   * @param {{x: number, y: number}|null} to     Current cursor position, in board coordinates.
   */
  drawPending(from, to) {
    let path = this.svg.querySelector(".ib-string-pending");
    if ( !from || !to ) {
      path?.remove();
      return;
    }
    if ( !path ) {
      path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("class", "ib-string-pending");
      this.svg.append(path);
    }
    path.setAttribute("d", stringPath(from, to));
  }

  /* -------------------------------------------- */

  /**
   * Remove one connection's string.
   * @param {string} id
   */
  remove(id) {
    this.#groups.get(id)?.remove();
    this.#groups.delete(id);
  }

  /** Remove every string. */
  clear() {
    for ( const group of this.#groups.values() ) group.remove();
    this.#groups.clear();
    this.drawPending(null, null);
  }

  /**
   * Drop any string whose id is not in the given set — used after a case re-render.
   * @param {Set<string>} keep
   */
  prune(keep) {
    for ( const id of [...this.#groups.keys()] ) {
      if ( !keep.has(id) ) this.remove(id);
    }
  }

  /**
   * Mark one string as selected, deselecting any other.
   * @param {string|null} id
   */
  select(id) {
    for ( const [key, group] of this.#groups ) group.classList.toggle("selected", key === id);
  }

  /**
   * Dim strings that don't match the active filter.
   * @param {Set<string>|null} matching   Ids to keep bright, or null to clear the filter.
   */
  setFiltered(matching) {
    for ( const [id, group] of this.#groups ) {
      group.classList.toggle("dimmed", !!matching && !matching.has(id));
    }
  }

  /** The connection ids currently drawn. */
  get ids() {
    return [...this.#groups.keys()];
  }
}
