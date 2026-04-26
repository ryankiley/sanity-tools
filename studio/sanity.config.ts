import { defineConfig, isDev } from "sanity";
import { structureTool } from "sanity/structure";
import { presentationTool } from "sanity/presentation";
import { visionTool } from "@sanity/vision";
import { schemaTypes } from "./schemas";
import { structure, defaultDocumentNode } from "./structure";

// Preview URL — local dev by default; prod is set via
// SANITY_STUDIO_PREVIEW_URL env at build/deploy time.
const PREVIEW_URL = process.env.SANITY_STUDIO_PREVIEW_URL ?? "http://localhost:3000";

export default defineConfig({
  name: "ryankiley",
  title: "Ryan Kiley",
  projectId: "sn138nra",
  dataset: "production",
  plugins: [
    structureTool({ structure, defaultDocumentNode }),
    presentationTool({
      previewUrl: {
        origin: PREVIEW_URL,
        preview: "/",
        previewMode: {
          enable: "/api/preview/enable",
          disable: "/api/preview/disable",
        },
      },
    }),
    // Vision (GROQ playground) is a dev-time aid — hide in deployed
    // Studio so editors don't see a cryptic GROQ tab.
    ...(isDev ? [visionTool({ defaultApiVersion: "2026-04-09" })] : []),
  ],
  schema: {
    types: schemaTypes,
    // Pre-flip `mediaType` from the Create menu so conditional field
    // visibility (image/video/text branches) activates on new-doc
    // creation without an extra tap. Relevant on mobile where every
    // tap counts — see portfolio-product design principle #1.
    templates: (prev) => [
      ...prev,
      {
        id: "media-image",
        title: "Image",
        schemaType: "media",
        value: { mediaType: "image" },
      },
      {
        id: "media-video",
        title: "Video",
        schemaType: "media",
        value: { mediaType: "video" },
      },
      {
        id: "media-text",
        title: "Text",
        schemaType: "media",
        value: { mediaType: "text" },
      },
    ],
  },
});
