/**
 * Migrate caption-embedded credit links into structured credits[].
 *
 * USAGE:
 *   node migrate-caption-credits.mjs --extract
 *     → Walks media docs, collects every { linkText, href } pair from
 *       caption link marks. Writes /tmp/credit-migration-review.json.
 *       You edit that file: fill in `role` where desired, delete rows
 *       that are NOT credits (e.g. project-page links).
 *
 *   node migrate-caption-credits.mjs --apply
 *     → Reads the edited review JSON. For each kept row:
 *         1. upsert a `collaborator` doc (deduped by lowercased name + host)
 *         2. append a credit { person, role? } to the media's credits[]
 *         3. strip the corresponding link markDef from the caption
 *            (text remains, mark is removed)
 *
 *   node migrate-caption-credits.mjs --apply --dry
 *     → Apply phase, but log what would happen without writing.
 *
 * Auth: uses Sanity CLI token from ~/.config/sanity/config.json.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { client } from "../_lib/client.mjs";

const REVIEW_PATH = "/tmp/credit-migration-review.json";

const args = new Set(process.argv.slice(2));
const MODE = args.has("--apply") ? "apply" : "extract";
const DRY = args.has("--dry");

// ─── Helpers ───

function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 96);
}

function normalizeHost(href) {
  if (!href) return null;
  try {
    return new URL(href).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function dedupeKey(name, href) {
  return `${name.toLowerCase().trim()}|${normalizeHost(href) ?? ""}`;
}

// Walk a portable-text block, return array of { markKey, href, text }
function extractLinksFromBlock(block) {
  if (block._type !== "block" || !block.markDefs?.length) return [];
  const linkDefs = Object.fromEntries(
    block.markDefs.filter((d) => d._type === "link").map((d) => [d._key, d.href])
  );
  const out = [];
  for (const child of block.children ?? []) {
    if (!child.marks?.length) continue;
    for (const markKey of child.marks) {
      if (markKey in linkDefs) {
        out.push({ markKey, href: linkDefs[markKey], text: child.text ?? "" });
      }
    }
  }
  return out;
}

// ─── Extract phase ───

async function extract() {
  // Skip text posts entirely — their inline links are press coverage
  // (e.g. "I spoke with It's Nice That"), not collaborator credits.
  // Only image/video posts' caption links are candidates for migration.
  const items = await client.fetch(
    `*[
      _type == "media"
      && mediaType != "text"
      && count(caption[_type == "block" && count(markDefs[_type == "link"]) > 0]) > 0
    ]{
      _id, title, mediaType, caption, "categories": categories[]->title
    }`
  );

  console.log(`Found ${items.length} image/video items with caption links.\n`);

  const rows = [];
  for (const item of items) {
    for (const block of item.caption ?? []) {
      for (const link of extractLinksFromBlock(block)) {
        rows.push({
          mediaId: item._id,
          title: item.title ?? "(untitled)",
          categories: item.categories ?? [],
          blockKey: block._key,
          markKey: link.markKey,
          linkText: link.text,
          href: link.href,
          role: null, // ← fill this in during review; leave null for bare credit
          keep: true, // ← set to false to skip this row during --apply
        });
      }
    }
  }

  writeFileSync(REVIEW_PATH, JSON.stringify(rows, null, 2));
  console.log(`Wrote ${rows.length} rows to ${REVIEW_PATH}`);
  console.log(`\nNext: open ${REVIEW_PATH}, fill in \`role\` where desired,`);
  console.log(`set \`keep: false\` on rows that are NOT credits, then run:`);
  console.log(`  node migrate-caption-credits.mjs --apply --dry`);
  console.log(`  node migrate-caption-credits.mjs --apply`);
}

// ─── Apply phase ───

async function apply() {
  if (!existsSync(REVIEW_PATH)) {
    console.error(`Missing ${REVIEW_PATH}. Run --extract first.`);
    process.exit(1);
  }

  const rows = JSON.parse(readFileSync(REVIEW_PATH, "utf8")).filter((r) => r.keep);
  console.log(`Applying ${rows.length} kept rows${DRY ? " (DRY RUN)" : ""}.\n`);

  // Step 1: upsert collaborators, dedupe by (name, host).
  const collaboratorCache = new Map(); // dedupeKey -> _id

  const existing = await client.fetch(`*[_type == "collaborator"]{_id, name, url}`);
  for (const c of existing) {
    collaboratorCache.set(dedupeKey(c.name, c.url ?? null), c._id);
  }

  async function upsertCollaborator(name, href) {
    const key = dedupeKey(name, href);
    if (collaboratorCache.has(key)) return collaboratorCache.get(key);

    const doc = {
      _type: "collaborator",
      name,
      slug: { _type: "slug", current: slugify(name) },
      ...(href ? { url: href } : {}),
    };
    if (DRY) {
      const fakeId = `dry-${key}`;
      collaboratorCache.set(key, fakeId);
      console.log(`  [dry] create collaborator "${name}" (${href ?? "no url"})`);
      return fakeId;
    }
    const created = await client.create(doc);
    collaboratorCache.set(key, created._id);
    console.log(`  + collaborator "${name}" → ${created._id}`);
    return created._id;
  }

  // Step 2: group rows by mediaId so each media doc patches once.
  const byMedia = new Map();
  for (const row of rows) {
    if (!byMedia.has(row.mediaId)) byMedia.set(row.mediaId, []);
    byMedia.get(row.mediaId).push(row);
  }

  for (const [mediaId, mediaRows] of byMedia) {
    const media = await client.getDocument(mediaId);
    if (!media) {
      console.warn(`  ! media ${mediaId} not found, skipping`);
      continue;
    }

    // Build credits additions + collect markKeys to strip per block.
    const creditAdditions = [];
    const stripByBlock = new Map(); // blockKey -> Set<markKey>

    for (const row of mediaRows) {
      const personId = await upsertCollaborator(row.linkText, row.href);
      creditAdditions.push({
        _type: "credit",
        _key: `migrated-${row.markKey}`,
        person: { _type: "reference", _ref: personId },
        ...(row.role ? { role: row.role } : {}),
      });
      if (!stripByBlock.has(row.blockKey)) stripByBlock.set(row.blockKey, new Set());
      stripByBlock.get(row.blockKey).add(row.markKey);
    }

    // Strip the matching link markDefs + the mark references on children.
    const newCaption = (media.caption ?? []).map((block) => {
      if (!stripByBlock.has(block._key)) return block;
      const stripSet = stripByBlock.get(block._key);
      return {
        ...block,
        markDefs: (block.markDefs ?? []).filter((d) => !stripSet.has(d._key)),
        children: (block.children ?? []).map((child) => ({
          ...child,
          marks: (child.marks ?? []).filter((m) => !stripSet.has(m)),
        })),
      };
    });

    if (DRY) {
      console.log(
        `  [dry] patch ${mediaId} (${media.title ?? "untitled"}): +${creditAdditions.length} credits, strip ${mediaRows.length} link marks`
      );
      continue;
    }

    await client
      .patch(mediaId)
      .setIfMissing({ credits: [] })
      .append("credits", creditAdditions)
      .set({ caption: newCaption })
      .commit();
    console.log(
      `  ✓ ${mediaId} (${media.title ?? "untitled"}): +${creditAdditions.length} credits`
    );
  }

  console.log(`\nDone.${DRY ? " (no writes — remove --dry to apply)" : ""}`);
}

// ─── Entry ───

if (MODE === "extract") {
  await extract();
} else {
  await apply();
}
