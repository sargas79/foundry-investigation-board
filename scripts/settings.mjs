import {DEFAULT_CLASSIFICATIONS, MODULE_ID, SETTINGS} from "./constants.mjs";

/**
 * Register the module's settings and keybindings.
 */
export function registerSettings() {
  /**
   * The list of case classifications offered in the case configuration UI. Editable by the GM so a
   * table can use its own genre's vocabulary; players may also type a value that isn't on the list.
   */
  game.settings.register(MODULE_ID, SETTINGS.CLASSIFICATIONS, {
    name: "INVESTIGATION_BOARD.SETTINGS.Classifications",
    hint: "INVESTIGATION_BOARD.SETTINGS.ClassificationsHint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.StringField({
      required: true,
      blank: true,
      initial: DEFAULT_CLASSIFICATIONS.join(", ")
    })
  });
}

/* -------------------------------------------- */

/**
 * Register keybindings for opening the board.
 */
export function registerKeybindings() {
  game.keybindings.register(MODULE_ID, "openBoard", {
    name: "INVESTIGATION_BOARD.KEYBINDINGS.OpenBoard",
    hint: "INVESTIGATION_BOARD.KEYBINDINGS.OpenBoardHint",
    editable: [{key: "KeyI", modifiers: ["Shift"]}],
    onDown: () => {
      game.modules.get(MODULE_ID).api.open();
      return true;
    },
    restricted: false
  });
}

/* -------------------------------------------- */

/**
 * The configured case classifications, parsed from the world setting.
 * @returns {string[]}
 */
export function getClassifications() {
  const raw = game.settings.get(MODULE_ID, SETTINGS.CLASSIFICATIONS) ?? "";
  return raw.split(",").map(c => c.trim()).filter(c => c.length);
}
