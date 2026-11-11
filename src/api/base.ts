import { os } from "@orpc/server";
import type { Env } from "../env.js";

export const procedure = os.$context<{ env: Env; requestUrl: string }>();
