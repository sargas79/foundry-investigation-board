import {
  CATEGORIES,
  CLUE_TEMPLATES,
  MODULE_ID,
  PAGE_TYPES,
  PIN_COLORS,
  RELIABILITY,
  modulePath
} from "../constants.mjs";
import {freeSpotNear, topZ} from "../data/case.mjs";
import {authorStamp} from "../data/authorship.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/**
 * The Pin Evidence dialog: creates a new clue, or edits an existing one.
 *
 * Both jobs use the same form — the fields are identical and the only difference is whether a
 * document already exists — which keeps the two from drifting apart.
 */
export default class ClueDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "investigation-board-clue-dialog",
    classes: [MODULE_ID, "ib-dialog"],
    tag: "form",
    window: {
      title: "INVESTIGATION_BOARD.DIALOG.PinEvidence",
      icon: "fa-solid fa-thumbtack",
      contentClasses: ["standard-form"]
    },
    position: {width: 480, height: "auto"},
    form: {
      handler: ClueDialog.#onSubmit,
      closeOnSubmit: true
    },
    actions: {
      pickTemplate: ClueDialog.#onPickTemplate,
      pickPin: ClueDialog.#onPickPin
    }
  };

  /** @override */
  static PARTS = {
    body: {template: modulePath("templates/dialog/clue-dialog.hbs"), classes: ["standard-form"]},
    footer: {template: modulePath("templates/dialog/dialog-footer.hbs")}
  };

  /* -------------------------------------------- */

  /**
   * @param {object} options
   * @param {JournalEntry} options.journal          The case the clue belongs to.
   * @param {JournalEntryPage} [options.page]       An existing clue to edit.
   * @param {{x: number, y: number}} [options.at]   Board position for a new clue.
   */
  constructor({journal, page, at, ...options} = {}) {
    super(options);
    this.journal = journal;
    this.page = page ?? null;
    this.at = at ?? null;
    // Track the pickers' state locally so the preview updates without a form round-trip.
    this.#template = page?.system.template ?? "polaroid";
    this.#pinColor = page?.system.pinColor ?? "red";
  }

  #template;
  #pinColor;

  /**
   * Field values typed but not yet submitted.
   *
   * Choosing a card template re-renders the form, because which fields are shown depends on the
   * template. Without this the re-render would rebuild every field from the document — empty, for
   * a clue being created — and silently discard whatever the user had already typed.
   * @type {Record<string, unknown>}
   */
  #draft = {};

  /** Whether this dialog is editing an existing clue. */
  get isEdit() {
    return !!this.page;
  }

  /** @override */
  get title() {
    return game.i18n.localize(this.isEdit
      ? "INVESTIGATION_BOARD.DIALOG.EditClue"
      : "INVESTIGATION_BOARD.DIALOG.PinEvidence");
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const localized = record => Object.entries(record).map(([value, label]) => ({
      value,
      label: game.i18n.localize(label)
    }));

    // Anything already typed wins over the stored document, so a re-render doesn't lose it.
    const draft = foundry.utils.expandObject(this.#draft);
    const clue = {...(this.page?.system ?? {}), ...(draft.system ?? {})};

    return Object.assign(context, {
      isEdit: this.isEdit,
      name: draft.name ?? this.page?.name ?? "",
      clue,
      selectedTemplate: this.#template,
      selectedPin: this.#pinColor,
      templates: Object.entries(CLUE_TEMPLATES).map(([value, config]) => ({
        value,
        label: game.i18n.localize(config.label),
        selected: value === this.#template
      })),
      pinColors: PIN_COLORS.map(value => ({value, selected: value === this.#pinColor})),
      categories: localized(CATEGORIES),
      reliabilities: localized(RELIABILITY),
      // Without browse permission the picker degrades to a plain text field on its own; this just
      // stops us offering an upload control that would be refused by the server.
      canUpload: game.user.can("FILES_UPLOAD"),
      showsImage: CLUE_TEMPLATES[this.#template]?.hasImage ?? true,
      showsBody: CLUE_TEMPLATES[this.#template]?.hasBody ?? true,
      buttons: [
        {type: "submit", icon: "fa-solid fa-thumbtack",
          label: this.isEdit ? "INVESTIGATION_BOARD.Save" : "INVESTIGATION_BOARD.Pin"}
      ]
    });
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  /**
   * Choose a card template. Re-renders so the image and body fields follow what that template
   * actually shows.
   * @this {ClueDialog}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static async #onPickTemplate(_event, target) {
    this.#captureDraft();
    this.#template = target.dataset.template;
    await this.render();
  }

  /* -------------------------------------------- */

  /**
   * Remember what is currently in the form, so a re-render can put it back.
   *
   * Fields the outgoing template rendered but the incoming one does not are kept in the draft
   * rather than dropped: switching to a polaroid and back must not lose the body text typed in
   * between.
   */
  #captureDraft() {
    if ( !this.element ) return;
    const current = new foundry.applications.ux.FormDataExtended(this.element).object;
    this.#draft = foundry.utils.mergeObject(this.#draft, current, {inplace: false});
  }

  /**
   * Choose a pin colour.
   * @this {ClueDialog}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static #onPickPin(_event, target) {
    this.#pinColor = target.dataset.color;
    for ( const swatch of this.element.querySelectorAll("[data-action='pickPin']") ) {
      swatch.classList.toggle("selected", swatch.dataset.color === this.#pinColor);
    }
  }

  /* -------------------------------------------- */

  /**
   * Create or update the clue.
   * @this {ClueDialog}
   * @param {SubmitEvent} _event
   * @param {HTMLFormElement} _form
   * @param {FormDataExtended} formData
   * @returns {Promise<void>}
   */
  static async #onSubmit(_event, _form, formData) {
    // The visible form wins, but values typed under a previously-selected template are still
    // carried in the draft and must be saved too.
    const merged = foundry.utils.mergeObject(this.#draft, formData.object, {inplace: false});
    const data = foundry.utils.expandObject(merged);
    const name = data.name?.trim() || game.i18n.localize("INVESTIGATION_BOARD.UntitledClue");

    const system = {
      template: this.#template,
      pinColor: this.#pinColor,
      category: data.system?.category ?? "other",
      reliability: data.system?.reliability ?? "unverified",
      redacted: !!data.system?.redacted
    };

    // Only write the fields this template actually rendered. A template without a body or a photo
    // omits those inputs, and defaulting them here would silently wipe content the user still has
    // — switching a written-up document clue to a polaroid must not destroy its text.
    if ( "image" in (data.system ?? {}) ) system.image = data.system.image || null;
    if ( "body" in (data.system ?? {}) ) system.body = data.system.body ?? "";

    if ( this.isEdit ) {
      await this.page.update({name, system});
      return;
    }

    // A brand new clue lands where the user asked, on top of the pile, with a slight tilt so the
    // board looks pinned by hand rather than laid out on a grid.
    const at = this.at ?? {x: 0, y: 0};
    const spot = freeSpotNear(this.journal, at);
    await this.journal.createEmbeddedDocuments("JournalEntryPage", [{
      name,
      type: PAGE_TYPES.CLUE,
      system: {
        ...system,
        // Stamped here rather than in the model, so an edit never rewrites who pinned it.
        ...authorStamp(),
        createdAt: Date.now(),
        x: spot.x,
        y: spot.y,
        z: topZ(this.journal) + 1,
        rotation: Math.round(((Math.random() * 8) - 4) * 10) / 10
      }
    }]);
  }

  /* -------------------------------------------- */

  /**
   * Open the dialog to pin a new clue.
   * @param {JournalEntry} journal
   * @param {{x: number, y: number}} at   Where on the board to put it.
   * @returns {ClueDialog}
   */
  static pin(journal, at) {
    return new this({journal, at}).render({force: true});
  }

  /**
   * Open the dialog to edit an existing clue.
   * @param {JournalEntryPage} page
   * @returns {ClueDialog}
   */
  static edit(page) {
    return new this({journal: page.parent, page}).render({force: true});
  }
}
