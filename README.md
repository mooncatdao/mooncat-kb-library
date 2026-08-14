# MoonCat Knowledge Archive

The MoonCat Knowledge Archive is a small, read-only Vite application for browsing the sibling [MoonCat KB](../mckb). It presents a human-first guide, goal-oriented topic entrypoints, executable examples, and the complete Markdown/JSON record set in an LCARS-inspired interface while leaving the sibling KB canonical and untouched.

## Local setup

```sh
npm install
npm run dev
```

`predev` generates the archive before Vite starts. To make a production bundle, run:

```sh
npm run build
```

`prebuild` regenerates the archive before TypeScript and Vite build the app.

## Archive navigation

Home starts with `docs/mooncat-kb-guide.md` when that generated file is
available, then offers curated topic and example routes. The Technical Archive
route and the expandable library tree retain every generated record for users
who need the file-oriented view. Search remains local and static; its All,
Guides, Data, and Examples scopes narrow the generated `search-index.json`
without contacting a backend.

The curated navigation is presentation metadata only. It does not copy MoonCat
facts into this application, and it gracefully falls back to available archive
files if an expected guide or topic destination is absent.

The `#/profile` route is a human-facing static MoonCat lookup. It requires an
explicit rescue order (`0..25439`) or bytes5 Cat ID (`0x` plus 10 hexadecimal
digits), then reads one generated lookup index and the relevant local
population shard. `npm run generate:kb` creates the gitignored
`public/kb/profile-lookup.json` index deterministically from the sibling
`data/mooncat-population/manifest.json` and its shards; it does not create a
second population dataset. The displayed row preserves the generated fields,
including a finalized name only when the row already contains one. The profile
view is a static snapshot and makes no claims about current ownership,
accessories, markets, live chain/API state, provisional names, or complete name
history.

## KB generation

Run the generator directly with:

```sh
npm run generate:kb
```

It reads `../mckb` by default. Point it at another checkout with:

```sh
MCKB_PATH=/path/to/mckb npm run generate:kb
```

The generated, gitignored `public/kb/` directory contains `manifest.json`, `search-index.json`, and a copied `content/` tree. The search index has one compact entry per published file with its path, title, type, and normalized searchable text; it powers the archive's static client-side search without loading every record at query time. The generator includes only `README.md`, `CONTRIBUTING.md` when present, `llms.txt`, and supported Markdown, JSON, or text files beneath `docs/`, `data/`, and `examples/`. It omits hidden files, development metadata, `references/`, `scripts/`, `AGENTS.md`, `result.md`, and unsupported types. It records the source git commit when available but does not require git metadata.

When the sibling KB provides a valid `data/kb-manifest.json`, the archive
optionally enriches matching published records and search entries with a
whitelisted presentation subset: `fileRole`, `topics`, `curationMode`,
`statuses`, and `sourceBackedStatus`. Hashes, commands, routes, recipes, and
other internal manifest fields are intentionally excluded. Missing, malformed,
or unmatched source-manifest metadata is ignored so filesystem-derived archive
generation and browsing continue normally.

## V1 limitations

- This is a static, hash-routed presentation layer; it does not edit, authenticate, or call a backend. Search is local to the generated publishable archive index.
- Markdown and JSON are the primary readable formats. Other KB files are intentionally not published by this first version.
- JSON uses a generic recursive structured view, not per-schema custom pages.
- External links open separately. Relative links to included Markdown/JSON files are routed within the archive when resolvable.

The interface adapts the Classic Standard LCARS design language and retains the required [TheLCARS.com](https://www.thelcars.com/) attribution.
