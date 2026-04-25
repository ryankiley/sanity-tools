import { type AssistFieldActionProps, defineAssistFieldAction, isType } from "@sanity/assist";
import { useMemo } from "react";
import { SparklesIcon } from "@sanity/icons";
import { useClient, useWorkspaceSchemaId, type Path } from "sanity";
import { useToast } from "@sanity/ui";

/**
 * Studio field action — Describe / Title / Caption from image via
 * Sanity Agent Actions.
 *
 * Previously this called api.anthropic.com directly from the browser
 * with SANITY_STUDIO_ANTHROPIC_KEY (inlined into the Studio bundle at
 * build time, visible to anyone with Studio access). Now it routes
 * through `client.agent.action.generate()` — server-side, schema-aware,
 * billed through the Sanity org. No Anthropic key in the browser.
 *
 * Requires the schema to have been deployed (`sanity deploy`) so the
 * agent has the content model. The workspace schema ID is read via
 * `useWorkspaceSchemaId()` from `sanity`.
 */
export function useDescribeImage(props: AssistFieldActionProps) {
  const { actionType, documentIdForAction, getDocumentValue, path, schemaType } = props;

  const sanityClient = useClient({ apiVersion: "2026-04-09" });
  const schemaId = useWorkspaceSchemaId();
  const { push: pushToast } = useToast();

  return useMemo(() => {
    if (actionType !== "field") return undefined;

    const fieldName = path[path.length - 1];
    const fieldNameStr = typeof fieldName === "string" ? fieldName : "";
    const isAltText = fieldNameStr.toLowerCase().includes("alt");
    const isTitle = fieldNameStr === "title";
    const isCaption = fieldNameStr === "caption";

    const isStringField = isType(schemaType, "string") || isType(schemaType, "text");
    const isArrayField = isType(schemaType, "array");

    if ((isAltText || isTitle) && !isStringField) return undefined;
    if (isCaption && !isArrayField) return undefined;
    if (!isAltText && !isTitle && !isCaption) return undefined;

    const instruction = isAltText
      ? "Describe what is visually depicted in the image at $image for screen readers. Focus on subject, setting, colors, and composition. Be concise — under 125 characters. Do NOT start with 'image of' or 'photo of'. Respond with ONLY the description."
      : isTitle
        ? "Write a short 2-5 word descriptive title for the image at $image. Be specific about the subject. No punctuation at end. Respond with ONLY the title."
        : 'Write a very short caption for the image at $image. 3-7 words max. Plain, descriptive, no poetry or metaphors. Like a photo album label. Examples: "Portland fog", "Crater Lake at dusk", "Brooklyn Bridge", "Concert crowd", "Alpine wildflowers". Respond with ONLY the caption.';

    return defineAssistFieldAction({
      title: isAltText ? "Describe image" : isTitle ? "Title from image" : "Caption from image",
      icon: SparklesIcon,
      onAction: async () => {
        const doc = getDocumentValue();
        const imageRef = (doc as { image?: { asset?: { _ref?: string } } })?.image?.asset?._ref;
        if (!imageRef) {
          pushToast({ status: "warning", title: "No image uploaded" });
          return;
        }

        pushToast({ status: "info", title: "Analyzing image…" });

        try {
          await (
            sanityClient as unknown as {
              agent: {
                action: {
                  generate: (opts: {
                    schemaId: string;
                    documentId: string;
                    instruction: string;
                    instructionParams?: Record<string, { type: "field"; path: Path }>;
                    target: { path: Path };
                  }) => Promise<unknown>;
                };
              };
            }
          ).agent.action.generate({
            schemaId,
            documentId: documentIdForAction,
            instruction,
            instructionParams: {
              image: { type: "field", path: ["image"] },
            },
            target: { path },
          });

          pushToast({ status: "success", title: "Done" });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          pushToast({
            status: "error",
            title: "Agent Action failed",
            description: message,
          });
        }
      },
    });
  }, [
    actionType,
    sanityClient,
    documentIdForAction,
    getDocumentValue,
    path,
    schemaType,
    schemaId,
    pushToast,
  ]);
}
