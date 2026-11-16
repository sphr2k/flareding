import { z } from "zod";
import { pageInput, pageOutput, tagDto } from "../../linkding/v1/contract.js";

/** Flareding v1 is additive and independent from the upstream Linkding v1 route contract. */
export const flaredingV1TagPageInput = pageInput.extend({
  include_archived: z
    .enum(["false", "true"])
    .default("false")
    .transform((v) => v === "true"),
});

export const flaredingV1TagPageOutput = pageOutput(tagDto);
export type FlaredingV1TagPage = z.output<typeof flaredingV1TagPageOutput>;
