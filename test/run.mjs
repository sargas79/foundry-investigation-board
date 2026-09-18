/**
 * Run the module's checks against a local Foundry V14 install.
 *
 *   node test/run.mjs
 *   FOUNDRY_APP="D:/Foundry/resources/app" node test/run.mjs
 */
import fs from "node:fs";
import {APP, bootstrapFoundry, report} from "./harness.mjs";

if ( !fs.existsSync(`${APP}/common/constants.mjs`) ) {
  console.error(`Could not find Foundry's common/ code at: ${APP}`);
  console.error("Set FOUNDRY_APP to your install's resources/app directory.");
  process.exit(2);
}

await bootstrapFoundry();

const {default: testManifest} = await import("./manifest.test.mjs");
const {default: testDataModels} = await import("./data-models.test.mjs");
const {default: testCase} = await import("./case.test.mjs");
const {default: testCaseCreate} = await import("./case-create.test.mjs");
const {default: testFilter} = await import("./filter.test.mjs");
const {default: testSharing} = await import("./sharing.test.mjs");
const {default: testTransfer} = await import("./transfer.test.mjs");

await testManifest();
await testDataModels();
await testCase();
await testCaseCreate();
await testFilter();
await testSharing();
await testTransfer();

report();
