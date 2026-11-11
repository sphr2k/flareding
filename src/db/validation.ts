import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-orm/zod";
import { bookmarks, tags } from "./schema.js";

// All CRUD validators originate from Drizzle; never duplicate the table shape.
export const bookmarkInsertSchema = createInsertSchema(bookmarks);
export const bookmarkSelectSchema = createSelectSchema(bookmarks);
export const bookmarkUpdateSchema = createUpdateSchema(bookmarks);
export const tagInsertSchema = createInsertSchema(tags);
export const tagSelectSchema = createSelectSchema(tags);
export const tagUpdateSchema = createUpdateSchema(tags);
