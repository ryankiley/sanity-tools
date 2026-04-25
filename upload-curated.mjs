import { readFileSync } from "fs";
import { join } from "path";
import exifr from "exifr";
import pLimit from "p-limit";
import { client } from "./_lib/client.mjs";

// ─── Edit before running ──────────────────────────────────────────────
//
// EXPORT_DIR holds the image files. CURATION_FILE describes which ones
// to upload and what metadata to attach. Expected curation.json shape:
//
// {
//   "keepers": [
//     {
//       "filename": "_DSC1234.jpg",
//       "title": "Short title",
//       "altText": "Detailed alt text for screen readers",
//       "caption": "Brief caption shown on the site",
//       "folder": "optional-folder-grouping"   // used by your own
//                                              // routing rules below
//     }
//     // …
//   ]
// }
//
// EXIF (date + GPS) is read from each file at upload time. Add or
// remove your own grouping rules in the `categories` block.

const EXPORT_DIR = process.env.HOME + "/Desktop/export";
const CURATION_FILE = join(EXPORT_DIR, "curation.json");

// ──────────────────────────────────────────────────────────────────────

// Sanity defaults `lqip` + `palette`; explicit `location` + `exif` pick up
// GPS and camera metadata from the JPEG header at upload time.
const EXTRACT = ["lqip", "palette", "location", "exif"];

const limit = pLimit(5);

async function findOrCreateCategory(slug) {
  const existing = await client.fetch(`*[_type == "category" && slug.current == $slug][0]`, {
    slug,
  });
  if (existing) return existing._id;
  const doc = await client.create({
    _type: "category",
    title: slug.charAt(0).toUpperCase() + slug.slice(1),
    slug: { _type: "slug", current: slug },
  });
  console.log(`  Created category: ${slug} (${doc._id})`);
  return doc._id;
}

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

async function run() {
  const curation = JSON.parse(readFileSync(CURATION_FILE, "utf8"));
  const keepers = curation.keepers;

  console.log(`\n=== Upload: ${keepers.length} keepers ===\n`);

  // Pre-resolve the default category. Add more here if your curation.json
  // assigns documents to multiple categories — the keeper.folder field
  // (or any other field you add) is yours to route on.
  const defaultCatId = await findOrCreateCategory("photography");
  console.log(`  Default category: ${defaultCatId}\n`);

  let uploaded = 0;
  let failed = 0;

  const tasks = keepers.map((keeper) =>
    limit(async () => {
      const filePath = join(EXPORT_DIR, keeper.filename);

      try {
        const imageBuffer = readFileSync(filePath);

        // Extract EXIF date
        let dateStr = null;
        try {
          const exif = await exifr.parse(imageBuffer, ["DateTimeOriginal"]);
          if (exif?.DateTimeOriginal) {
            const d = new Date(exif.DateTimeOriginal);
            dateStr = d.toISOString().split("T")[0]; // YYYY-MM-DD
          }
        } catch {
          // EXIF extraction failed, skip date
        }

        // Upload asset
        const asset = await client.assets.upload("image", imageBuffer, {
          filename: keeper.filename,
          extract: EXTRACT,
        });

        const categories = [
          {
            _type: "reference",
            _ref: defaultCatId,
            _key: "default",
          },
        ];

        // Build document
        const doc = {
          _type: "media",
          title: keeper.title,
          mediaType: "image",
          altText: keeper.altText,
          caption: makePortableText(keeper.caption),
          image: {
            _type: "image",
            asset: { _type: "reference", _ref: asset._id },
          },
          categories,
          featured: false,
          hidden: false,
        };

        // Add location if GPS available
        if (keeper.gps && keeper.gps.lat && keeper.gps.lng) {
          doc.location = {
            _type: "geopoint",
            lat: keeper.gps.lat,
            lng: keeper.gps.lng,
          };
        }

        // Add date if extracted
        if (dateStr) {
          doc.date = dateStr;
        }

        await client.create(doc);
        uploaded++;
        console.log(`  [${uploaded}/${keepers.length}] ${keeper.filename} → "${keeper.title}"`);
      } catch (err) {
        failed++;
        console.error(`  FAIL ${keeper.filename}: ${err.message}`);
      }
    })
  );

  await Promise.all(tasks);

  console.log(`\n=== Done. Uploaded: ${uploaded}, Failed: ${failed} ===\n`);
}

run();
