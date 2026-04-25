/**
 * One-off audit fix:
 *
 *   1. Upgrade Instrument credit role `null → "Agency"` on two Airbnb items
 *      whose captions clearly indicate Instrument acted as the agency.
 *   2. Remove any "…at Instrument" / "Designed alongside … Instrument" /
 *      "for Instrument installation" phrasing from the caption on 11 items;
 *      the credit field now carries that attribution.
 *
 * USAGE:
 *   node audit-instrument-credits.mjs --dry
 *   node audit-instrument-credits.mjs --apply
 */

import { client } from "../_lib/client.mjs";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");

function blockFromText(text) {
  return [
    {
      _type: "block",
      _key: `trim-${Math.random().toString(36).slice(2, 10)}`,
      style: "normal",
      markDefs: [],
      children: [
        {
          _type: "span",
          _key: `trim-${Math.random().toString(36).slice(2, 10)}`,
          marks: [],
          text,
        },
      ],
    },
  ];
}

/**
 * Each entry:
 *   [ docId, newCaptionText, optional: { creditKey, role } to also set
 *     role on an existing credit array item by _key ]
 */
const EDITS = [
  // Part 1 docs (also get caption trim)
  [
    "Ptdpyhb5YlpWpmyfLFYOQI",
    "Marketing portfolio designed for Airbnb.",
    { creditKey: "migrated-1e23749d76b7", role: "Agency" },
  ],
  [
    "XxZB18NiqQk5anY3nsYFTU",
    "Marketing portfolio designed for Airbnb.",
    { creditKey: "migrated-1e23749d76b7", role: "Agency" },
  ],

  // Part 2 docs (caption trim only)
  ["Ptdpyhb5YlpWpmyfLFYNeo", "Marketing portfolio designed for Airbnb."],
  [
    "a9db0845-c38c-446f-b067-2d78f0b4b6cd",
    "Concepted, prototyped, and designed Google Cloud Emotobooth, a machine vision-powered photo booth enabled by Google\u2019s Cloud Vision API.",
  ],
  [
    "70010ec2-e369-4f2e-9948-f331c3853ba5",
    "Marketing and product website for the original Portal by Facebook.",
  ],
  ["Ptdpyhb5YlpWpmyfLFYb3m", "Interactive display wall in a Portland warehouse space."],
  ["Ptdpyhb5YlpWpmyfLKkI6Y", "Concept t-shirt."],
  [
    "3f9f2f06-1557-4f65-b4c4-64f85d8a2a3a",
    "Type and title design for John John Florence\u2019s \u201cTwelve\u201d series, episode 7. Work for Hurley.",
  ],
  [
    "d1dc7fd9-8ae7-4dd7-8008-d79f81039005",
    "Type and title design for John John Florence\u2019s \u201cTwelve\u201d series, episode 6. Work for Hurley.",
  ],
  [
    "XxZB18NiqQk5anY3nsYF3k",
    "Marketing dashboard. Clean data visualization for tracking brand performance across different markets.",
  ],
  ["9jnWCVUr22zAohJhhi9O1I", "Process work for rebranding Umpqua Bank."],
];

console.log(`${APPLY ? "Applying" : "DRY RUN"} ${EDITS.length} doc patch(es).\n`);

for (const [id, newText, role] of EDITS) {
  const newCaption = newText === "" ? [] : blockFromText(newText);
  const captionSummary =
    newText === "" ? "(empty)" : `"${newText.slice(0, 80)}${newText.length > 80 ? "…" : ""}"`;
  const roleSummary = role ? ` + credits[_key=="${role.creditKey}"].role = ${role.role}` : "";

  if (!APPLY) {
    console.log(`[dry] ${id} → caption ${captionSummary}${roleSummary}`);
    continue;
  }

  let patch = client.patch(id).set({ caption: newCaption });
  if (role) {
    patch = patch.set({ [`credits[_key=="${role.creditKey}"].role`]: role.role });
  }
  await patch.commit();
  console.log(`\u2713 ${id} → caption ${captionSummary}${roleSummary}`);
}

console.log(`\nDone.${APPLY ? "" : " (no writes \u2014 rerun with --apply)"}`);
