import { defineType } from "sanity";

export default defineType({
  name: "media",
  title: "Media",
  type: "document",
  groups: [
    { name: "content", title: "Content", default: true },
    { name: "attribution", title: "Attribution" },
    { name: "classification", title: "Classification" },
    { name: "metadata", title: "Metadata" },
  ],
  fields: [
    {
      name: "title",
      title: "Title",
      type: "string",
      group: "content",
      description: "Optional display name for this piece",
      validation: (rule) => rule.max(120),
    },
    {
      name: "mediaType",
      title: "Media Type",
      type: "string",
      group: "content",
      options: {
        list: [
          { title: "Text", value: "text" },
          { title: "Image", value: "image" },
          { title: "Video", value: "video" },
        ],
        layout: "radio",
      },
      initialValue: "text",
      validation: (rule) => rule.required(),
    },
    {
      name: "image",
      title: "Image",
      type: "image",
      group: "content",
      // Blurhash dropped 2026-04-23 — schema declared it but GROQ
      // didn't query it and uploads didn't `extract: ['blurhash']`.
      // LQIP already fills the blur-up role; if blurhash is wanted
      // later, re-add here and in the upload `extract` list.
      options: {
        hotspot: true,
        metadata: ["lqip", "palette", "location", "exif"],
      },
      hidden: ({ document }) => document?.mediaType !== "image",
      // Require alt at any level: field override, document-level
      // altText, or the asset's own altText. Asset-level lets shared
      // assets carry alt once rather than repeating per use.
      validation: (rule) =>
        rule.custom(async (value, context) => {
          if (!value?.asset) return true;
          if (context.document?.altText) return true;
          const client = context.getClient({ apiVersion: "2026-04-09" });
          const assetAlt = await client.fetch(`*[_id == $id][0].altText`, {
            id: value.asset._ref,
          });
          return assetAlt
            ? true
            : "Alt text required — on this field, the document's altText, or the asset itself.";
        }),
    },
    {
      name: "video",
      title: "Video File",
      type: "file",
      group: "content",
      options: {
        accept: "video/*",
      },
      description: "Drag and drop a video file",
      hidden: ({ document }) => document?.mediaType !== "video",
    },
    {
      name: "videoUrl",
      title: "External Video URL",
      type: "url",
      group: "content",
      description: "Optional — for Vimeo, YouTube, or other external URLs",
      hidden: ({ document }) => document?.mediaType !== "video",
      validation: (rule) => rule.uri({ allowRelative: false, scheme: ["http", "https"] }).max(2048),
    },
    {
      name: "videoStart",
      title: "Start Time",
      type: "string",
      group: "content",
      description: "Optional — e.g. 0:45, 1:30, or 1:13:32 for longer videos",
      hidden: ({ document }) => document?.mediaType !== "video",
      validation: (rule) =>
        rule
          .regex(/^\d{1,2}(:\d{2}){1,2}$/, { name: "timecode", invert: false })
          .warning("Use m:ss or h:mm:ss format"),
    },
    {
      name: "altText",
      title: "Alt Text",
      type: "string",
      group: "content",
      description: "Describe this media for screen readers and SEO",
    },
    {
      name: "caption",
      title: "Caption",
      type: "array",
      group: "content",
      of: [
        {
          type: "block",
          styles: [{ title: "Normal", value: "normal" }],
          marks: {
            decorators: [
              { title: "Bold", value: "strong" },
              { title: "Italic", value: "em" },
            ],
            annotations: [
              {
                name: "link",
                type: "object",
                title: "Link",
                fields: [
                  {
                    name: "href",
                    type: "url",
                    title: "URL",
                    validation: (rule) =>
                      rule.uri({ allowRelative: true, scheme: ["http", "https", "mailto"] }),
                  },
                ],
              },
            ],
          },
        },
      ],
      description: "Optional display caption with formatting",
      validation: (rule) =>
        rule.custom((value, context) => {
          if (context.document?.mediaType === "text" && (!value || value.length === 0)) {
            return "Text posts require caption content";
          }
          return true;
        }),
    },
    {
      name: "client",
      title: "Client",
      type: "reference",
      group: "attribution",
      to: [{ type: "client" }],
      description:
        "The end client this work was made for (e.g. Google, Sonos). Only one — use credits for the agency/studio.",
    },
    {
      name: "credits",
      title: "Credits",
      type: "array",
      group: "attribution",
      of: [
        {
          type: "object",
          name: "credit",
          fields: [
            {
              name: "person",
              title: "Person",
              type: "reference",
              to: [{ type: "collaborator" }],
              validation: (rule) => rule.required(),
            },
            {
              name: "role",
              title: "Role",
              type: "string",
              description:
                "Optional — e.g. Design, Engineering, Writing, Direction. Leave blank for a bare credit.",
            },
          ],
          preview: {
            select: { name: "person.name", role: "role" },
            prepare: ({ name, role }: { name?: string; role?: string }) => ({
              title: name ?? "Untitled collaborator",
              subtitle: role ?? undefined,
            }),
          },
        },
      ],
      description:
        "Optional — key collaborators (e.g. co-designers or a team of people). Role on each credit is optional.",
    },
    {
      name: "categories",
      title: "Categories",
      type: "array",
      group: "classification",
      of: [{ type: "reference", to: [{ type: "category" }] }],
      description: "Broad topics: art, design, development, photography, music, etc.",
    },
    {
      name: "tags",
      title: "Tags",
      type: "array",
      group: "classification",
      of: [{ type: "reference", to: [{ type: "tag" }] }],
      description: "Granular: 3D, sketch, scan, branding, print, poster, etc.",
    },
    {
      name: "featured",
      title: "Featured",
      type: "boolean",
      group: "classification",
      description: "Pin to top of grid",
      initialValue: false,
    },
    {
      name: "hidden",
      title: "Hidden",
      type: "boolean",
      group: "classification",
      description: "Only visible when logged in as Ryan. Hidden from public site.",
      initialValue: false,
    },
    {
      name: "location",
      title: "Location",
      type: "geopoint",
      group: "metadata",
      description: "Auto-extracted from EXIF when available, or set manually for scans/renders",
    },
    {
      name: "date",
      title: "Date Created",
      type: "date",
      group: "metadata",
      options: {
        dateFormat: "MM-DD-YYYY",
      },
      description: "When this piece was originally created",
    },
  ],
  orderings: [
    {
      title: "Featured first, then newest",
      name: "featuredThenDate",
      by: [
        { field: "featured", direction: "desc" },
        { field: "date", direction: "desc" },
      ],
    },
    {
      title: "Date Created, Newest",
      name: "dateDesc",
      by: [{ field: "date", direction: "desc" }],
    },
    {
      title: "Date Created, Oldest",
      name: "dateAsc",
      by: [{ field: "date", direction: "asc" }],
    },
    {
      title: "Title A–Z",
      name: "titleAsc",
      by: [{ field: "title", direction: "asc" }],
    },
    {
      title: "Recently updated",
      name: "updatedDesc",
      by: [{ field: "_updatedAt", direction: "desc" }],
    },
  ],
  preview: {
    select: {
      title: "title",
      subtitle: "altText",
      media: "image",
      isHidden: "hidden",
      mediaType: "mediaType",
    },
    prepare({ title, subtitle, media, isHidden, mediaType }) {
      const prefix = isHidden ? "🔒 " : "";
      if (mediaType === "text") {
        return {
          title: `${prefix}${title || "Untitled text post"}`,
          subtitle: "Text post",
        };
      }
      return {
        title: `${prefix}${title || "Untitled"}`,
        subtitle: subtitle || "No alt text",
        media,
      };
    },
  },
});
