import { openapi } from "@orpc/openapi";
import { z } from "zod";
import { procedure } from "./base.js";

/** Diagnostic health endpoint: no bookmark or token contents exposed. */
export const router = {
  health: procedure
    .meta(openapi({ method: "GET", path: "/health" }))
    .output(
      z.object({
        status: z.literal("ok"),
        database: z.literal("sqlite-do"),
      }),
    )
    .handler(async ({ context }) => {
      const ready = await context.env.BOOKMARKS.getByName("default").health();
      if (!ready) throw new Error("Storage is not ready");
      return { status: "ok" as const, database: "sqlite-do" as const };
    }),
};
