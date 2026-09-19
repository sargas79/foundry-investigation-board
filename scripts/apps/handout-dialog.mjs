import {HANDOUT_KINDS, MODULE_ID, modulePath} from "../constants.mjs";
import {createHandout, handoutPage, seedRows} from "../data/handouts.mjs";
import {bindLeadsPicker} from "../data/uploads.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/**
 * Writing a document to hand over — a death record, a badge, a clipping — or rewriting one.
 *
 * One form for both jobs, as with the clue dialog: the fields are the same and only the presence of
 * an existing document differs, which is what keeps creating and editing from drifting apart.
 *
 * The particulars of a document are edited as labelled rows the GM can add to and take away,
 * because no fixed set of fields survives contact with a table. Choosing a kind seeds the rows that
 * kind usually wants and nothing more.
 */
export default class HandoutDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "investigation-board-handout-dialog",
    classes: [MODULE_ID, "ib-dialog", "ib-handout-dialog"],
    tag: "form",
    window: {
      title: "INVESTIGATION_BOARD.DIALOG.NewHandout",
      icon: "fa-solid fa-file-lines",
      resizable: true,
      contentClasses: ["standard-form"]
    },
    position: {width: 540, height: "auto"},
    form: {handler: HandoutDialog.#onSubmit, closeOnSubmit: true},
    actions: {
      pickKind: HandoutDialog.#onPickKind,
      addRow: HandoutDialog.#onAddRow,
      removeRow: HandoutDialog.#onRemoveRow
    }
  };

  /** @override */
  static PARTS = {
    body: {template: modulePath("templates/dialog/handout.hbs"), classes: ["standard-form"]},
    footer: {template: modulePath("templates/dialog/dialog-footer.hbs")}
  };

  /* -------------------------------------------- */

  /**
   * @param {object} options
   * @param {JournalEntry} [options.journal]   An existing handout to rewrite.
   */
  constructor({journal, ...options} = {}) {
    super(options);
    this.journal = journal ?? null;
    const page = this.journal ? handoutPage(this.journal) : null;
    this.#kind = page?.system.kind ?? "death";
    this.#rows = page ? page.system.rows.map(row => ({...row})) : seedRows(this.#kind);
  }

  /** The kind currently chosen, tracked here so the form re-lays-out without a round-trip. */
  #kind;

  /**
   * The rows as they stand in the form.
   *
   * Held here rather than read back off the document, because adding, removing or re-seeding rows
   * re-renders the form: rebuilding them from the document each time would throw away every row the
   * GM had typed but not yet saved.
   * @type {{label: string, value: string}[]}
   */
  #rows;

  /**
   * The other fields, as last typed. Same reason as `#rows`.
   * @type {Record<string, unknown>}
   */
  #draft = {};

  /** Whether this dialog is rewriting an existing document. */
  get isEdit() {
    return !!this.journal;
  }

  /** @override */
  get title() {
    return game.i18n.localize(this.isEdit
      ? "INVESTIGATION_BOARD.DIALOG.EditHandout"
      : "INVESTIGATION_BOARD.DIALOG.NewHandout");
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const page = this.journal ? handoutPage(this.journal) : null;
    // The form's fields are flat — the system object is assembled on submit — so what was typed
    // can be laid straight over what is stored.
    const handout = {...(page?.system ?? {}), ...this.#draft, rows: this.#rows};
    const config = HANDOUT_KINDS[this.#kind] ?? HANDOUT_KINDS.document;

    return Object.assign(context, {
      isEdit: this.isEdit,
      name: this.#draft.name ?? this.journal?.name ?? "",
      handout,
      rows: this.#rows,
      selectedKind: this.#kind,
      // The image is a portrait on some kinds and a scan of the whole document on others; saying
      // which sets the GM's expectation before they go looking for a file.
      imageHint: config.portrait
        ? "INVESTIGATION_BOARD.HandoutPortraitHint"
        : "INVESTIGATION_BOARD.HandoutScanHint",
      kinds: Object.entries(HANDOUT_KINDS).map(([value, kind]) => ({
        value,
        label: game.i18n.localize(kind.label),
        icon: kind.icon,
        selected: value === this.#kind
      })),
      canUpload: game.user.can("FILES_UPLOAD"),
      buttons: [{type: "submit", icon: "fa-solid fa-check", label: "INVESTIGATION_BOARD.Save"}]
    });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    bindLeadsPicker(this.element);
  }

  /* -------------------------------------------- */

  /**
   * Remember what has been typed, so a re-render does not discard it.
   *
   * Rows are read back into `#rows` rather than into the draft: they are the thing the re-render is
   * about to rebuild, and they are keyed by position, so the draft's flat copy would go stale the
   * moment a row in the middle was removed.
   */
  #captureForm() {
    const form = this.element;
    if ( !form ) return;
    const data = new foundry.applications.ux.FormDataExtended(form).object;

    this.#rows = this.#rows.map((row, index) => ({
      label: data[`rows.${index}.label`] ?? row.label,
      value: data[`rows.${index}.value`] ?? row.value
    }));

    for ( const [key, value] of Object.entries(data) ) {
      if ( !key.startsWith("rows.") ) this.#draft[key] = value;
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * Choose what kind of document this is.
   *
   * Switching kinds re-seeds the blanks, but only when none of them has been filled in: a GM who
   * has typed a coroner's name and then changes their mind about the layout must not lose it.
   *
   * @this {HandoutDialog}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static async #onPickKind(_event, target) {
    this.#captureForm();
    this.#kind = target.dataset.kind;
    const untouched = this.#rows.every(row => !row.value.trim());
    if ( untouched ) this.#rows = seedRows(this.#kind);
    await this.render();
  }

  /* -------------------------------------------- */

  /**
   * Add a blank line to the document's particulars.
   * @this {HandoutDialog}
   */
  static async #onAddRow() {
    this.#captureForm();
    this.#rows.push({label: "", value: ""});
    await this.render();
  }

  /* -------------------------------------------- */

  /**
   * Take a line out again.
   * @this {HandoutDialog}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static async #onRemoveRow(_event, target) {
    this.#captureForm();
    this.#rows.splice(Number(target.dataset.index), 1);
    await this.render();
  }

  /* -------------------------------------------- */

  /**
   * Save the document.
   * @this {HandoutDialog}
   * @param {SubmitEvent} _event
   * @param {HTMLFormElement} form
   * @param {object} formData
   * @returns {Promise<void>}
   */
  static async #onSubmit(_event, form, formData) {
    const data = formData.object;
    const name = String(data.name ?? "").trim()
      || game.i18n.localize("INVESTIGATION_BOARD.UntitledHandout");

    // Rows arrive flattened as `rows.0.label`; rebuild them in order, and drop the ones left
    // entirely blank so a seeded field the GM had no answer for does not print as an empty rule.
    const rows = this.#rows
      .map((row, index) => ({
        label: String(data[`rows.${index}.label`] ?? row.label ?? "").trim(),
        value: String(data[`rows.${index}.value`] ?? row.value ?? "").trim()
      }))
      .filter(row => row.label || row.value);

    const system = {
      kind: this.#kind,
      issuer: data.issuer ?? "",
      reference: data.reference ?? "",
      dateline: data.dateline ?? "",
      image: data.image || null,
      body: data.body ?? "",
      rows
    };

    if ( this.isEdit ) {
      const page = handoutPage(this.journal);
      if ( !page ) return;
      await this.journal.update({name});
      // The page carries the name too, so the document reads right when opened from the journal
      // sidebar, where the page's own name is the heading.
      await page.update({name, system});
      return;
    }

    await createHandout({name, kind: this.#kind, system});
  }

  /* -------------------------------------------- */

  /**
   * Write a new document.
   * @returns {Promise<HandoutDialog>}
   */
  static create() {
    return new this().render({force: true});
  }

  /* -------------------------------------------- */

  /**
   * Rewrite an existing one.
   * @param {JournalEntry} journal
   * @returns {Promise<HandoutDialog>}
   */
  static edit(journal) {
    return new this({journal}).render({force: true});
  }
}
