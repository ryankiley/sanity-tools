/**
 * One-off: find compositionally identical image assets in the Sanity
 * dataset. "Identical" = same blurHash (perceptual), same size+dimensions
 * (likely byte-equivalent), or matching lqip prefix (visual after
 * re-encode). Reports clusters with the media docs that reference each
 * asset so cleanup decisions are obvious.
 *
 * Read-only — does not mutate or delete anything.
 *
 * Usage: node find-duplicates.mjs
 */

import { client } from "./_lib/client.mjs";

const ASSETS_QUERY = `*[_type == "sanity.imageAsset"]{
  _id,
  originalFilename,
  size,
  "width": metadata.dimensions.width,
  "height": metadata.dimensions.height,
  "blurHash": metadata.blurHash,
  "lqip": metadata.lqip,
  "palette": metadata.palette.dominant.background
}`;

const MEDIA_USERS_QUERY = `*[_type == "media" && !(_id in path("drafts.**")) && defined(image.asset._ref)]{
  _id,
  title,
  hidden,
  "ref": image.asset._ref,
  "captionText": pt::text(caption)
}`;

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const k = keyFn(item);
    if (k == null || k === "") continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

function clusters(map, minCount = 2) {
  return [...map.entries()].filter(([, list]) => list.length >= minCount);
}

function fmtAsset(a, usersByRef) {
  const users = usersByRef.get(a._id) ?? [];
  const userLines = users.length
    ? users
        .map(
          (u) =>
            `      ↳ ${u._id}  ${u.hidden ? "[hidden] " : ""}"${u.title ?? "(untitled)"}"` +
            (u.captionText ? `\n          caption: "${u.captionText}"` : "")
        )
        .join("\n")
    : "      (no media doc references this asset — orphaned)";
  return (
    `    ${a._id}\n` +
    `      ${a.originalFilename ?? "(no filename)"}  ` +
    `${a.width}×${a.height}  ${(a.size / 1024).toFixed(0)}KB\n` +
    userLines
  );
}

async function main() {
  console.log("Fetching all image assets…");
  const assets = await client.fetch(ASSETS_QUERY);
  console.log(`  ${assets.length} assets\n`);

  console.log("Fetching all published media → asset references…");
  const mediaUsers = await client.fetch(MEDIA_USERS_QUERY);
  const usersByRef = groupBy(mediaUsers, (m) => m.ref);
  console.log(`  ${mediaUsers.length} media docs reference assets\n`);

  // ── Cluster 1: exact blurHash match (perceptual identity) ──────────────
  const byBlurHash = groupBy(assets, (a) => a.blurHash);
  const blurHashDupes = clusters(byBlurHash);

  // ── Cluster 2: exact (size, width, height) match ──────────────────────
  // Strong signal independent of blurHash — catches re-uploads where
  // metadata regenerated but the underlying file is byte-identical.
  const bySizeDim = groupBy(assets, (a) =>
    a.size && a.width && a.height ? `${a.size}|${a.width}x${a.height}` : null
  );
  const sizeDimDupes = clusters(bySizeDim);

  // ── Cluster 3: exact lqip match (visual after re-encode) ───────────────
  // Two assets that re-encode to the same ~20px placeholder are visually
  // indistinguishable. Catches cases where blurHash recomputed differently.
  const byLqip = groupBy(assets, (a) => a.lqip);
  const lqipDupes = clusters(byLqip);

  // ── Union all clusters into one set keyed by sorted asset-id pair ─────
  const seen = new Set();
  const merged = [];
  const addCluster = (signal, ids, list) => {
    const key = [...ids].sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ signal, list });
  };

  for (const [, list] of blurHashDupes) {
    addCluster(
      "blurHash",
      list.map((a) => a._id),
      list
    );
  }
  for (const [, list] of sizeDimDupes) {
    addCluster(
      "size+dim",
      list.map((a) => a._id),
      list
    );
  }
  for (const [, list] of lqipDupes) {
    addCluster(
      "lqip",
      list.map((a) => a._id),
      list
    );
  }

  console.log("─".repeat(70));
  console.log(
    `RESULTS: ${merged.length} duplicate cluster(s) across ${assets.length} assets`
  );
  console.log("─".repeat(70));
  console.log();

  if (merged.length === 0) {
    console.log("No compositionally identical image assets found. ✓");
    return;
  }

  let i = 1;
  for (const { signal, list } of merged) {
    const totalUsers = list.reduce(
      (n, a) => n + (usersByRef.get(a._id)?.length ?? 0),
      0
    );
    console.log(
      `Cluster ${i++}  [${signal}]  ${list.length} assets, ${totalUsers} media doc(s)`
    );
    for (const a of list) console.log(fmtAsset(a, usersByRef));
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
