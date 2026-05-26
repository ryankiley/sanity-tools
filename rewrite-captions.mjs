import { readFileSync, writeFileSync, existsSync } from "fs";
import Anthropic from "@anthropic-ai/sdk";
import { client } from "./_lib/client.mjs"; // also loads .env at import time

// ─── Config ───
const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 10;
const PROGRESS_FILE = "caption-rewrite-progress.json";
const LOG_FILE = "caption-rewrites.json";

const anthropic = new Anthropic();

// ─── System prompt ───
//
// This rubric drives the rewrite. It's intentionally generic — replace it with
// your own voice rules to make the output sound like *you* wrote the captions.
// The Anti-patterns and By-item-type sections are usable as-is; the Voice &
// Tone and Personal Context sections are the ones to personalize.
const SYSTEM_PROMPT = `You are rewriting captions for a personal portfolio website. The captions currently sound like AI-generated alt text or stock photo descriptions. Rewrite each one so it sounds like a person wrote it casually — warm, specific, not poetic or corporate.

## Voice & Tone
- First person when natural ("I designed this with…", "One of my favorite trails")
- Casual and genuine, like an Instagram caption or describing the photo to a friend
- Specific over generic. A place name beats "a landscape".

## Personal Context
- (Customize this section: your name, partner/family/pets you reference, employers, recurring places.)

## Length
- **Exactly one sentence.** Never two. Never three.
- The captions you're replacing already over-pack the second sentence with vibes-filler — don't reintroduce that.
- Don't force length — a simple object or texture might just need a few words.

## By item type

**rich** (caption already contains links): preserve ALL links as markdown. Improve flow and fix grammar but do NOT overwrite intentional phrasing — these were hand-written.

**work** (has client attribution): professional design / collaboration work. What it is, who it was for, what was notable. Stay grounded.

**personal** (photography, misc): don't describe what the viewer can already see. Add context — where it was, what was happening, a sense of place. If the current caption is just alt-text restated, rewrite from scratch. Use coordinates to infer place names if available.

## Anti-patterns — never use these
- "pristine", "nestled", "majestic", "serene", "capturing the essence", "bathed in light"
- Sentence fragments that read like stock photo tags ("Mountain vista at sunset")
- Starting with "A" + adjective + noun ("A pristine alpine lake…")
- Over-description — the photo itself shows what it looks like
- **Vibes-padding closers** — generic emotional/aesthetic statements tacked on after a real observation. Examples to never produce: "Pure Pacific Northwest magic", "Nature's timing is always impeccable", "Worth every step of the scramble", "The light up there is unlike anywhere else", "The colors come from millions of years…", "Always worth it for views like this", "Sometimes the simplest compositions hit the hardest"
- **"Label. Observation."** as two sentences. If both halves are good, fold them into one sentence ("The tiny door at the Oslo Opera House"). If only one is good, drop the other.

## Examples (replace with your own voice)

Before: "Alpine meadow hiking trail"
After: "Hiking through the meadows on the PCT."

Before: "Airplane wing at sunset"
After: "Somewhere over the Pacific."

Before: "A pristine alpine lake with striking turquoise waters sits nestled beneath snow-streaked granite peaks"
After: "Alpine lake on the climb up the pass."

## If a caption is already good
If the existing caption sounds personal, specific, and intentional — return it unchanged with preserveExisting: true. Don't rewrite for the sake of rewriting.

## Output format
Respond with ONLY a JSON array. Each element:
{ "id": "document_id", "caption": "new caption text with [links](url) if applicable", "preserveExisting": false }

Set preserveExisting: true and return the original caption text if it should stay as-is.`;

// ─── Resume state ───
const completed = existsSync(PROGRESS_FILE) ? JSON.parse(readFileSync(PROGRESS_FILE, "utf8")) : [];
const completedSet = new Set(completed);

const log = existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE, "utf8")) : [];

// ─── Fetch all non-hidden media ───
console.log("Fetching media documents...");
const allItems = await client.fetch(`
  *[_type == "media" && hidden != true] {
    _id,
    title,
    altText,
    mediaType,
    date,
    "captionText": caption[0].children[0].text,
    "captionFull": caption,
    "hasLinks": count(caption[].markDefs[_type == "link"]) > 0,
    "clients": clients[]->name,
    "tags": tags[]->name,
    "categories": categories[]->name,
    "lat": location.lat,
    "lng": location.lng
  } | order(title asc)
`);

// Filter out already-processed
const items = allItems.filter((i) => !completedSet.has(i._id));
console.log(
  `${allItems.length} total non-hidden items. ${items.length} remaining (${completedSet.size} already done).`
);
if (DRY_RUN) console.log("── DRY RUN — no Sanity patches will be made ──\n");

// ─── Classify ───
function classify(item) {
  if (item.hasLinks) return "rich";
  if (item.clients?.filter(Boolean).length > 0) return "work";
  return "personal";
}

// ─── Extract caption text (handles rich captions with links) ───
function extractCaptionWithLinks(item) {
  if (!item.captionFull?.length) return item.captionText || "";
  if (!item.hasLinks) return item.captionText || "";

  // Reconstruct text with markdown links
  const block = item.captionFull[0];
  if (!block?.children) return item.captionText || "";

  const markDefs = block.markDefs || [];
  const markMap = Object.fromEntries(markDefs.map((m) => [m._key, m.href]));

  return block.children
    .map((child) => {
      const linkMark = child.marks?.find((m) => markMap[m]);
      if (linkMark) return `[${child.text}](${markMap[linkMark]})`;
      return child.text;
    })
    .join("");
}

