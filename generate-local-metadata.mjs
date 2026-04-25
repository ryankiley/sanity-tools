import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, extname, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import exifr from "exifr";
import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";

// Load .env for ANTHROPIC_API_KEY from the repo root (same level as this script).
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, ".env");
if (existsSync(envPath)) {
  const envLines = readFileSync(envPath, "utf8").split("\n");
  for (const line of envLines) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }
}

const anthropic = new Anthropic();

const LOCAL_DIR = process.env.HOME + "/Desktop/export";
const CURATION_FILE = join(LOCAL_DIR, "curation.json");
const OUTPUT_FILE = join(LOCAL_DIR, "metadata.json");

// Load dropped filenames
const curation = JSON.parse(readFileSync(CURATION_FILE, "utf8"));
const droppedSet = new Set(curation.dropped.map((d) => d.filename));

// Get all image files, exclude drops
const allFiles = readdirSync(LOCAL_DIR).filter((f) => {
  const ext = extname(f).toLowerCase();
  return [".jpg", ".jpeg", ".png"].includes(ext);
});
const keepers = allFiles.filter((f) => !droppedSet.has(f));
console.log(
  `Total files: ${allFiles.length}, Dropped: ${droppedSet.size}, Keepers: ${keepers.length}`
);

// Load existing output for resume capability
let existing = [];
if (existsSync(OUTPUT_FILE)) {
  try {
    const content = readFileSync(OUTPUT_FILE, "utf8").trim();
    if (content) existing = JSON.parse(content);
  } catch {
    existing = [];
  }
}
const doneSet = new Set(existing.map((e) => e.filename));
const todo = keepers.filter((f) => !doneSet.has(f));
console.log(`Already done: ${doneSet.size}, Remaining: ${todo.length}\n`);

let success = 0;
let fail = 0;

for (const filename of todo) {
  const filePath = join(LOCAL_DIR, filename);

  try {
    const imageBuffer = readFileSync(filePath);

    // Extract EXIF from original before resizing
    let dateStr = null;
    let gps = null;
    try {
      const exif = await exifr.parse(imageBuffer, [
        "DateTimeOriginal",
        "CreateDate",
        "GPSLatitude",
        "GPSLongitude",
      ]);
      if (exif?.DateTimeOriginal || exif?.CreateDate) {
        const d = new Date(exif.DateTimeOriginal || exif.CreateDate);
        if (!isNaN(d.getTime())) {
          dateStr = d.toISOString().split("T")[0];
        }
      }
      if (exif?.latitude && exif?.longitude) {
        gps = { lat: exif.latitude, lng: exif.longitude };
      }
    } catch {
      // EXIF failed, continue without
    }

    // Resize for Claude Vision API (max 5MB base64 = ~3.75MB file)
    const resized = await sharp(imageBuffer)
      .resize(1500, 1500, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    const base64 = resized.toString("base64");

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: base64 },
            },
            {
              type: "text",
              text: `Analyze this photo and respond with ONLY valid JSON (no markdown, no backticks):
{"title": "Short title 2-6 words", "altText": "Detailed description for screen readers, 1-2 sentences", "caption": "Brief 3-7 word caption", "category": "photography", "tags": []}

For category, pick ONE: "photography" (default for landscapes, nature, travel, life moments), "design" (architecture, interior design, typography, objects, products, furniture), or "music" (concerts, live performances).

For tags, pick any that apply from this exact list: "Architecture", "Concert", "Installation", "Landscape", "Product Design", "Typography". Leave empty [] if none fit well.

If the image shows a house number or address, include it in the title.`,
            },
          ],
        },
      ],
    });

    const text = response.content[0].text.trim();
    let meta;
    try {
      meta = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        meta = JSON.parse(match[0]);
      } else {
        throw new Error(`Could not parse JSON: ${text.slice(0, 100)}`);
      }
    }

    const entry = {
      filename,
      title: meta.title || "Untitled",
      altText: meta.altText || "Portfolio image",
      caption: meta.caption || "",
      category: meta.category || "photography",
      tags: meta.tags || [],
      date: dateStr,
      gps,
    };

    existing.push(entry);
    success++;

    // Save every 10 images
    if (success % 10 === 0) {
      writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
    }

    const pct = (((doneSet.size + success) / keepers.length) * 100).toFixed(0);
    console.log(
      `  [${doneSet.size + success}/${keepers.length}] (${pct}%) ${filename.slice(0, 25)}… → "${entry.title}"`
    );
  } catch (err) {
    fail++;
    console.error(`  FAIL ${filename.slice(0, 25)}…: ${err.message.slice(0, 80)}`);
  }

  // Rate limit: 200ms between API calls
  await new Promise((r) => setTimeout(r, 200));
}

// Final save
writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
console.log(
  `\n=== Done. Success: ${success}, Failed: ${fail}, Total in output: ${existing.length} ===\n`
);
