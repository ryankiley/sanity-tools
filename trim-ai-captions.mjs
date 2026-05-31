#!/usr/bin/env node
// Trim sentence 2 from AI-originated two-sentence captions.
// AI fingerprint: caption[0]._key is 12-char-with-hyphen (current describeImage.ts)
// OR 8-char (older variant). Skips multi-span blocks (links/marks), nanoid keys (your edits),
// and trim-* keys (older video imports). Run with --apply to write; otherwise dry-run.

import { writeFileSync } from "fs";
import { client } from "./_lib/client.mjs"; // also loads .env at import time

const APPLY = process.argv.includes("--apply");

// Find first ". " followed by a capital letter — the boundary between sentences.
// Returns the first sentence with its trailing period if a real second sentence exists.
function trim(text) {
  const m = text.match(/^(.+?\.)\s+[A-Z]/s);
  return m ? m[1] : text;
}

const query = `*[_type == "media" && mediaType != "text" && defined(caption) && length(pt::text(caption)) > 0 && (
  (length(caption[0]._key) == 12 && length(string::split(caption[0]._key, "-")) > 1) ||
  length(caption[0]._key) == 8
) && length(string::split(pt::text(caption), ". ")) > 1] {
  _id,
  _rev,
  "t": pt::text(caption),
  "spanCount": count(caption[0].children),
  "blockCount": count(caption)
}`;

const docs = await client.fetch(query);
console.log(`Fetched ${docs.length} candidates.`);

const plans = [];
const skipped = { multiSpan: 0, malformedId: 0, noChange: 0, multiBlock: 0 };

for (const d of docs) {
  if (d._id.startsWith("drafts.drafts.")) { skipped.malformedId++; continue; }
  if (d.blockCount > 1) { skipped.multiBlock++; continue; }
  if (d.spanCount > 1) { skipped.multiSpan++; continue; }
  const newText = trim(d.t);
  if (newText === d.t) { skipped.noChange++; continue; }
  plans.push({ _id: d._id, before: d.t, after: newText });
}

console.log("\nPatch plan:");
console.log(`  to apply: ${plans.length}`);
console.log(`  skipped (multi-span project captions): ${skipped.multiSpan}`);
console.log(`  skipped (no real second sentence — trailing whitespace): ${skipped.noChange}`);
console.log(`  skipped (multi-block): ${skipped.multiBlock}`);
console.log(`  skipped (malformed drafts.drafts. id): ${skipped.malformedId}`);

writeFileSync("trim-ai-captions-plan.json", JSON.stringify(plans, null, 2));
console.log(`\nFull plan written to trim-ai-captions-plan.json`);

// Sample
console.log("\nSample diffs (first 15):");
for (const p of plans.slice(0, 15)) {
  console.log(`\n  ${p._id}`);
  console.log(`  -  ${p.before}`);
  console.log(`  +  ${p.after}`);
}

if (!APPLY) {
  console.log(`\nDry run. Re-run with --apply to write changes.`);
  process.exit(0);
}

console.log(`\nApplying ${plans.length} patches...`);
let done = 0;
let failed = 0;
const BATCH = 25;
for (let i = 0; i < plans.length; i += BATCH) {
  const slice = plans.slice(i, i + BATCH);
  const tx = client.transaction();
  for (const p of slice) {
    tx.patch(p._id, (patch) =>
      patch.set({ "caption[0].children[0].text": p.after }),
    );
  }
  try {
    await tx.commit({ visibility: "async" });
    done += slice.length;
    process.stdout.write(`  ${done}/${plans.length}\r`);
  } catch (err) {
    failed += slice.length;
    console.error(`\nBatch ${i}-${i + slice.length} failed:`, err.message);
  }
}
console.log(`\nDone. ${done} patched, ${failed} failed.`);
