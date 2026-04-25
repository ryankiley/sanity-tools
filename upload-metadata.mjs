import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import pLimit from "p-limit";
import { client } from "./_lib/client.mjs";

// Sanity defaults `lqip` + `palette`; explicit `location` + `exif` pick up
// GPS and camera metadata from the JPEG header at upload time.
const EXTRACT = ["lqip", "palette", "location", "exif"];

const limit = pLimit(5);

const VSCO_DIR = process.env.HOME + "/Desktop/vsco-export";
const METADATA_FILE = join(VSCO_DIR, "vsco-metadata.json");
const PROGRESS_FILE = join(VSCO_DIR, "upload-progress.json");

// Category slug → ID map (pre-resolved)
const CATEGORY_IDS = {
  photography: "Ptdpyhb5YlpWpmyfLFYehK",
  design: "XxZB18NiqQk5anY3nsXgtY",
  music: "9jnWCVUr22zAohJhhhlYqg",
};

// Tag title → ID map (existing tags in Sanity)
const TAG_IDS = {
  Architecture: "09ba63ca-ad98-4289-9778-c5c22de5a85a",
  Concert: "d9ac7312-9b0c-4f70-a41f-0bb5fe435e64",
  Installation: "a2801107-450a-4607-8a3f-f6773ef77b0c",
  Landscape: "0289cc25-446d-48fe-8bd6-595954b6a543",
  "Product Design": "Ptdpyhb5YlpWpmyfLKjmek",
  Typography: "bx1cBMKjJVNpkBbeQS1rg8",
  Branding: "XxZB18NiqQk5anY3nytFw8",
  Website: "62f323f1-982c-483a-b791-8844f6867db7",
};

function makePortableText(text) {
  return [
    {
      _type: "block",
      _key: crypto.randomUUID().slice(0, 12),
      style: "normal",
      markDefs: [],
      children: [
        {
          _type: "span",
          _key: crypto.randomUUID().slice(0, 12),
          marks: [],
          text,
        },
      ],
    },
  ];
}

// Special Portable Text with a hyperlink for the 6112 house number image
function makeLinkedCaption(text, linkText, href) {
  const linkKey = crypto.randomUUID().slice(0, 12);
  return [
    {
      _type: "block",
      _key: crypto.randomUUID().slice(0, 12),
      style: "normal",
      markDefs: [
        {
          _type: "link",
          _key: linkKey,
          href,
        },
      ],
      children: [
        {
          _type: "span",
          _key: crypto.randomUUID().slice(0, 12),
          marks: [],
          text: text + " by ",
        },
        {
          _type: "span",
          _key: crypto.randomUUID().slice(0, 12),
          marks: [linkKey],
          text: linkText,
        },
      ],
    },
  ];
}

async function run() {
  const metadata = JSON.parse(readFileSync(METADATA_FILE, "utf8"));

  // Load progress for resume
  let uploaded = new Set();
  if (existsSync(PROGRESS_FILE)) {
    try {
      const content = readFileSync(PROGRESS_FILE, "utf8").trim();
      if (content) uploaded = new Set(JSON.parse(content));
    } catch {
      uploaded = new Set();
    }
  }

  const todo = metadata.filter((m) => !uploaded.has(m.filename));
  console.log(
    `\n=== Upload VSCO: ${metadata.length} total, ${uploaded.size} done, ${todo.length} remaining ===\n`
  );

  let success = 0;
  let failed = 0;

  const tasks = todo.map((entry) =>
    limit(async () => {
      const filePath = join(VSCO_DIR, entry.filename);

      try {
        const imageBuffer = readFileSync(filePath);

        // Upload asset
        const asset = await client.assets.upload("image", imageBuffer, {
          filename: entry.filename,
          extract: EXTRACT,
        });

        // Build categories array
        const catSlug = entry.category || "photography";
        const catId = CATEGORY_IDS[catSlug] || CATEGORY_IDS.photography;
        const categories = [{ _type: "reference", _ref: catId, _key: catSlug }];

        // Build tags array from AI-generated tags
        const tags = [];
        for (const tagName of entry.tags || []) {
          const tagId = TAG_IDS[tagName];
          if (tagId) {
            tags.push({
              _type: "reference",
              _ref: tagId,
              _key: tagName.toLowerCase().replace(/\s+/g, "-"),
            });
          }
        }

        // Detect 6112 house number image
        const is6112 =
          entry.title && (entry.title.includes("6112") || entry.title.includes("House Number"));

        // Build caption
        let caption;
        if (is6112) {
          caption = makeLinkedCaption("House numbers", "On End Studio", "https://onend.studio");
        } else {
          caption = makePortableText(entry.caption || entry.title);
        }

        // Build document
        const doc = {
          _type: "media",
          title: entry.title,
          mediaType: "image",
          altText: entry.altText,
          caption,
          image: {
            _type: "image",
            asset: { _type: "reference", _ref: asset._id },
          },
          categories,
          featured: false,
          hidden: false,
        };

        if (tags.length > 0) doc.tags = tags;

        // Add location if GPS available
        if (entry.gps && entry.gps.lat && entry.gps.lng) {
          doc.location = {
            _type: "geopoint",
            lat: entry.gps.lat,
            lng: entry.gps.lng,
          };
        }

        // Add date
        if (entry.date) doc.date = entry.date;

        await client.create(doc);
        uploaded.add(entry.filename);
        success++;

        // Save progress every 10 successes. With 5-way concurrency the
        // counter can tick past 10/20/... from multiple tasks in a burst,
        // producing a few extra writes — harmless (same content) and the
        // final write below guarantees completeness.
        if (success % 10 === 0) {
          writeFileSync(PROGRESS_FILE, JSON.stringify([...uploaded]));
        }

        const total = uploaded.size;
        const pct = ((total / metadata.length) * 100).toFixed(0);
        console.log(
          `  [${total}/${metadata.length}] (${pct}%) ${entry.filename.slice(0, 25)}… → "${entry.title}"${is6112 ? " [6112 SPECIAL]" : ""}`
        );
      } catch (err) {
        failed++;
        console.error(`  FAIL ${entry.filename.slice(0, 25)}…: ${err.message.slice(0, 80)}`);
      }
    })
  );

  await Promise.all(tasks);

  // Final save
  writeFileSync(PROGRESS_FILE, JSON.stringify([...uploaded]));
  console.log(
    `\n=== Done. Success: ${success}, Failed: ${failed}, Total uploaded: ${uploaded.size} ===\n`
  );
}

run();