// ─── Build metadata string for a single item ───
function buildItemContext(item) {
  const type = classify(item);
  const parts = [`id: ${item._id}`, `type: ${type}`];
  if (item.title) parts.push(`title: ${item.title}`);
  if (item.altText) parts.push(`altText: ${item.altText}`);

  const captionStr = extractCaptionWithLinks(item);
  if (captionStr) parts.push(`currentCaption: ${captionStr}`);

  if (item.clients?.filter(Boolean).length)
    parts.push(`clients: ${item.clients.filter(Boolean).join(", ")}`);
  if (item.tags?.filter(Boolean).length)
    parts.push(`tags: ${item.tags.filter(Boolean).join(", ")}`);
  if (item.categories?.filter(Boolean).length)
    parts.push(`categories: ${item.categories.filter(Boolean).join(", ")}`);
  if (item.date) parts.push(`date: ${item.date}`);
  if (item.lat && item.lng) parts.push(`location: ${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}`);
  if (item.mediaType) parts.push(`mediaType: ${item.mediaType}`);

  return parts.join("\n");
}

// ─── Process batches ───
const batches = [];
for (let i = 0; i < items.length; i += BATCH_SIZE) {
  batches.push(items.slice(i, i + BATCH_SIZE));
}

console.log(`Processing ${batches.length} batches of up to ${BATCH_SIZE}...\n`);

let patchCount = 0;
let preserveCount = 0;
let failCount = 0;

for (let bi = 0; bi < batches.length; bi++) {
  const batch = batches[bi];
  const batchContext = batch
    .map((item, i) => `--- Item ${i + 1} ---\n${buildItemContext(item)}`)
    .join("\n\n");

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Rewrite the captions for these ${batch.length} items:\n\n${batchContext}`,
        },
      ],
    });

    const text = response.content[0].text.trim();
    // Parse JSON — handle possible markdown code fences
    const jsonStr = text.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    let results;
    try {
      results = JSON.parse(jsonStr);
    } catch {
      console.log(`  BATCH ${bi + 1}/${batches.length} — JSON parse failed, retrying...`);
      console.log(`  Raw response: ${text.slice(0, 200)}...`);
      failCount += batch.length;
      continue;
    }

    // Process results
    for (const result of results) {
      const item = batch.find((i) => i._id === result.id);
      if (!item) {
        console.log(`  WARN: no matching item for id ${result.id}`);
        continue;
      }

      const before = extractCaptionWithLinks(item);

      if (result.preserveExisting) {
        preserveCount++;
        log.push({ id: item._id, title: item.title, before, after: before, preserved: true });
        completedSet.add(item._id);
        completed.push(item._id);
        continue;
      }

      const captionBlocks = markdownToPortableText(result.caption);

      if (!DRY_RUN) {
        await client.patch(item._id).set({ caption: captionBlocks }).commit();
      }

      patchCount++;
      log.push({
        id: item._id,
        title: item.title,
        before,
        after: result.caption,
        preserved: false,
      });
      completedSet.add(item._id);
      completed.push(item._id);
    }

    // Save progress after each batch
    writeFileSync(PROGRESS_FILE, JSON.stringify(completed, null, 2));
    writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));

    const preserved = results.filter((r) => r.preserveExisting).length;
    const rewritten = results.length - preserved;
    console.log(
      `  Batch ${bi + 1}/${batches.length}: ${rewritten} rewritten, ${preserved} preserved`
    );

    // Small delay to avoid rate limits
    if (bi < batches.length - 1) await sleep(300);
  } catch (err) {
    console.log(`  BATCH ${bi + 1}/${batches.length} FAILED: ${err.message}`);
    failCount += batch.length;
    // Save progress even on failure
    writeFileSync(PROGRESS_FILE, JSON.stringify(completed, null, 2));
    writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
  }
}

console.log(`\nDone. ${patchCount} rewritten, ${preserveCount} preserved, ${failCount} failed.`);
if (DRY_RUN) console.log(`Review results in ${LOG_FILE}`);

// ─── Helpers ───

function markdownToPortableText(text) {
  // Parse markdown links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const children = [];
  const markDefs = [];
  let lastIndex = 0;

  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    // Text before the link
    if (match.index > lastIndex) {
      children.push({
        _type: "span",
        _key: crypto.randomUUID().slice(0, 12),
        marks: [],
        text: text.slice(lastIndex, match.index),
      });
    }

    // The link itself
    const markKey = crypto.randomUUID().slice(0, 12);
    markDefs.push({ _key: markKey, _type: "link", href: match[2] });
    children.push({
      _type: "span",
      _key: crypto.randomUUID().slice(0, 12),
      marks: [markKey],
      text: match[1],
    });

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last link
  if (lastIndex < text.length) {
    children.push({
      _type: "span",
      _key: crypto.randomUUID().slice(0, 12),
      marks: [],
      text: text.slice(lastIndex),
    });
  }

  // If no children (empty text), add one empty span
  if (children.length === 0) {
    children.push({
      _type: "span",
      _key: crypto.randomUUID().slice(0, 12),
      marks: [],
      text: text,
    });
  }

  return [
    {
      _type: "block",
      _key: crypto.randomUUID().slice(0, 12),
      style: "normal",
      markDefs,
      children,
    },
  ];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
