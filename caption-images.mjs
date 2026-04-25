import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { client } from "./_lib/client.mjs";

// Load .env from the repo root so ANTHROPIC_API_KEY reaches the SDK.
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const anthropic = new Anthropic();

// Fetch media items without captions
const items = await client.fetch(
  `*[_type == "media" && (caption == null || caption == "")]{
    _id, title, "imageUrl": image.asset->url
  } | order(title asc)`
);

console.log(`Found ${items.length} items without captions.\n`);

let success = 0;
let fail = 0;

for (const item of items) {
  if (!item.imageUrl) {
    console.log(`  SKIP (no image): ${item.title}`);
    fail++;
    continue;
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "url", url: item.imageUrl + "?w=2000" },
            },
            {
              type: "text",
              text: `Write a very short caption for this photo. 3-7 words max. Plain, descriptive, no poetry or metaphors. Like a photo album label. Examples: "Portland fog", "Crater Lake at dusk", "Brooklyn Bridge", "Concert crowd", "Alpine wildflowers". Just the caption, nothing else.`,
            },
          ],
        },
      ],
    });

    const caption = response.content[0].text.trim();

    await client
      .patch(item._id)
      .set({
        caption: [
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
                text: caption,
              },
            ],
          },
        ],
      })
      .commit();

    console.log(`  OK: ${item.title} → "${caption}"`);
    success++;
  } catch (err) {
    console.log(`  FAIL: ${item.title} — ${err.message}`);
    fail++;
  }
}

console.log(`\nDone. ${success} captioned, ${fail} failed.`);
