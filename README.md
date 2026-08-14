# MoonCat Knowledge Archive

The MoonCat Knowledge Archive is a small, read-only Vite application for browsing a sibling checkout of [MoonCat KB](https://github.com/mooncatdao/mooncat-kb) (default local path: `../mckb`). It is a human-facing presentation layer: the sibling KB remains canonical, while this app provides guided entrypoints, static search and profile lookup, and a complete technical archive of the publishable KB record set in an LCARS-inspired interface.

## Local setup

```sh
npm install
npm run dev
```

`predev` regenerates the local archive before Vite starts. To make a production bundle, run:

```sh
npm run build
```

`prebuild` regenerates the archive before TypeScript and Vite build the app.

## Navigation and tools

The large **MOONCAT / KNOWLEDGE / ARCHIVE** panel is Home. The six top controls are human-facing entrypoints:

- **Guide** — open the primary human guide, with the existing README fallback when needed.
- **Topics** — choose a goal-oriented curated starting point.
- **Examples** — browse executable KB examples.
- **Profile** — look up one MoonCat from the static population snapshot.
- **Search** — open the Technical Archive and focus its local search interface without clearing the current query or scope.
- **Archive** — open the complete Technical Archive with the search scope set to All.

The left LCARS rail is intentionally different: it provides technical and contributor shortcuts for **Back**, **Data**, **Contracts**, **Sources**, **Gaps**, **Agents**, **Integrity**, and **Contribute**. Data opens the archive with its existing Data search scope selected; the other shortcuts open focused published KB records.

Search is entirely local and static. Its All, Guides, Data, and Examples scopes narrow the generated `search-index.json` without contacting a backend. The expandable archive tree retains the full generated record hierarchy for file-oriented browsing.

The curated navigation is presentation metadata only. It does not copy MoonCat facts into this application, and it gracefully falls back when an expected curated destination is absent.

### Static MoonCat profile lookup

The `#/profile` route requires an explicit rescue order (`0..25439`) or bytes5 Cat ID (`0x` plus 10 hexadecimal digits). It reads one generated lookup index and the relevant local population shard.

`npm run generate:kb` creates the gitignored `public/kb/profile-lookup.json` index deterministically from the sibling `data/mooncat-population/manifest.json` and its shards; it does not create a second population dataset. The displayed profile preserves the generated source row, including a finalized name only when that row already contains one.

The profile is a static snapshot. It does not establish current ownership, accessory state, market state, live chain/API state, provisional naming, or complete naming history.

### Internal document navigation

Relative links to included Markdown and JSON files are routed inside the archive when resolvable. Exact published `.md` or `.json` paths that appear as inline code in Markdown are also linked to their library record. Script paths, directories, unpublished files, and unresolved paths remain plain code.

Normal route navigation returns the page to the top, while the Technical Archive tree preserves its own scroll position across record changes.

## KB generation

Run the generator directly with:

```sh
npm run generate:kb
```

It reads `../mckb` by default. Point it at another checkout with:

```sh
MCKB_PATH=/path/to/mckb npm run generate:kb
```

The generated, gitignored `public/kb/` directory contains the copied publishable content plus `manifest.json`, `search-index.json`, and `profile-lookup.json`. The search index stores compact searchable metadata and normalized text so queries do not need to load every record at runtime.

The generator includes `README.md`, `CONTRIBUTING.md` when present, `llms.txt`, and supported Markdown, JSON, or text files beneath `docs/`, `data/`, and `examples/`. It omits hidden files, development metadata, `references/`, `scripts/`, `AGENTS.md`, `result.md`, and unsupported types. It records the source git commit when available but does not require git metadata.

When the sibling KB provides a valid `data/kb-manifest.json`, the archive optionally enriches matching published records and search entries with a bounded presentation subset: `fileRole`, `topics`, `curationMode`, `statuses`, and `sourceBackedStatus`. Hashes, commands, routes, recipes, and other internal manifest fields are intentionally excluded. Missing, malformed, or unmatched source-manifest metadata is ignored so filesystem-derived archive generation and browsing continue normally.

## Scope and limitations

- This is a static, hash-routed, read-only presentation layer. It does not edit the KB, authenticate users, call a backend, or query live MoonCat services.
- The sibling MoonCat KB remains the source of truth. This repository should not become an independent factual database or parallel ontology.
- Markdown and JSON are the primary structured reading formats; other supported published text is retained without inventing schema-specific semantics.
- JSON uses a generic recursive structured view rather than custom pages for every schema.
- External links open separately. Included resolvable Markdown/JSON references stay inside the archive.
- The interface adapts the Classic Standard LCARS design language and retains the required [TheLCARS.com](https://www.thelcars.com/) attribution.

## License

Original project code and documentation are dedicated to the public domain under CC0 1.0 Universal (SPDX: `CC0-1.0`); see [LICENSE](LICENSE).

Generated or copied MoonCat KB content follows the licensing and provenance of its source material. The CC0 dedication does not relicense third-party or upstream material. In particular, bundled/adapted LCARS template material and any other third-party assets remain subject to their original terms and required attribution.
