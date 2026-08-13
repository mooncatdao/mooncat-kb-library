import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import {
  HUMAN_GUIDE_PATH,
  LIBRARY_EXAMPLES,
  LIBRARY_TOPICS,
  type LibraryLink,
} from "./library-sections";
import "./style.css";

type FileType = "markdown" | "json" | "text";
type FolderNode = {
  kind: "folder";
  name: string;
  title: string;
  path: string;
  children: TreeNode[];
};
type FileNode = {
  kind: "file";
  name: string;
  title: string;
  path: string;
  extension: string;
  type: FileType;
  size: number;
  modified: string;
};
type TreeNode = FolderNode | FileNode;
type Manifest = {
  generatedAt: string;
  fileCount: number;
  source: { commit: string | null };
  tree: FolderNode;
};
type SearchEntry = {
  path: string;
  title: string;
  type: FileType;
  text: string;
};
type SearchResult = {
  entry: SearchEntry;
  score: number;
  matchedTokens: number;
};
type SearchScope = "all" | "guides" | "data" | "examples";
type HumanSection = "guide" | "topics" | "examples" | "archive";

const app = document.querySelector<HTMLDivElement>("#app");
const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});
let manifest: Manifest | null = null;
let activePath = "";
let rawMode = false;
let searchIndex: SearchEntry[] | null = null;
let searchIndexState: "idle" | "loading" | "ready" | "failed" = "idle";
let searchIndexPromise: Promise<void> | null = null;
let searchQuery = "";
let searchScope: SearchScope = "all";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>'"]/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#039;",
        '"': "&quot;",
      })[char] ?? char,
  );
const routeFor = (path: string) => `#/file/${encodeURIComponent(path)}`;
const routeForSection = (section: HumanSection) => `#/${section}`;
const formatSize = (size: number) =>
  size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;

function searchTokens(query: string) {
  return [...new Set(query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean))];
}

function entryMatchesScope(entry: SearchEntry) {
  if (searchScope === "guides")
    return entry.type === "markdown" &&
      (entry.path === "README.md" || entry.path === "CONTRIBUTING.md" || entry.path.startsWith("docs/"));
  if (searchScope === "data") return entry.path.startsWith("data/");
  if (searchScope === "examples") return entry.path.startsWith("examples/");
  return true;
}

function searchResults(query: string): SearchResult[] {
  const tokens = searchTokens(query);
  if (!tokens.length || !searchIndex) return [];
  return searchIndex
    .filter(entryMatchesScope)
    .map((entry) => {
      const title = entry.title.toLocaleLowerCase();
      const path = entry.path.toLocaleLowerCase();
      const text = entry.text.toLocaleLowerCase();
      let score = 0;
      let matchedTokens = 0;
      for (const token of tokens) {
        let matched = false;
        if (title.includes(token)) {
          score += 100;
          matched = true;
        }
        if (path.includes(token)) {
          score += 60;
          matched = true;
        }
        if (text.includes(token)) {
          score += 15;
          matched = true;
        }
        if (searchScope === "all" && entry.type === "markdown") score += 2;
        if (matched) matchedTokens += 1;
      }
      return { entry, score, matchedTokens };
    })
    .filter((result) => result.matchedTokens > 0)
    .sort(
      (left, right) =>
        right.matchedTokens - left.matchedTokens ||
        right.score - left.score ||
        left.entry.title.localeCompare(right.entry.title) ||
        left.entry.path.localeCompare(right.entry.path),
    )
    .slice(0, 25);
}

function searchSnippet(entry: SearchEntry, query: string) {
  const text = entry.text;
  const lowerText = text.toLocaleLowerCase();
  const positions = searchTokens(query)
    .map((token) => lowerText.indexOf(token))
    .filter((position) => position >= 0);
  if (!positions.length) return "";
  const position = Math.min(...positions);
  const start = Math.max(0, position - 68);
  const end = Math.min(text.length, position + 150);
  return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function searchResultsMarkup() {
  const query = searchQuery.trim();
  if (!query) return "";
  if (searchIndexState === "idle" || searchIndexState === "loading")
    return '<p class="search-message">Loading searchable archive…</p>';
  if (searchIndexState === "failed")
    return '<p class="search-message search-error">Search index unavailable. Archive browsing remains available.</p>';
  const results = searchResults(query);
  if (!results.length)
    return `<p class="search-message">No records match “${escapeHtml(query)}”.</p>`;
  return `<p class="search-result-count">${results.length} result${results.length === 1 ? "" : "s"}</p><ol class="search-results">${results
    .map(({ entry }) => {
      const snippet = searchSnippet(entry, query);
      return `<li><a data-search-result href="${routeFor(entry.path)}"><strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.path)} · ${escapeHtml(entry.type)}</span>${snippet ? `<small>${escapeHtml(snippet)}</small>` : ""}</a></li>`;
    })
    .join("")}</ol>`;
}

