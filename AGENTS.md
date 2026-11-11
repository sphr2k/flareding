# Flareding – Agent Instructions

## UI: Adobe React Spectrum 2 first

Flareding uses **Adobe React Spectrum 2** (`@react-spectrum/s2`) as its **sole UI component and design system**.

**Mandatory implementation order:**

1. Look up the relevant **official Adobe React Spectrum 2 documentation**, including recommended UX patterns, component anatomy, slots and responsive behavior.
2. Compose the UI using the **documented Spectrum 2 components and supported props** (including layouts, variants, sizes, density and collection APIs).
3. Use **Spectrum 2 design tokens and its `style()` macro** for component composition and layout adjustments.
4. Use custom CSS **only for the outer application shell** when there is no appropriate Spectrum 2 layout primitive.

**Do not**:

- Reimplement cards, toolbars, dialogs, menus, list items, selection behavior, focus management or other controls with custom HTML/CSS when Spectrum 2 provides them.
- Override internal Spectrum component selectors, DOM structure, CSS grid tracks, spacing or typography to work around a component used incorrectly.
- Add Tailwind, shadcn/ui or a second component/design system.
- Invent ad hoc spacing, colors or typography when Spectrum tokens exist.

**Preferred examples:** `CardView`/`Card` for bookmarks, `ListView` with documented `Image`/`Text` slots, `SearchField`, `Tabs`, `SegmentedControl`, `ActionMenu`, `DialogTrigger`/`Dialog` and native Spectrum collection/selection patterns.

Choose the appropriate **documented variant or layout** rather than patching internals. For example, cards of different content heights can use `CardView layout="waterfall"`. Responsive experiences should use the supported component capabilities and semantic layout, not handcrafted imitation components.

If Spectrum 2 genuinely lacks a needed capability, explain and document the exception **before** implementing custom UI. Keep any exception minimal and aligned with Spectrum accessibility and tokens.

## UI verification

- Validate changes with TypeScript checks, Vite+ lint/format/tests and a real Chromium browser test.
- Verify desktop and mobile layouts with **synthetic bookmarks only**; do not commit or expose private Pinboard data in tests, screenshots or logs.
- Test keyboard navigation, accessible names, focus, dark mode and overflowing/long titles.
- Do not treat typechecking alone as proof that the chosen Spectrum component anatomy is correct.

## Stack and infrastructure

- React 19 SPA, TypeScript 7, Vite+, Bun; Cloudflare Worker with SQLite Durable Object.
- Drizzle is the database schema source of truth; derive CRUD validation from Drizzle using Zod.
- oRPC v2 serves the linkding-compatible REST API.
- Use **`cf` CLI**, not Wrangler or Cloudflare MCP, for Cloudflare operations.
- GitHub `main` triggers Cloudflare-managed Builds for the existing `flareding-staging` Worker.
- Never reimport private bookmarks or recreate the Durable Object as part of a UI change.
- Never commit API tokens, session secrets, private exports or screenshots showing personal bookmarks.
