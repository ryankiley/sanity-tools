import { readFileSync, readdirSync } from "fs";
import { join, basename, extname } from "path";
import pLimit from "p-limit";
import { client } from "./_lib/client.mjs";

const DIR = process.env.HOME + "/Desktop/Goat Rocks Wilderness WA";
const PHOTOGRAPHY_CAT = "Ptdpyhb5YlpWpmyfLFYehK";
const LANDSCAPE_TAG = "0289cc25-446d-48fe-8bd6-595954b6a543";

// Goat Rocks Wilderness, WA
const GEO = { _type: "geopoint", lat: 46.49, lng: -121.49 };

// Sanity defaults `lqip` + `palette`; explicit `location` + `exif` pick up
// GPS and camera metadata from the JPEG header at upload time.
const EXTRACT = ["lqip", "palette", "location", "exif"];

const limit = pLimit(5);

const files = readdirSync(DIR).filter((f) => {
  const ext = extname(f).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
});

console.log(`Uploading ${files.length} images from Goat Rocks Wilderness WA...\n`);

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

      await client.create({
        _type: "media",
        title: `Goat Rocks ${name}`,
        mediaType: "image",
        altText: "Goat Rocks Wilderness, Washington",
        image: {
          _type: "image",
          asset: { _type: "reference", _ref: asset._id },
        },
        categories: [{ _type: "reference", _ref: PHOTOGRAPHY_CAT, _key: "photography" }],
        tags: [{ _type: "reference", _ref: LANDSCAPE_TAG, _key: "landscape" }],
        location: GEO,
        featured: false,
        hidden: false,
      });

      success++;
      console.log(`  [${success}/${files.length}] ${file}`);
    } catch (err) {
      console.error(`  FAIL ${file}: ${err.message}`);
    }
  })
);

await Promise.all(tasks);

console.log(`\nDone. ${success}/${files.length} uploaded.`);