function searchControlMarkup() {
  const scopes: [SearchScope, string][] = [
    ["all", "All"],
    ["guides", "Guides"],
    ["data", "Data"],
    ["examples", "Examples"],
  ];
  return `<section class="library-search" role="search"><label for="library-search-input">Search archive</label><div class="library-search-controls"><input id="library-search-input" type="search" autocomplete="off" placeholder="Title, path, or content" value="${escapeHtml(searchQuery)}"/><button type="button" data-search-clear aria-label="Clear archive search">Clear</button></div><div class="search-scopes" aria-label="Search scope">${scopes.map(([scope, label]) => `<button type="button" class="${searchScope === scope ? "selected" : ""}" data-search-scope="${scope}">${label}</button>`).join("")}</div><div class="search-results-panel" data-search-results aria-live="polite">${searchResultsMarkup()}</div></section>`;
}

function updateSearchResults() {
  const results = document.querySelector<HTMLElement>("[data-search-results]");
  if (results) results.innerHTML = searchResultsMarkup();
}

function clearSearch(focus = false) {
  searchQuery = "";
  const input = document.querySelector<HTMLInputElement>("#library-search-input");
  if (input) {
    input.value = "";
    if (focus) input.focus();
  }
  updateSearchResults();
}

async function loadSearchIndex() {
  if (searchIndexPromise) return searchIndexPromise;
  searchIndexState = "loading";
  searchIndexPromise = (async () => {
    try {
      const response = await fetch("./kb/search-index.json");
      if (!response.ok) throw new Error(`Request returned ${response.status}`);
      const payload = (await response.json()) as { entries?: unknown };
      if (!Array.isArray(payload.entries)) throw new Error("Invalid search index");
      searchIndex = payload.entries.filter(
        (entry): entry is SearchEntry =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as SearchEntry).path === "string" &&
          typeof (entry as SearchEntry).title === "string" &&
          typeof (entry as SearchEntry).type === "string" &&
          typeof (entry as SearchEntry).text === "string",
      );
      searchIndexState = "ready";
    } catch {
      searchIndex = null;
      searchIndexState = "failed";
    }
    updateSearchResults();
  })();
  return searchIndexPromise;
}

function allFiles(node: TreeNode): FileNode[] {
  return node.kind === "file" ? [node] : node.children.flatMap(allFiles);
}

function findFile(path: string): FileNode | undefined {
  return manifest
    ? allFiles(manifest.tree).find((file) => file.path === path)
    : undefined;
}

function pathFromHash() {
  const prefix = "#/file/";
  return location.hash.startsWith(prefix)
    ? decodeURIComponent(location.hash.slice(prefix.length))
    : "";
}

function sectionFromHash(): HumanSection | "" {
  const section = location.hash.slice(2);
  return ["guide", "topics", "examples", "archive"].includes(section)
    ? (section as HumanSection)
    : "";
}

function linkMarkup(link: LibraryLink, className = "curated-link") {
  const file = findFile(link.path);
  if (!file) return "";
  return `<a class="${className}" href="${routeFor(link.path)}"><strong>${escapeHtml(link.label)}</strong><small>${escapeHtml(link.description)}</small><span>${escapeHtml(file.path)}</span></a>`;
}

function guideDestination() {
  return findFile(HUMAN_GUIDE_PATH)
    ? HUMAN_GUIDE_PATH
    : findFile("README.md")
      ? "README.md"
      : "";
}

function humanSectionTitle(section: HumanSection) {
  return {
    guide: "Human Guide",
    topics: "Explore by Goal",
    examples: "Executable Examples",
    archive: "Technical Archive",
  }[section];
}

