# MoonCat Knowledge Archive

The MoonCat Knowledge Archive is a small, read-only Vite application for browsing the sibling [MoonCat KB](../mckb). It presents Markdown and JSON records in an LCARS-inspired interface while leaving the KB repository canonical and untouched.

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

## KB generation

Run the generator directly with:

```sh
npm run generate:kb
```

It reads `../mckb` by default. Point it at another checkout with:

```sh
MCKB_PATH=/path/to/mckb npm run generate:kb
```

The generated, gitignored `public/kb/` directory contains `manifest.json`, `search-index.json`, and a copied `content/` tree. The search index has one compact entry per published file with its path, title, type, and normalized searchable text; it powers the archive's static client-side search without loading every record at query time. The generator includes only `README.md`, `llms.txt`, and supported Markdown, JSON, or text files beneath `docs/`, `data/`, and `examples/`. It omits hidden files, development metadata, `references/`, `scripts/`, `AGENTS.md`, `result.md`, and unsupported types. It records the source git commit when available but does not require git metadata.

## V1 limitations

- This is a static, hash-routed presentation layer; it does not edit, authenticate, or call a backend. Search is local to the generated publishable archive index.
- Markdown and JSON are the primary readable formats. Other KB files are intentionally not published by this first version.
- JSON uses a generic recursive structured view, not per-schema custom pages.
- External links open separately. Relative links to included Markdown/JSON files are routed within the archive when resolvable.

The interface adapts the Classic Standard LCARS design language and retains the required [TheLCARS.com](https://www.thelcars.com/) attribution.
