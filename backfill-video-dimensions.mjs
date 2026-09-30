#!/usr/bin/env node
// Backfill `videoWidth` / `videoHeight` on media docs that have a self-hosted
// video file. Sanity file assets carry no pixel dimensions (image assets do),
// so the frontend can't reserve the right box before `loadedmetadata`.
//
// For each published doc with `video.asset`, ffprobe the asset URL (first
// video stream, honouring a 90/270 rotate tag by swapping width/height) and
// patch the two fields only where they're missing or differ. Nothing else is
// touched: no drafts, no other fields, no document creation.
//
// Dry-run by default; pass --apply to write. Requires ffprobe on PATH (or set
// FFPROBE to its absolute path).

import { execFile } from "child_process";
import { promisify } from "util";
import { client } from "./_lib/client.mjs"; // also loads .env at import time

const APPLY = process.argv.includes("--apply");
const FFPROBE = process.env.FFPROBE || "ffprobe";
const execFileAsync = promisify(execFile);

const query = `*[_type == "media" && defined(video.asset) && !(_id in path("drafts.**"))]{
  _id,
  title,
  "url": video.asset->url,
  videoWidth,
  videoHeight
} | order(title asc)`;

async function probe(url) {
  const { stdout } = await execFileAsync(
    FFPROBE,
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height:stream_tags=rotate:stream_side_data=rotation",
      "-of", "json",
      url,
    ],
    { timeout: 60_000, maxBuffer: 1024 * 1024 },
  );
  const stream = JSON.parse(stdout).streams?.[0];
  if (!stream?.width || !stream?.height) throw new Error("no video stream with dimensions");

  // Rotation can live in a legacy `rotate` tag or in display-matrix side data
  // (newer ffmpeg reports the latter; sign can be negative). Either way a
  // quarter-turn means the displayed frame is the stored frame transposed.
  const tagRotate = Number(stream.tags?.rotate ?? 0);
  const sideRotate = Number(
    (stream.side_data_list || []).find((s) => s.rotation != null)?.rotation ?? 0,
  );
  const rotate = ((Math.round(tagRotate || sideRotate) % 360) + 360) % 360;
  const swap = rotate === 90 || rotate === 270;
  return {
    width: swap ? stream.height : stream.width,
    height: swap ? stream.width : stream.height,
    rotate,
  };
}

const docs = await client.fetch(query);
console.log(`Fetched ${docs.length} published media docs with a video file.\n`);

const rows = [];
const plans = [];
for (const d of docs) {
  const row = { id: d._id, title: d.title || "(untitled)", current: fmt(d.videoWidth, d.videoHeight) };
  if (!d.url) {
    rows.push({ ...row, probed: "-", action: "skip (no asset url)" });
    continue;
  }
  try {
    const { width, height, rotate } = await probe(d.url);
    row.probed = fmt(width, height) + (rotate ? ` (rot ${rotate})` : "");
    if (d.videoWidth === width && d.videoHeight === height) {
      rows.push({ ...row, action: "ok (matches)" });
    } else {
      const action = d.videoWidth == null && d.videoHeight == null ? "set" : "update";
      rows.push({ ...row, action });
      plans.push({ _id: d._id, width, height });
    }
  } catch (err) {
    const msg = (err.stderr || err.message || String(err)).trim().split("\n")[0];
    rows.push({ ...row, probed: "-", action: `skip (ffprobe: ${msg})` });
  }
}

printTable(rows);
console.log(`\nTo patch: ${plans.length}   unchanged: ${rows.filter((r) => r.action.startsWith("ok")).length}   skipped: ${rows.filter((r) => r.action.startsWith("skip")).length}`);

if (!APPLY) {
  console.log(`\nDry run. Re-run with --apply to write changes.`);
  process.exit(0);
}

if (plans.length === 0) {
  console.log(`\nNothing to apply.`);
  process.exit(0);
}

console.log(`\nApplying ${plans.length} patches...`);
let done = 0;
let failed = 0;
for (const p of plans) {
  try {
    await client
      .patch(p._id)
      .set({ videoWidth: p.width, videoHeight: p.height })
      .commit({ autoGenerateArrayKeys: false });
    done++;
    process.stdout.write(`  ${done}/${plans.length}\r`);
  } catch (err) {
    failed++;
    console.error(`\n  ${p._id} failed: ${err.message}`);
  }
}
console.log(`\nDone. ${done} patched, ${failed} failed.`);

function fmt(w, h) {
  return w == null && h == null ? "-" : `${w ?? "?"}x${h ?? "?"}`;
}

function printTable(rows) {
  const cols = [
    ["id", "id"],
    ["title", "title"],
    ["current", "current"],
    ["probed", "probed"],
    ["action", "action"],
  ];
  const widths = cols.map(([k, label]) =>
    Math.max(label.length, ...rows.map((r) => String(r[k]).length)),
  );
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ");
  console.log(line(cols.map(([, label]) => label)));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const r of rows) console.log(line(cols.map(([k]) => r[k])));
}
