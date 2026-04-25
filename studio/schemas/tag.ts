import { defineType } from "sanity";

export default defineType({
  name: "tag",
  title: "Tag",
  type: "document",
  fields: [
    {
      name: "title",
      title: "Title",
      type: "string",
      validation: (rule) => rule.required().max(40),
    },
    {
      name: "slug",
      title: "Slug",
      type: "slug",
      options: { source: "title", maxLength: 96 },
      validation: (rule) => rule.required(),
    },
  ],
  orderings: [
    { title: "Title, A–Z", name: "titleAsc", by: [{ field: "title", direction: "asc" }] },
  ],
  preview: {
    select: { title: "title", subtitle: "slug.current" },
  },
});
