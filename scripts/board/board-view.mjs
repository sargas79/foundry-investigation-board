import {capturePointer, releasePointer} from "./pointer-capture.mjs";

/**
 * Pan and zoom for the corkboard surface.
 *
 * The board is an ordinary DOM tree, not a canvas: a "world" element holds the clue cards and the
 * SVG string layer, and this class applies a single CSS transform to it. Because everything lives
 * inside that one transformed element, strings and cards stay aligned for free, and card hit areas
 * remain real DOM targets.
 *
 * Board coordinates are what clue documents store (`system.x` / `system.y`); screen coordinates are
 * client pixels. {@link BoardView#screenToBoard} converts between them, which is what the drag and
 * linking interactions in later milestones need.
 */
export default class BoardView {

  /** Zoom limits. Below ~0.2 cards are unreadable; above 3 the textures blur. */
  static MIN_SCALE = 0.2;
  static MAX_SCALE = 3;

  /** Multiplier applied per wheel notch. */
  static ZOOM_STEP = 1.12;

  /* -------------------------------------------- */

  /**
   * @param {HTMLElement} viewport   The clipping element the board is seen through.
   * @param {HTMLElement} world      The transformed element holding cards and strings.
   */
  constructor(viewport, world) {
    this.viewport = viewport;
    this.world = world;
  }

  /** Current pan offset, in screen pixels. */
  #pan = {x: 0, y: 0};

  /** Current zoom factor. */
  #scale = 1;

  /** Bound listeners, retained so they can be removed again. */
  #listeners = [];

  /** In-progress pan gesture, or null. */
  #panning = null;

  /** Callbacks notified after any view change. */
  #onChange = new Set();

  /* -------------------------------------------- */
  /*  Accessors                                   */
  /* -------------------------------------------- */

  /** The current view as a plain object. */
  get transform() {
    return {x: this.#pan.x, y: this.#pan.y, scale: this.#scale};
  }

  /** Whether a pan gesture is currently in progress. */
  get isPanning() {
    return !!this.#panning;
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  /** Bind event listeners and apply the current transform. */
  attach() {
    this.#bind(this.viewport, "wheel", this.#onWheel.bind(this), {passive: false});
    this.#bind(this.viewport, "pointerdown", this.#onPointerDown.bind(this));
    this.#bind(this.viewport, "pointermove", this.#onPointerMove.bind(this));
    this.#bind(this.viewport, "pointerup", this.#onPointerUp.bind(this));
    this.#bind(this.viewport, "pointercancel", this.#onPointerUp.bind(this));
    // Middle-click is a pan shortcut; suppress the browser's auto-scroll affordance.
    this.#bind(this.viewport, "auxclick", event => {
      if ( event.button === 1 ) event.preventDefault();
    });
    this.#bind(this.viewport, "keydown", this.#onKeyDown.bind(this));
    // Reachable by keyboard, so the pan and zoom keys below can be used at all.
    if ( !this.viewport.hasAttribute("tabindex") ) this.viewport.tabIndex = 0;
    this.#apply();
    return this;
  }

  /** Remove every listener this view registered. */
  destroy() {
    for ( const [el, type, fn, opts] of this.#listeners ) el.removeEventListener(type, fn, opts);
    this.#listeners = [];
    this.#onChange.clear();
    this.#panning = null;
  }

  /**
   * Register a callback fired after any pan or zoom.
   * @param {(transform: {x: number, y: number, scale: number}) => void} fn
   * @returns {() => void}   A function that unregisters the callback.
   */
  onChange(fn) {
    this.#onChange.add(fn);
    return () => this.#onChange.delete(fn);
  }

  /* -------------------------------------------- */
  /*  Coordinate conversion                       */
  /* -------------------------------------------- */

  /**
   * Convert a screen point to board coordinates.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{x: number, y: number}}
   */
  screenToBoard(clientX, clientY) {
    const rect = this.viewport.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) - this.#pan.x) / this.#scale,
      y: ((clientY - rect.top) - this.#pan.y) / this.#scale
    };
  }