function internalPath(href: string, fromPath: string) {
  if (/^(https?:|mailto:|#|\/)/i.test(href)) return null;
  const bare = href.split("#")[0].split("?")[0];
  if (!/\.(md|json)$/i.test(bare)) return null;
  const bits = `${fromPath.split("/").slice(0, -1).join("/")}/${bare}`.split(
    "/",
  );
  const normalized: string[] = [];
  for (const bit of bits) {
    if (bit === "..") normalized.pop();
    else if (bit && bit !== ".") normalized.push(bit);
  }
  const target = normalized.join("/");
  return findFile(target) ? target : null;
}

function shell(content: string, title = "MoonCat Knowledge Archive") {
  const fileCount = manifest?.fileCount ?? 0;
  const guidePath = guideDestination();
  const guideHref = guidePath ? routeFor(guidePath) : routeForSection("guide");
  const navItems = [
    ["Home", "#/"],
    ["Guide", guideHref],
    ["Topics", routeForSection("topics")],
    ["Examples", routeForSection("examples")],
  ];
  const nav = navItems
    .map(([label, href], index) => `<a href="${href}"><span>0${index + 1}</span>${label}</a>`)
    .join("");
  const cascade = [
    ["93", "1853", "24109", "7024", "322", "4149", "86"],
    ["21509", "68417", "80", "319825", "46233", "05", "2014"],
    ["585101", "25403", "31219", "0604", "21048", "293612", "206"],
    ["2107853", "122019", "244872", "30412", "98", "888", "4152"],
    ["0223", "688", "28471", "21366", "8654", "1984", "21854"],
    ["633", "51166", "41699", "6188", "15033", "26083", "2143"],
  ]
    .map(
      (column) =>
        `<div class="data-column">${column.map((value, row) => `<div class="dc-row-${(row % 7) + 1}">${value}</div>`).join("")}</div>`,
    )
    .join("");
  const library = manifest
    ? `<aside class="library-browser" aria-label="Knowledge archive browser">${searchControlMarkup()}<details class="library-drawer" open><summary><span>Technical archive · all records</span><small>${fileCount}</small></summary><div class="library-tree-scroll">${renderTree(manifest.tree)}</div></details></aside>`
    : "";
  return `<section class="wrap-standard" id="column-3">
    <div class="wrap shell-header-row">
      <div class="left-frame-top">
        <a class="panel-1-button" href="#/"><span>MOONCAT</span><small>KNOWLEDGE ARCHIVE</small></a>
        <div class="panel-2">02<span class="hop">-25439</span></div>
      </div>
      <header class="right-frame-top">
        <div class="banner">${escapeHtml(title)}</div>
        <div class="data-cascade-button-group">
          <div class="data-cascade-wrapper" aria-hidden="true">${cascade}</div>
          <nav class="top-nav" aria-label="Primary navigation">${nav}</nav>
        </div>
        <div class="bar-panel first-bar-panel" aria-hidden="true"><div class="bar-1"></div><div class="bar-2"></div><div class="bar-3"></div><div class="bar-4"></div><div class="bar-5"></div></div>
      </header>
    </div>
    <div class="wrap" id="gap">
      <aside class="left-frame" aria-label="Archive sections">
        <div class="frame-panels">
          <a class="panel-3" href="${guideHref}">03<span class="hop">-GUIDE</span></a>
          <a class="panel-4" href="${routeForSection("topics")}">04<span class="hop">-TOPICS</span></a>
          <a class="panel-5" href="${routeForSection("examples")}">05<span class="hop">-EXAMPLES</span></a>
          <a class="panel-6" href="${routeForSection("archive")}">06<span class="hop">-ARCHIVE</span></a>
          <div class="panel-7">07<span class="hop">-${String(fileCount).padStart(3, "0")}</span></div>
          <div class="panel-8">08<span class="hop">-READ ONLY</span></div>
          <div class="panel-9">09<span class="hop">-ARCHIVE</span></div>
        </div>
        <div class="panel-10">10<span class="hop">-MCKB</span></div>
      </aside>
      <div class="right-frame">
        <div class="bar-panel" aria-hidden="true"><div class="bar-6"></div><div class="bar-7"></div><div class="bar-8"></div><div class="bar-9"></div><div class="bar-10"></div></div>
        <main id="content" tabindex="-1"><div class="library-workspace">${library}<div class="content-pane">${content}</div></div></main>
        <footer class="site-footer"><span>MOONCAT KB // READ-ONLY PRESENTATION LAYER</span><span>LCARS Inspired Website Template by <a href="https://www.thelcars.com/" target="_blank" rel="noreferrer">www.TheLCARS.com</a>.</span></footer>
      </div>
    </div>
  </section>`;
}

function renderTree(node: FolderNode, depth = 0): string {
  return `<ul class="tree ${depth ? "nested" : ""}">${node.children
    .map((child) => {
      if (child.kind === "file")
        return `<li><a class="tree-file ${child.path === activePath ? "active" : ""}" href="${routeFor(child.path)}" title="${escapeHtml(child.path)}"><span>${escapeHtml(child.title)}</span><em>${child.extension.slice(1)}</em></a></li>`;
      const containsActive = allFiles(child).some(
        (file) => file.path === activePath,
      );
      return `<li><details ${containsActive || depth < 1 ? "open" : ""}><summary>${escapeHtml(child.title)} <small>${allFiles(child).length}</small></summary>${renderTree(child, depth + 1)}</details></li>`;
    })
    .join("")}</ul>`;
}

function curatedCards(links: LibraryLink[], className = "curated-grid") {
  const cards = links
    .map((link) => linkMarkup(link, "curated-link"))
    .filter(Boolean)
    .join("");
  return `<div class="${className}">${cards || '<p class="curated-empty">No curated destinations from this group are present in the generated archive.</p>'}</div>`;
}

function humanPage(section: HumanSection) {
  const guidePath = guideDestination();
  const guideLink = guidePath
    ? `<a class="curated-primary" href="${routeFor(guidePath)}"><strong>Open the human guide</strong><small>${escapeHtml(guidePath)}</small></a>`
    : '<p class="curated-empty">The human guide is not present in this generated archive. Use the technical archive below.</p>';
  if (section === "guide")
    return shell(
      `<section class="curated-page"><p class="eyebrow">HUMAN ENTRYPOINT // START HERE</p><h1>Using MoonCat KB</h1><p class="curated-lede">A goal-oriented introduction to the archive, its evidence boundaries, and the quickest route to a useful answer.</p><div class="curated-actions">${guideLink}<a class="curated-secondary" href="${routeForSection("topics")}"><strong>Explore by goal</strong><small>Choose a topic without browsing folders.</small></a></div><section class="curated-note"><h2>Read the guide first</h2><p>The guide is the primary human starting point. The complete technical archive remains available as a secondary, file-oriented view.</p></section></section>`,
      humanSectionTitle(section),
    );
  if (section === "topics")
    return shell(
      `<section class="curated-page"><p class="eyebrow">HUMAN ENTRYPOINT // TOPICS</p><h1>Explore by goal</h1><p class="curated-lede">Choose a starting point by what you want to understand or build. Each card routes to an existing source document.</p>${curatedCards(LIBRARY_TOPICS)}<div class="curated-actions"><a class="curated-secondary" href="${routeForSection("guide")}"><strong>Read the human guide</strong><small>Get the archive's orientation and boundaries.</small></a><a class="curated-secondary" href="${routeForSection("archive")}"><strong>Open all records</strong><small>Browse the complete generated file tree.</small></a></div></section>`,
      humanSectionTitle(section),
    );
  if (section === "examples")
    return shell(
      `<section class="curated-page"><p class="eyebrow">HUMAN ENTRYPOINT // EXAMPLES</p><h1>Executable examples</h1><p class="curated-lede">Small, local examples that demonstrate bounded ways to use the KB without adding a live service or competing dataset.</p>${curatedCards(LIBRARY_EXAMPLES, "curated-grid examples-grid")}<div class="curated-actions"><a class="curated-secondary" href="${routeForSection("guide")}"><strong>Read the human guide</strong><small>Choose a goal before opening an implementation.</small></a><a class="curated-secondary" href="${routeForSection("archive")}"><strong>Open all records</strong><small>Find supporting docs and data in the technical tree.</small></a></div></section>`,
      humanSectionTitle(section),
    );
  return shell(
    `<section class="curated-page"><p class="eyebrow">SECONDARY VIEW // COMPLETE FILE TREE</p><h1>Technical archive</h1><p class="curated-lede">All generated Markdown, JSON, and text records remain available in the archive browser at left. Use search or the tree when you already know the file or need technical detail.</p><div class="curated-actions"><a class="curated-primary" href="${routeForSection("guide")}"><strong>Return to human guide</strong><small>Start with a goal-oriented route.</small></a><a class="curated-secondary" href="${routeForSection("topics")}"><strong>Browse curated topics</strong><small>Use the human-facing entrypoints.</small></a></div></section>`,
    humanSectionTitle(section),
  );
}

function home() {
  const source = manifest?.source.commit
    ? `SOURCE COMMIT ${manifest.source.commit.slice(0, 12)}`
    : "SOURCE COMMIT UNAVAILABLE";
  return shell(
    `<section class="home-hero"><p class="eyebrow">MOONCAT DAO // HUMAN-FIRST KNOWLEDGE SYSTEM</p><h1>MoonCat Knowledge Archive</h1><p>A read-only library for people who want a useful starting point before opening the complete technical record set.</p><div class="home-meta"><span>${manifest?.fileCount ?? 0} PUBLISHABLE RECORDS</span><span>${source}</span></div></section><section class="guide-spotlight"><p class="eyebrow">PRIMARY STARTING POINT</p><h2>Using MoonCat KB</h2><p>Begin with the goal-oriented guide, then follow a curated topic or example into the source-backed archive.</p>${guideLinkMarkup()}<div class="spotlight-links"><a href="${routeForSection("topics")}">Explore by goal <span>→</span></a><a href="${routeForSection("examples")}">Open examples <span>→</span></a><a href="${routeForSection("archive")}">Technical archive <span>→</span></a></div></section><section class="home-topic-preview"><div><p class="eyebrow">CURATED TOPICS</p><h2>Where do you want to go?</h2></div><div class="topic-preview-grid">${LIBRARY_TOPICS.slice(0, 6).map((link) => linkMarkup(link, "topic-preview-link")).filter(Boolean).join("")}</div><a class="curated-secondary" href="${routeForSection("topics")}"><strong>See all topics</strong><small>Browse the complete goal-oriented index.</small></a></section>`,
  );
}

function guideLinkMarkup() {
  const path = guideDestination();
  return path
    ? `<a class="curated-primary" href="${routeFor(path)}"><strong>Open the human guide</strong><small>${escapeHtml(path)}</small></a>`
    : '<p class="curated-empty">The guide is unavailable in this generated archive; use the technical archive instead.</p>';
}

function breadcrumbs(file: FileNode) {
  const parts = file.path.split("/");
  return `<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="#/">ARCHIVE</a>${parts.map((part, index) => `<span>/</span>${index === parts.length - 1 ? `<b>${escapeHtml(part)}</b>` : `<span>${escapeHtml(part)}</span>`}`).join("")}</nav>`;
}

function rawView(content: string) {
  return `<pre class="raw-view"><code>${escapeHtml(content)}</code></pre>`;
}

function renderMarkdown(content: string, file: FileNode) {
  if (rawMode) return rawView(content);
  const html = DOMPurify.sanitize(markdown.render(content));
  const holder = document.createElement("div");
  holder.innerHTML = html;
  holder.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((link) => {
    const target = internalPath(link.getAttribute("href") ?? "", file.path);
    if (target) link.href = routeFor(target);
    else if (/^https?:/i.test(link.href)) {
      link.target = "_blank";
      link.rel = "noreferrer";
    }
  });
  return `<article class="document markdown">${holder.innerHTML}</article>`;
}

function labelFor(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function looksLikePath(value: string) {
  return /^(docs|data|examples)\/.+\.(md|json)$/i.test(value);
}

type JsonRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSimpleScalar(value: unknown): value is string | number | boolean {
  return ["string", "number", "boolean"].includes(typeof value);
}

function isSimpleRecordValue(value: unknown) {
  return (
    value === null ||
    isSimpleScalar(value) ||
    (Array.isArray(value) && value.every((item) => item === null || isSimpleScalar(item)))
  );
}

function recordShape(record: JsonRecord) {
  return Object.keys(record).sort().join("\u0000");
}

function isExpandedRecordArray(value: unknown[]): value is JsonRecord[] {
  if (value.length === 0 || value.length > 25 || !value.every(isPlainRecord))
    return false;
  const shape = recordShape(value[0]);
  return (
    shape.length > 0 &&
    value.every(
      (record) =>
        recordShape(record) === shape &&
        Object.values(record).every(isSimpleRecordValue),
    )
  );
}

function headingField(record: JsonRecord) {
  const preferred = ["title", "name", "key", "id", "label"];
  return preferred.find((candidate) => {
    const key = Object.keys(record).find((entry) => entry.toLowerCase() === candidate);
    const value = key ? record[key] : undefined;
    return isSimpleScalar(value) && String(value).trim().length > 0;
  });
}

function semanticField(key: string) {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, "");
  if (["purpose", "description", "summary"].includes(normalized)) return "descriptive";
  if (["guardrail", "guardrails", "limitation", "limitations", "note", "notes"].includes(normalized))
    return "caution";
  if (["command", "commands"].includes(normalized)) return "command";
  if (normalized === "status") return "status";
  return "";
}

function recordFieldMarkup(key: string, value: unknown, depth: number) {
  const semantic = semanticField(key);
  const classes = ["json-record-field", semantic, typeof value === "object" && value !== null ? "complex" : ""]
    .filter(Boolean)
    .join(" ");
  const rendered = valueMarkup(value, depth + 1);
  const valueMarkupWithSemantics =
    semantic === "status" && isSimpleScalar(value)
      ? `<span class="json-status">${rendered}</span>`
      : semantic === "command"
        ? `<div class="json-command">${rendered}</div>`
        : rendered;
  return `<section class="${classes}"><h3>${labelFor(key)}</h3><div>${valueMarkupWithSemantics}</div></section>`;
}

function recordMarkup(record: JsonRecord, index: number, depth: number) {
  const heading = headingField(record);
  const headingKey = heading
    ? Object.keys(record).find((key) => key.toLowerCase() === heading)
    : undefined;
  const headingValue = headingKey ? record[headingKey] : undefined;
  const fields = Object.entries(record)
    .filter(([key]) => key !== headingKey)
    .map(([key, value]) => recordFieldMarkup(key, value, depth))
    .join("");
  return `<article class="json-record"><header class="json-record-heading"><span class="json-record-index">${String(index + 1).padStart(2, "0")}</span><h3>${headingValue !== undefined ? escapeHtml(String(headingValue)) : `Record ${index + 1}`}</h3></header>${fields ? `<div class="json-record-fields">${fields}</div>` : ""}</article>`;
}

function valueMarkup(value: unknown, depth = 0): string {
  if (value === null) return '<span class="json-null">null</span>';
  if (typeof value === "boolean")
    return `<span class="json-bool">${value}</span>`;
  if (typeof value === "number")
    return `<span class="json-number">${value}</span>`;
  if (typeof value === "string") {
    if (looksLikePath(value) && findFile(value))
      return `<a class="json-path" href="${routeFor(value)}">${escapeHtml(value)}</a>`;
    if (/^https?:\/\//.test(value))
      return `<a href="${escapeHtml(value)}" target="_blank" rel="noreferrer">${escapeHtml(value)}</a>`;
    return `<span class="json-string">${escapeHtml(value)}</span>`;
  }
  if (Array.isArray(value)) {
    if (!value.length) return '<span class="json-empty">[]</span>';
    if (
      value.every(
        (item) =>
          item === null ||
          ["string", "number", "boolean"].includes(typeof item),
      )
      )
      return `<ul class="primitive-list">${value.map((item) => `<li>${valueMarkup(item, depth + 1)}</li>`).join("")}</ul>`;
    if (isExpandedRecordArray(value))
      return `<div class="json-record-list">${value.map((record, index) => recordMarkup(record, index, depth)).join("")}</div>`;
    return `<div class="json-array">${value.map((item, index) => `<details ${depth < 1 ? "open" : ""}><summary>ITEM ${index + 1}</summary>${valueMarkup(item, depth + 1)}</details>`).join("")}</div>`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return '<span class="json-empty">{}</span>';
  return `<div class="json-object">${entries.map(([key, item]) => `<section class="json-field ${typeof item === "object" && item !== null ? "complex" : ""}"><h3>${labelFor(key)}</h3><div>${valueMarkup(item, depth + 1)}</div></section>`).join("")}</div>`;
}

function renderJson(content: string) {
  if (rawMode) return rawView(content);
  try {
    return `<article class="document json-document">${valueMarkup(JSON.parse(content))}</article>`;
  } catch (error) {
    return `<section class="error-state"><h2>Malformed JSON record</h2><p>This copied file cannot be displayed in the structured view: ${escapeHtml(error instanceof Error ? error.message : "Unknown parsing error")}.</p><button data-mode="raw">View raw content</button></section>`;
  }
}

async function filePage(path: string) {
  const file = findFile(path);
  if (!file)
    return shell(
      `<section class="error-state"><h1>Record not found</h1><p>This path is not present in the generated archive manifest.</p><a class="lcars-button" href="#/">Return to archive</a></section>`,
      "Record unavailable",
    );
  try {
    const response = await fetch(
      `./kb/content/${file.path.split("/").map(encodeURIComponent).join("/")}`,
    );
    if (!response.ok) throw new Error(`Request returned ${response.status}`);
    const content = await response.text();
    const view =
      file.type === "markdown"
        ? renderMarkdown(content, file)
        : file.type === "json"
          ? renderJson(content)
          : rawView(content);
    return shell(
      `${breadcrumbs(file)}<header class="record-header"><p class="eyebrow">${file.type.toUpperCase()} RECORD // ${formatSize(file.size)}</p><h1>${escapeHtml(file.title)}</h1><p>${escapeHtml(file.path)}</p><div class="view-switch"><button class="${!rawMode ? "selected" : ""}" data-mode="structured">${file.type === "json" ? "Structured" : "Rendered"}</button><button class="${rawMode ? "selected" : ""}" data-mode="raw">Raw content</button></div></header>${view}`,
      file.title,
    );
  } catch (error) {
    return shell(
      `${breadcrumbs(file)}<section class="error-state"><h1>Record unavailable</h1><p>The archive manifest lists this file, but its copied content could not be loaded: ${escapeHtml(error instanceof Error ? error.message : "Unknown error")}.</p></section>`,
      "Record unavailable",
    );
  }
}

function bindPage() {
  document
    .querySelectorAll<HTMLButtonElement>("[data-mode]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        rawMode = button.dataset.mode === "raw";
        void render(true);
      }),
    );
  document
    .querySelector<HTMLInputElement>("#library-search-input")
    ?.addEventListener("input", (event) => {
      searchQuery = (event.currentTarget as HTMLInputElement).value;
      updateSearchResults();
    });
  document
    .querySelector<HTMLInputElement>("#library-search-input")
    ?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        clearSearch();
        (event.currentTarget as HTMLInputElement).blur();
      }
    });
  document
    .querySelector<HTMLButtonElement>("[data-search-clear]")
    ?.addEventListener("click", () => clearSearch(true));
  document.querySelectorAll<HTMLButtonElement>("[data-search-scope]").forEach((button) =>
    button.addEventListener("click", () => {
      searchScope = (button.dataset.searchScope as SearchScope) ?? "all";
      document.querySelectorAll<HTMLButtonElement>("[data-search-scope]").forEach((scopeButton) => {
        scopeButton.classList.toggle("selected", scopeButton === button);
      });
      updateSearchResults();
    }),
  );
  document
    .querySelectorAll<HTMLAnchorElement>("[data-search-result]")
    .forEach((result) => result.addEventListener("click", () => clearSearch()));
}

