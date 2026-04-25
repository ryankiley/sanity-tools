import { defineCliConfig } from "sanity/cli";

// `npm run typegen` from the consuming app's root invokes this config. The
// app source path and types output path are configurable via env so the
// Studio doesn't need to be a sibling of any specific consumer; they
// default to a sibling-checkout layout (../../<app>) which is the typical
// case here (this Studio is checked out at sanity-tools/studio, the app
// at portfolio/).
const APP_SRC = process.env.SANITY_TYPEGEN_PATH || "../../portfolio/{app,server}/**/*.{ts,tsx,vue}";
const TYPES_OUT = process.env.SANITY_TYPEGEN_GENERATES || "../../portfolio/types/sanity.types.ts";

export default defineCliConfig({
  api: {
    projectId: "sn138nra",
    dataset: "production",
  },
  deployment: {
    appId: "eg8n16hd8mqcphnzqoh04fj1",
  },
  autoUpdates: true,
  studioHost: process.env.SANITY_STUDIO_HOSTNAME,
  typegen: {
    path: APP_SRC,
    schema: "./schema.json",
    generates: TYPES_OUT,
    overloadClientMethods: true,
  },
});