  /**
   * Convert board coordinates to a screen point.
   * @param {number} x
   * @param {number} y
   * @returns {{x: number, y: number}}
   */
  boardToScreen(x, y) {
    const rect = this.viewport.getBoundingClientRect();
    return {
      x: (x * this.#scale) + this.#pan.x + rect.left,
      y: (y * this.#scale) + this.#pan.y + rect.top
    };
  }

  /** The board-space rectangle currently visible. */
  get visibleBounds() {
    const {width, height} = this.viewport.getBoundingClientRect();
    return {
      x: -this.#pan.x / this.#scale,
      y: -this.#pan.y / this.#scale,
      width: width / this.#scale,
      height: height / this.#scale
    };
  }

  /** The board-space point at the centre of the viewport, where new clues are dropped. */
  get center() {
    const b = this.visibleBounds;
    return {x: Math.round(b.x + (b.width / 2)), y: Math.round(b.y + (b.height / 2))};
  }

  /* -------------------------------------------- */
  /*  View manipulation                           */
  /* -------------------------------------------- */

  /**
   * Set the view directly.
   * @param {{x?: number, y?: number, scale?: number}} transform
   */
  setTransform({x, y, scale} = {}) {
    if ( Number.isFinite(x) ) this.#pan.x = x;
    if ( Number.isFinite(y) ) this.#pan.y = y;
    if ( Number.isFinite(scale) ) this.#scale = this.#clampScale(scale);
    this.#apply();
  }

  /**
   * Zoom by a factor, keeping the given screen point stationary.
   * @param {number} factor        Multiplier, e.g. 1.1 to zoom in.
   * @param {number} [clientX]     Screen anchor; defaults to the viewport centre.
   * @param {number} [clientY]
   */
  zoomBy(factor, clientX, clientY) {
    const rect = this.viewport.getBoundingClientRect();
    clientX ??= rect.left + (rect.width / 2);
    clientY ??= rect.top + (rect.height / 2);

    const next = this.#clampScale(this.#scale * factor);
    if ( next === this.#scale ) return;

    // Keep the board point under the cursor pinned: solve for the pan that leaves it in place.
    const anchor = this.screenToBoard(clientX, clientY);
    this.#scale = next;
    this.#pan.x = (clientX - rect.left) - (anchor.x * next);
    this.#pan.y = (clientY - rect.top) - (anchor.y * next);
    this.#apply();
  }

  /**
   * Pan by a screen-pixel delta.
   * @param {number} dx
   * @param {number} dy
   */
  panBy(dx, dy) {
    this.#pan.x += dx;
    this.#pan.y += dy;
    this.#apply();
  }

  /**
   * Pan so a board-space point sits at the centre of the viewport, keeping the current zoom.
   * @param {number} x
   * @param {number} y
   */
  centerOn(x, y) {
    if ( !Number.isFinite(x) || !Number.isFinite(y) ) return;
    const rect = this.viewport.getBoundingClientRect();
    if ( !rect.width || !rect.height ) return;
    this.#pan.x = (rect.width / 2) - (x * this.#scale);
    this.#pan.y = (rect.height / 2) - (y * this.#scale);
    this.#apply();
  }

  /**
   * Bring a board-space rectangle into view, moving only if it isn't comfortably on screen.
   *
   * A board is a spatial memory, so following a string to a clue already in front of the player
   * must not shuffle the layout out from under them: only something off-screen, or pressed right
   * up against an edge, is worth panning to. The zoom is left alone either way — arriving at a
   * clue at a different magnification than you left is far more disorienting than a pan.
   *
   * @param {{x: number, y: number, width: number, height: number}|null} bounds
   * @param {number} [margin=24]   Board-space slack that must also be visible around the rectangle.
   * @returns {boolean}            Whether the view actually moved.
   */
  reveal(bounds, margin = 24) {
    if ( !bounds ) return false;
    const visible = this.visibleBounds;
    if ( !visible.width || !visible.height ) return false;
    const onScreen = ((bounds.x - margin) >= visible.x)
      && ((bounds.y - margin) >= visible.y)
      && ((bounds.x + bounds.width + margin) <= (visible.x + visible.width))
      && ((bounds.y + bounds.height + margin) <= (visible.y + visible.height));
    if ( onScreen ) return false;
    this.centerOn(bounds.x + (bounds.width / 2), bounds.y + (bounds.height / 2));
    return true;
  }

  /** Reset to 100% with the board origin at the viewport's top-left. */
  reset() {
    this.#pan = {x: 0, y: 0};
    this.#scale = 1;
    this.#apply();
  }

  /**
   * Frame a board-space rectangle, with padding, without exceeding 100%.
   * Used to fit a case's clues into view when it is opened.
   * @param {{x: number, y: number, width: number, height: number}} bounds
   * @param {number} [padding=60]   Board-space padding to leave around the content.
   */
  fit(bounds, padding = 60) {
    const rect = this.viewport.getBoundingClientRect();
    if ( !rect.width || !rect.height ) return;

    const width = bounds.width + (padding * 2);
    const height = bounds.height + (padding * 2);
    if ( (width <= 0) || (height <= 0) ) return this.reset();

    // Never zoom past 1:1 when fitting — blown-up cards look worse than empty cork.
    const scale = this.#clampScale(Math.min(rect.width / width, rect.height / height, 1));
    this.#scale = scale;
    this.#pan.x = ((rect.width - (bounds.width * scale)) / 2) - (bounds.x * scale);
    this.#pan.y = ((rect.height - (bounds.height * scale)) / 2) - (bounds.y * scale);
    this.#apply();
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  /**
   * Zoom on wheel, anchored at the cursor.
   * @param {WheelEvent} event
   */
  #onWheel(event) {
    event.preventDefault();
    const factor = event.deltaY < 0 ? BoardView.ZOOM_STEP : (1 / BoardView.ZOOM_STEP);
    this.zoomBy(factor, event.clientX, event.clientY);
  }

  /**
   * Begin panning, but only from empty cork or a middle-click.
   * @param {PointerEvent} event
   */
  #onPointerDown(event) {
    const middle = event.button === 1;
    if ( !middle && (event.button !== 0) ) return;
    // A left-drag that starts on a card belongs to that card, not to the view.
    if ( !middle && event.target.closest(".ib-clue, .ib-string-hit") ) return;

    this.#panning = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: this.#pan.x,
      originY: this.#pan.y
    };
    capturePointer(this.viewport, event.pointerId);
    this.viewport.classList.add("panning");
    event.preventDefault();
  }

  /** @param {PointerEvent} event */
  #onPointerMove(event) {
    const pan = this.#panning;
    if ( !pan || (event.pointerId !== pan.pointerId) ) return;
    this.#pan.x = pan.originX + (event.clientX - pan.startX);
    this.#pan.y = pan.originY + (event.clientY - pan.startY);
    this.#apply();
  }

