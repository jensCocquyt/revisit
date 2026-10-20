# Redesign

## Goal

Replace the step 1 interface with the approved design: a blue add rail on the left, search with dense results on the right, and the item view as a 600px panel on the right that Esc closes. On a phone, a blue Add band pinned at the bottom opens an add sheet, and the item view is full screen. Web only: the server, the API and the eval stay as they are.

## Out of scope

"Show more" (search and the recent list have no paging), the reserved "more like this" slot, a theme switch, showing a screenshot's text apart from its description (the server stores them as one body), and any server change.

## Decisions

- **Colour:** Klein blue is provisional. All colour comes from four brand tokens (`--brand`, `--brand-contrast`, `--highlight`, `--highlight-contrast`) in `web/src/tokens.css`. Components read only semantic tokens, never a raw colour.
- **Stack:** React with plain CSS custom properties, native `<dialog>` and `<search>`, no component library. Schibsted Grotesk and DM Mono are bundled through Fontsource, so the page makes no requests to Google Fonts.
- **Layout:** 900px and wider: add rail on the left, item panel on the right. 600 to 900px: the rail becomes an add bar above search. Under 600px: Add band at the bottom, add opens a bottom sheet, the item view is full screen with "← Results". The draft lives in the app, so it survives closing the sheet or crossing a breakpoint.
- **Status labels:** "Reading…" while processing, "Failed" with Retry, "Page not read" with Retry.
- **Why it matched:** the design drops the "exact words / partial text / similar meaning" line; highlighted words in the snippet show exact matches.
- **Shortcuts:** `/` focuses search, Ctrl (⌘ on a Mac) + Enter saves, pasting outside a field fills the add box.

## Checklist

- [x] Tokens and fonts
- [x] Add rail: paste or drop, optional note, Save, save errors, just added
- [x] Search box, kind chips, time filter
- [x] Results and recent rows with thumbnails, highlights and status labels
- [x] States: searching, no matches, nothing in the filtered range, nothing saved yet
- [x] Item panel: link, text, screenshot, failed, inline delete confirm
- [x] 600 to 900px add bar
- [x] Phone: Add band, add sheet with Paste and Choose screenshot, saved toast with Undo, full-screen item view
- [x] Light and dark, checked at 1280, 800 and 375px wide

## Open questions

- Should the "why it matched" line come back somewhere in the row?
- Access to the Claude 5.5 models on Bedrock for this account (AWS answers "not available for this account"). Once granted, set `SCREENSHOT_MODEL_ID=eu.anthropic.claude-haiku-5-5` and rerun the eval.

## Review

- Checked against a scratch database in light and dark at 1280, 800 and 375px: recent with Reading…, Failed and Page not read, search with highlights, no matches, nothing in the past week, nothing saved yet, save error, page-wide paste, Ctrl + Enter, just added, item panel for link, screenshot and failed items, inline delete, add sheet, saved toast and Undo.
- Not exercised by hand: the phone Paste button (needs clipboard permission) and Choose screenshot.