async function render(preserveMode = false) {
  activePath = pathFromHash();
  if (!preserveMode) rawMode = false;
  if (!manifest) {
    app!.innerHTML = shell(
      `<section class="error-state"><h1>Archive manifest unavailable</h1><p>Run <code>npm run generate:kb</code> to create the publishable knowledge-base content.</p></section>`,
      "Archive unavailable",
    );
    return;
  }
  const section = sectionFromHash();
  app!.innerHTML = activePath
    ? await filePage(activePath)
    : section
      ? humanPage(section)
      : home();
  bindPage();
  document
    .querySelector<HTMLElement>("#content")
    ?.focus({ preventScroll: true });
}

async function start() {
  if (!app) return;
  app.innerHTML =
    '<main class="loading"><p>LOADING MOONCAT ARCHIVE…</p></main>';
  try {
    const response = await fetch("./kb/manifest.json");
    if (!response.ok) throw new Error(`Request returned ${response.status}`);
    manifest = (await response.json()) as Manifest;
  } catch {
    manifest = null;
  }
  void loadSearchIndex();
  window.addEventListener("hashchange", () => void render());
  window.addEventListener("keydown", (event) => {
    if (
      event.key.toLocaleLowerCase() === "k" &&
      (event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      document.querySelector<HTMLInputElement>("#library-search-input")?.focus();
    }
  });
  await render();
}

void start();