  /** @param {PointerEvent} event */
  #onPointerUp(event) {
    if ( !this.#panning || (event.pointerId !== this.#panning.pointerId) ) return;
    // Cleared first: a failure to release capture must not strand the view mid-pan.
    this.#panning = null;
    releasePointer(this.viewport, event.pointerId);
    this.viewport.classList.remove("panning");
  }

  /**
   * Pan and zoom from the keyboard, so the board is usable without a mouse.
   *
   * Only acts when the board itself has focus — never while a card is focused or text is being
   * typed, where the arrow keys belong to the caret.
   * @param {KeyboardEvent} event
   */
  #onKeyDown(event) {
    if ( event.target !== this.viewport ) return;
    if ( event.ctrlKey || event.metaKey || event.altKey ) return;

    const step = event.shiftKey ? 160 : 60;
    switch ( event.key ) {
      case "ArrowLeft": this.panBy(step, 0); break;
      case "ArrowRight": this.panBy(-step, 0); break;
      case "ArrowUp": this.panBy(0, step); break;
      case "ArrowDown": this.panBy(0, -step); break;
      case "+": case "=": this.zoomBy(BoardView.ZOOM_STEP); break;
      case "-": case "_": this.zoomBy(1 / BoardView.ZOOM_STEP); break;
      case "0": this.reset(); break;
      default: return;
    }
    event.preventDefault();
  }

  /* -------------------------------------------- */
  /*  Internals                                   */
  /* -------------------------------------------- */

  /** Clamp a zoom factor into the supported range. */
  #clampScale(scale) {
    return Math.min(Math.max(scale, BoardView.MIN_SCALE), BoardView.MAX_SCALE);
  }

  /** Write the current transform to the DOM and notify listeners. */
  #apply() {
    this.world.style.transform =
      `translate(${this.#pan.x}px, ${this.#pan.y}px) scale(${this.#scale})`;
    // Exposed so CSS can keep hairlines and pin sizes stable as the board zooms.
    this.viewport.style.setProperty("--ib-scale", String(this.#scale));
    for ( const fn of this.#onChange ) fn(this.transform);
  }

  /** Register a listener and remember it for teardown. */
  #bind(el, type, fn, opts) {
    el.addEventListener(type, fn, opts);
    this.#listeners.push([el, type, fn, opts]);
  }
}
