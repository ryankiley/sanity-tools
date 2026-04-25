/**
 * Migrate media.clients[] (array of refs) → media.client (single ref).
 *
 * Run AFTER migrate-instrument-to-credit.mjs — that script already removes
 * Instrument from clients[], which collapses most multi-client items to one.
 *
 * USAGE:
 *   node migrate-to-single-client.mjs --report
 *     → Counts: how many items have 0 / 1 / 2+ clients. No writes.
 *
 *   node migrate-to-single-client.mjs --extract
 *     → For items with 2+ clients, write a review JSON to
 *       /tmp/multi-client-review.json. You open that file and set
 *       `pick` to the client name to keep on each row.
 *
 *   node migrate-to-single-client.mjs --apply [--dry]
 *     → For every media doc:
 *         - 0 clients: unset `clients`, do not set `client`.
 *         - 1 client:  unset `clients`, set `client` to that single ref.
 *         - 2+ clients: read /tmp/multi-client-review.json; use the
 *           picked client. If any 2+ row is missing `pick`, abort.
 *
 * Auth: uses Sanity CLI token from ~/.config/sanity/config.json.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { client } from "../_lib/client.mjs";

const REVIEW_PATH = "/tmp/multi-client-review.json";

const args = new Set(process.argv.slice(2));
const MODE = args.has("--apply") ? "apply" : args.has("--extract") ? "extract" : "report";
const DRY = args.has("--dry");

// ─── Fetch all media with resolved client names ───

async function fetchAll() {
  return client.fetch(
    `*[_type == "media"]{
      _id,
      title,
      clients,
      "clientNames": clients[]->name
    }`
  );
}

// ─── Report ───

async function report() {
  const items = await fetchAll();
  const buckets = { 0: 0, 1: 0, many: 0 };
  for (const it of items) {
    const n = (it.clients ?? []).length;
    if (n === 0) buckets[0]++;
    else if (n === 1) buckets[1]++;
    else buckets.many++;
  }
  console.log(`Total media: ${items.length}`);
  console.log(`  0 clients:  ${buckets[0]}`);
  console.log(`  1 client:   ${buckets[1]}`);
  console.log(`  2+ clients: ${buckets.many}`);
  if (buckets.many > 0) {
    console.log(
      `\nRun --extract to build a review JSON for the ${buckets.many} multi-client item(s).`
    );
  }
}

// ─── Extract review JSON for multi-client items ───

async function extract() {
  const items = await fetchAll();
  const rows = items
    .filter((it) => (it.clients ?? []).length >= 2)
    .map((it) => ({
      mediaId: it._id,
      title: it.title ?? "(untitled)",
      currentClients: it.clientNames ?? [],
      pick: null, // ← fill in one of currentClients to keep
    }));

  writeFileSync(REVIEW_PATH, JSON.stringify(rows, null, 2));
  console.log(`Wrote ${rows.length} multi-client row(s) to ${REVIEW_PATH}`);
  console.log(`\nEdit the file to set \`pick\` on each row, then run:`);
  console.log(`  node migrate-to-single-client.mjs --apply --dry`);
  console.log(`  node migrate-to-single-client.mjs --apply`);
}

// ─── Apply ───

async function apply() {
  const items = await fetchAll();

  // Load picks for multi-client items (if any).
  const picks = new Map(); // mediaId → picked client name
  const multi = items.filter((it) => (it.clients ?? []).length >= 2);

  if (multi.length > 0) {
    if (!existsSync(REVIEW_PATH)) {
      console.error(`${multi.length} multi-client item(s) need review. Run --extract first.`);
      process.exit(1);
    }
    const review = JSON.parse(readFileSync(REVIEW_PATH, "utf8"));
    const missing = review.filter((r) => !r.pick);
    if (missing.length > 0) {
      console.error(`Missing \`pick\` on ${missing.length} row(s) in ${REVIEW_PATH}:`);
      for (const r of missing) console.error(`  ${r.mediaId} — ${r.title}`);
      process.exit(1);
    }
    for (const r of review) picks.set(r.mediaId, r.pick);
  }

  console.log(
    `${DRY ? "Dry run:" : "Applying"} single-client migration across ${items.length} item(s).\n`
  );

  let set0 = 0,
    set1 = 0,
    setN = 0;

  for (const it of items) {
    const clients = it.clients ?? [];
    const names = it.clientNames ?? [];

    let chosenRef = null;
    if (clients.length === 1) {
      chosenRef = clients[0]._ref;
      set1++;
    } else if (clients.length >= 2) {
      const pickName = picks.get(it._id);
      const idx = names.findIndex((n) => n === pickName);
      if (idx === -1) {
        console.error(`  ! ${it._id}: pick "${pickName}" not found in ${JSON.stringify(names)}`);
        continue;
      }
      chosenRef = clients[idx]._ref;
      setN++;
    } else {
      set0++;
    }

    const patch = client.patch(it._id).unset(["clients"]);
    if (chosenRef) {
      patch.set({ client: { _type: "reference", _ref: chosenRef } });
    }

    if (DRY) {
      console.log(
        `[dry] ${it._id} (${it.title ?? "untitled"}): ${
          chosenRef ? `client=${chosenRef}` : "clear clients"
        }`
      );
    } else {
      await patch.commit();
      console.log(
        `✓ ${it._id} (${it.title ?? "untitled"}): ${chosenRef ? `client=${chosenRef}` : "cleared"}`
      );
    }
  }

  console.log(
    `\nSummary: ${set0} cleared, ${set1} single, ${setN} resolved-from-multi.${
      DRY ? " (no writes — rerun without --dry)" : ""
    }`
  );
}

// ─── Entry ───

if (MODE === "report") await report();
else if (MODE === "extract") await extract();
else await apply();
