import Anthropic from "@anthropic-ai/sdk";
import { client } from "./_lib/client.mjs"; // also loads .env at import time

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
              text: `Write a one-sentence caption for this photo. Plain and observational — what's depicted, and where if obvious. 3-10 words. Never two sentences. Never add commentary, vibes, feelings, or aesthetic judgement (no "stunning", "magical", "worth the…", "best X of…", "nature's…", etc.). Like a photo album label. Examples: "Morning fog over the bay", "Lake at dusk", "Concert crowd", "Alpine wildflowers", "Empty parking lot". Just the caption, nothing else.`,
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
