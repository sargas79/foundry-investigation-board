/**
 * A minimal harness that loads Foundry's own `common/` code in Node so the module's data models and
 * manifest can be validated against the real V14 schemas, without launching the app.
 *
 * Point FOUNDRY_APP at the `resources/app` directory of a Foundry install if yours is elsewhere:
 *   FOUNDRY_APP="D:/Foundry/resources/app" node test/run.mjs
 */

export const APP = (process.env.FOUNDRY_APP
  ?? "E:/Foundry Virtual Tabletop/resources/app").replaceAll("\\", "/");

/**
 * Install the globals Foundry's common code expects, then return the pieces tests need.
 * @returns {Promise<{CONST: object, utils: object, fields: object, abstract: object}>}
 */
export async function bootstrapFoundry() {
  // Array.filterJoin and friends are used inside the schema code.
  await import(`file:///${APP}/common/primitives/_module.mjs`);

  const CONST = await import(`file:///${APP}/common/constants.mjs`);
  const utils = await import(`file:///${APP}/common/utils/_module.mjs`);
  const fields = await import(`file:///${APP}/common/data/fields.mjs`);
  const abstract = await import(`file:///${APP}/common/abstract/_module.mjs`);

  globalThis.CONST = CONST;
  globalThis.foundry = {CONST, utils, abstract, data: {fields}, documents: {}};
  globalThis.game = {
    i18n: {localize: k => k, format: k => k, has: () => true},
    release: {generation: 14, version: "14.367"}
  };
  globalThis.packages = {warnings: {add: () => {}}};
  // DocumentUUIDField resolves document types through CONFIG when validating.
  globalThis.CONFIG = Object.fromEntries(CONST.ALL_DOCUMENT_TYPES.map(t => [t, {collection: null}]));

  // AdditionalTypesField checks that a document supports sub-types via getDocumentClass().
  const docs = await import(`file:///${APP}/common/documents/_module.mjs`);
  const byName = {};
  for ( const cls of Object.values(docs) ) {
    if ( cls?.documentName ) byName[cls.documentName] = cls;
  }
  globalThis.getDocumentClass = name => byName[name];

  return {CONST, utils, fields, abstract};
}

/* -------------------------------------------- */
/*  Tiny test runner                            */
/* -------------------------------------------- */

let failures = 0;
let passes = 0;

/** Start a named group of checks. */
export function describe(label) {
  console.log(`\n${label}`);
}

/** Run one check, catching and reporting any thrown assertion. */
export function check(label, fn) {
  try {
    fn();
    passes++;
    console.log(`  PASS  ${label}`);
  }
  catch (err) {
    failures++;
    console.log(`  FAIL  ${label}\n        ${err.message}`);
  }
}

/** Throw unless `condition` holds. */
export function assert(condition, message) {
  if ( !condition ) throw new Error(message);
}

/** Assert that `fn` throws. */
export function assertThrows(fn, message) {
  let threw = false;
  try { fn(); }
  catch { threw = true; }
  if ( !threw ) throw new Error(message);
}

/** Print the tally and set the process exit code. */
export function report() {
  console.log(failures
    ? `\n${failures} check(s) failed, ${passes} passed`
    : `\nAll ${passes} checks passed`);
  process.exitCode = failures ? 1 : 0;
  return failures;
}
