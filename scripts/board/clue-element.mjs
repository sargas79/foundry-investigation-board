import {CATEGORIES, CLUE_TEMPLATES, RELIABILITY} from "../constants.mjs";

/**
 * Builds and updates the DOM for a single clue card.
 *
 * Cards are plain elements positioned in board coordinates; the surrounding world element supplies
 * pan and zoom, so nothing here needs to know about the current view. Structure is shared across
 * templates and the differences are carried by a modifier class, which keeps the markup cheap to
 * patch when a clue changes.
 */

/** The pushpin, drawn inline so `pinColor` can drive it through CSS. */
function pinSvg() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ib-pin");
  svg.setAttribute("viewBox", "0 0 24 30");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `
    <ellipse class="ib-pin-shadow" cx="13.5" cy="27" rx="4.5" ry="1.6"/>
    <path class="ib-pin-needle" d="M12 12 L13.2 27"/>
    <circle class="ib-pin-head" cx="12" cy="9" r="8"/>
    <circle class="ib-pin-gloss" cx="9.2" cy="6.2" r="2.6"/>
  `;
  return svg;
}

/* -------------------------------------------- */

/**
 * Render the data a card needs from a clue page.
 * @param {JournalEntryPage} page          A page of sub-type `investigation-board.clue`.
 * @param {string} [enrichedBody]          Body HTML already run through Foundry's enricher.
 * @returns {object}
 */
function clueContext(page, enrichedBody) {
  const clue = page.system;
  const config = clue.templateConfig;
  return {
    id: page.id,
    name: page.name,
    template: clue.template,
    image: config.hasImage ? clue.image : null,
    body: config.hasBody ? (enrichedBody ?? clue.body ?? "") : "",
    category: clue.category,
    categoryLabel: game.i18n.localize(CATEGORIES[clue.category] ?? CATEGORIES.other),
    reliability: clue.reliability,
    reliabilityLabel: game.i18n.localize(RELIABILITY[clue.reliability] ?? RELIABILITY.unverified),
    pinColor: clue.pinColor,
    redacted: clue.redacted,
    x: clue.x,
    y: clue.y,
    rotation: clue.rotation,
    width: clue.width,
    z: clue.z,
    linked: !!clue.linkedUuid
  };
}

/* -------------------------------------------- */

/**
 * Create the card element for a clue.
 * @param {JournalEntryPage} page
 * @param {string} [enrichedBody]
 * @returns {HTMLElement}
 */
export function createClueElement(page, enrichedBody) {
  const el = document.createElement("article");
  el.className = "ib-clue";
  el.tabIndex = 0;
  el.append(pinSvg());

  const inner = document.createElement("div");
  inner.className = "ib-clue-inner";
  el.append(inner);

  const figure = document.createElement("figure");
  figure.className = "ib-clue-photo";
  figure.append(document.createElement("img"));
  inner.append(figure);

  const title = document.createElement("h3");
  title.className = "ib-clue-title";
  inner.append(title);

  const body = document.createElement("div");
  body.className = "ib-clue-body";
  inner.append(body);

  const meta = document.createElement("footer");
  meta.className = "ib-clue-meta";
  const badge = document.createElement("span");
  badge.className = "ib-badge";
  const link = document.createElement("i");
  link.className = "ib-clue-link fa-solid fa-link";
  meta.append(badge, link);
  inner.append(meta);

  updateClueElement(el, page, enrichedBody);
  return el;
}

/* -------------------------------------------- */

/**
 * Patch an existing card in place to match its clue.
 *
 * Updates are applied field by field rather than by replacing the element, so a card being dragged
 * or edited by another player doesn't lose focus or flicker when its document changes.
 *
 * @param {HTMLElement} el
 * @param {JournalEntryPage} page
 * @param {string} [enrichedBody]
 */
export function updateClueElement(el, page, enrichedBody) {
  const clue = clueContext(page, enrichedBody);

  el.dataset.clueId = clue.id;
  el.dataset.template = clue.template;
  el.dataset.category = clue.category;
  el.dataset.reliability = clue.reliability;
  el.setAttribute("aria-label", `${clue.name} — ${clue.categoryLabel}, ${clue.reliabilityLabel}`);
  el.classList.toggle("redacted", clue.redacted);
  el.classList.toggle("has-image", !!clue.image);

  // Position and shape travel as custom properties so CSS owns the actual transform.
  el.style.setProperty("--ib-x", `${clue.x}px`);
  el.style.setProperty("--ib-y", `${clue.y}px`);
  el.style.setProperty("--ib-w", `${clue.width}px`);
  el.style.setProperty("--ib-rot", `${clue.rotation}deg`);
  el.style.setProperty("--ib-pin", `var(--ib-pin-${clue.pinColor}, ${clue.pinColor})`);
  el.style.zIndex = String(clue.z);

  const figure = el.querySelector(".ib-clue-photo");
  const img = figure.querySelector("img");
  if ( clue.image ) {
    if ( img.getAttribute("src") !== clue.image ) img.setAttribute("src", clue.image);
    img.alt = clue.name;
    figure.hidden = false;
  }
  else figure.hidden = true;

  const title = el.querySelector(".ib-clue-title");
  if ( title.textContent !== clue.name ) title.textContent = clue.name;

  const body = el.querySelector(".ib-clue-body");
  if ( clue.body ) {
    if ( body.innerHTML !== clue.body ) body.innerHTML = clue.body;
    body.hidden = false;
  }
  else body.hidden = true;

  const badge = el.querySelector(".ib-badge");
  badge.textContent = clue.reliabilityLabel;
  badge.dataset.reliability = clue.reliability;

  el.querySelector(".ib-clue-link").hidden = !clue.linked;
  return el;
}

/* -------------------------------------------- */

/**
 * The templates a clue can be rendered with, for pickers.
 * @returns {Array<{value: string, label: string}>}
 */
export function templateChoices() {
  return Object.entries(CLUE_TEMPLATES).map(([value, config]) => ({
    value,
    label: game.i18n.localize(config.label)
  }));
}
