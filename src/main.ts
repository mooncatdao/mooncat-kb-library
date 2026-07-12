import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
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

const app = document.querySelector<HTMLDivElement>("#app");
const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});
let manifest: Manifest | null = null;
let activePath = "";
let rawMode = false;

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
const formatSize = (size: number) =>
  size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;

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
  return `<div class="lcars-shell">
    <header class="masthead"><a class="identity" href="#/">MOONCAT<br><span>KNOWLEDGE ARCHIVE</span></a><div class="mast-curve"></div><div class="mast-title">${escapeHtml(title)}</div><div class="cascade" aria-hidden="true">47988&nbsp; 021&nbsp; 740&nbsp; 030&nbsp; 892&nbsp; 72</div></header>
    <div class="bar-row" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
    <div class="library-layout"><aside class="nav-panel"><div class="nav-label">LIBRARY // ${fileCount} RECORDS</div>${manifest ? renderTree(manifest.tree) : ""}</aside><main id="content" tabindex="-1">${content}</main></div>
    <footer><span>MOONCAT KB // READ-ONLY PRESENTATION LAYER</span><span>LCARS interface adapted from <a href="https://www.thelcars.com/" target="_blank" rel="noreferrer">www.TheLCARS.com</a></span></footer>
  </div>`;
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

function home() {
  const cards = [
    ["Start Here", "README.md", "Library orientation and entry points."],
    [
      "Documents",
      "docs/overview.md",
      "Explanations, history, source notes, and methods.",
    ],
    [
      "Data Records",
      "data/agent-index.json",
      "Canonical and curated machine-readable records.",
    ],
    [
      "Examples",
      "examples/rescue-mining-widget/README.md",
      "Small, publishable reference examples.",
    ],
  ].filter(([, path]) => findFile(path));
  const source = manifest?.source.commit
    ? `SOURCE COMMIT ${manifest.source.commit.slice(0, 12)}`
    : "SOURCE COMMIT UNAVAILABLE";
  return shell(
    `<section class="home-hero"><p class="eyebrow">MOONCAT DAO // KNOWLEDGE SYSTEM</p><h1>MoonCat Knowledge Archive</h1><p>A read-only library for the MoonCat technical knowledge base. Browse its explanations and data records without changing the canonical source.</p><div class="home-meta"><span>${manifest?.fileCount ?? 0} PUBLISHABLE RECORDS</span><span>${source}</span></div></section><section class="entry-grid">${cards.map(([title, path, text], index) => `<a class="entry-card card-${index + 1}" href="${routeFor(path)}"><span>0${index + 1}</span><h2>${title}</h2><p>${text}</p><b>OPEN RECORD →</b></a>`).join("")}</section><section class="home-note"><h2>Archive protocol</h2><p>The KB distinguishes <strong>docs/</strong> for explanatory context from <strong>data/</strong> for exact canonical or curated data. Incomplete facts remain explicitly marked in the source records.</p></section>`,
  );
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
  app!.innerHTML = activePath ? await filePage(activePath) : home();
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
  window.addEventListener("hashchange", () => void render());
  await render();
}

void start();
