import { readFileSync, readdirSync } from "fs";
import { join, basename, extname } from "path";
import pLimit from "p-limit";
import { client } from "./_lib/client.mjs";

// ─── Edit before running ──────────────────────────────────────────────
//
// All four constants are placeholders. Replace with values that match
// your Sanity dataset and the folder you want to upload from. The
// category and tag refs must already exist in Sanity — query them
// with `*[_type == "category"]{_id, title}` etc. and paste the _id.

const DIR = process.env.HOME + "/Desktop/example-folder";
const CATEGORY_REF = "REPLACE_WITH_CATEGORY_DOC_ID";
const TAG_REF = "REPLACE_WITH_TAG_DOC_ID";
// Optional: a geopoint applied to every uploaded image. Set to null to skip.
const GEO = null; // e.g. { _type: "geopoint", lat: 46.49, lng: -121.49 }

const TITLE_PREFIX = ""; // optional prefix prepended to each filename-derived title
const ALT_TEXT = "";    // applied to every image — keep generic or empty

// ──────────────────────────────────────────────────────────────────────

// Sanity defaults `lqip` + `palette`; explicit `location` + `exif` pick up
// GPS and camera metadata from the JPEG header at upload time.
const EXTRACT = ["lqip", "palette", "location", "exif"];

const limit = pLimit(5);

const files = readdirSync(DIR).filter((f) => {
  const ext = extname(f).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
});

console.log(`Uploading ${files.length} images from ${DIR}...\n`);

let success = 0;

const tasks = files.map((file) =>
  limit(async () => {
    const filePath = join(DIR, file);
    const name = basename(file, extname(file));

    try {
      const imageBuffer = readFileSync(filePath);
      const asset = await client.assets.upload("image", imageBuffer, {
        filename: file,
        extract: EXTRACT,
      });

      const doc = {
        _type: "media",
        title: TITLE_PREFIX ? `${TITLE_PREFIX} ${name}` : name,
        mediaType: "image",
        altText: ALT_TEXT,
        image: {
          _type: "image",
          asset: { _type: "reference", _ref: asset._id },
        },
        categories: [{ _type: "reference", _ref: CATEGORY_REF, _key: "category" }],
        tags: [{ _type: "reference", _ref: TAG_REF, _key: "tag" }],
        featured: false,
        hidden: false,
      };

      if (GEO) doc.location = GEO;

      await client.create(doc);

      success++;
      console.log(`  [${success}/${files.length}] ${file}`);
    } catch (err) {
      console.error(`  FAIL ${file}: ${err.message}`);
    }
  })
);

await Promise.all(tasks);

console.log(`\nDone. ${success}/${files.length} uploaded.`);
