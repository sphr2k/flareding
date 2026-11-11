import { openapi } from "@orpc/openapi";
import { os } from "@orpc/server";
import { z } from "zod";
import type { Env } from "../env.js";

const procedure = os.$context<{ env: Env }>();

/** The only unauthenticated API route until linkding auth is implemented. */
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
