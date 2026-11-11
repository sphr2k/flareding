import type { BookmarkDO } from "./worker/bookmarks.js";

export interface Env {
  BOOKMARKS: DurableObjectNamespace<BookmarkDO>;
  ASSETS: Fetcher;
  API_TOKEN?: string;
  IMPORT_SECRET?: string;
  ACCESS_AUD?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_ALLOWED_EMAIL?: string;
  SESSION_SECRET?: string;
}
