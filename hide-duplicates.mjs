/**
 * One-off: hide the two duplicate media docs identified in the section-A
 * cluster of `find-duplicates.mjs`. Sets hidden=true on the published
 * documents so the site stops rendering them. Recoverable — does not
 * delete anything.
 *
 * Usage: node hide-duplicates.mjs
 */

import { client } from "./_lib/client.mjs";

const TARGETS = [
  {
    id: "7mjU0yz80uDwg9aWdVaBah",
    title: "Trail to Adams",
    reason: "Lower-res duplicate of DSC02541 (kept: 'Hiking Toward Mount Rainier')",
  },
  {
    id: "InGy1tGbVVMmNbCJ9TPshW",
    title: "Colorful Painted Hills Canyon",
    reason: "Duplicate of DSC00491 (kept: 'Colorful Mineral Canyon Landscape')",
  },
];

async function main() {
  for (const t of TARGETS) {
    const before = await client.fetch(`*[_id == $id][0]{_id, title, hidden}`, {
      id: t.id,
    });
    if (!before) {
      console.log(`✗ ${t.id} — not found`);
      continue;
    }
    if (before.title !== t.title) {
      console.log(
        `✗ ${t.id} — title mismatch: expected "${t.title}", got "${before.title}". Skipping for safety.`
      );
      continue;
    }
    if (before.hidden === true) {
      console.log(`• ${t.id} "${t.title}" — already hidden, no change`);
      continue;
    }
    await client.patch(t.id).set({ hidden: true }).commit();
    console.log(`✓ ${t.id} "${t.title}" — hidden=true  (${t.reason})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
