import type { BookmarkDO } from "./worker/bookmarks.js";

export interface Env {
  BOOKMARKS: DurableObjectNamespace<BookmarkDO>;
  ASSETS: Fetcher;
  API_TOKEN?: string;
}
