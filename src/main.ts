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
  fileRole?: string;
  topics?: string[];
  curationMode?: string;
  statuses?: string[];
  sourceBackedStatus?: string;
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
  fileRole?: string;
  topics?: string[];
  curationMode?: string;
  statuses?: string[];
  sourceBackedStatus?: string;
};
type SearchResult = {
  entry: SearchEntry;
  score: number;
  matchedTokens: number;
};
type SearchScope = "all" | "guides" | "data" | "examples";
type HumanSection = "guide" | "topics" | "examples" | "archive" | "profile";
type ProfileIdentifierKind = "rescueOrder" | "catIdBytes5";
type ProfileShard = {
  path: string;
  startRescueOrder: number;
  endRescueOrder: number;
};
type ProfileLookupArtifact = {
  version: number;
  rowCount: number;
  populationManifestPath: string;
  shards: ProfileShard[];
  catIdToRescueOrder: Record<string, number>;
};
type MooncatProfileRow = {
  catId: string;
  rescueOrder: number;
  traits: Record<string, unknown>;
  genesis: boolean;
  color: Record<string, unknown>;
  rescueBuckets: string[];
  characterCategories: string[];
  name: Record<string, unknown> | null;
};
type ProfileResult = {
  kind: ProfileIdentifierKind;
  value: string;
  normalizedValue: string;
  row: MooncatProfileRow;
  shard: ProfileShard;
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
let searchIndex: SearchEntry[] | null = null;
let searchIndexState: "idle" | "loading" | "ready" | "failed" = "idle";
let searchIndexPromise: Promise<void> | null = null;
let searchQuery = "";
let searchScope: SearchScope = "all";
let archiveTreeScrollTop = 0;
let profileLookup: ProfileLookupArtifact | null = null;
let profileLookupState: "idle" | "loading" | "ready" | "failed" = "idle";
let profileLookupPromise: Promise<void> | null = null;
let profileKind: ProfileIdentifierKind = "rescueOrder";
let profileInput = "";
let profileResult: ProfileResult | null = null;
let profileError = "";
let profileRequestState: "idle" | "loading" = "idle";
const inAppRouteHistory: string[] = [];
let internalRouteClickPending = false;
let archiveSearchFocusPending = false;

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
const currentRoute = () => location.hash || "#/";
const formatSize = (size: number) =>
  size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;

const presentationRoles = new Set([
  "canonical-data",
  "documentation",
  "entrypoint",
  "example",
  "generator",
  "license-notice",
  "project-metadata",
  "source-index",
  "validator",
  "workflow-data",
]);
const presentationCurationModes = new Set(["curated", "generated", "local-policy"]);
const presentationStatuses = new Set(["curated", "doc", "example", "generated", "script"]);
const presentationSourceStatuses = new Set([
  "contains-source-reference",
  "not-applicable",
  "registered-source",
]);

type PresentationCarrier = Pick<
  SearchEntry,
  "fileRole" | "topics" | "curationMode" | "statuses" | "sourceBackedStatus"
>;

function safePresentationMetadata(value: unknown): PresentationCarrier {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const metadata: PresentationCarrier = {};
  if (typeof source.fileRole === "string" && presentationRoles.has(source.fileRole))
    metadata.fileRole = source.fileRole;
  if (typeof source.curationMode === "string" && presentationCurationModes.has(source.curationMode))
    metadata.curationMode = source.curationMode;
  if (typeof source.sourceBackedStatus === "string" && presentationSourceStatuses.has(source.sourceBackedStatus))
    metadata.sourceBackedStatus = source.sourceBackedStatus;
  if (Array.isArray(source.topics)) {
    const topics = [...new Set(source.topics)].filter(
      (topic): topic is string => typeof topic === "string" && topic.length <= 64,
    ).slice(0, 8);
    if (topics.length) metadata.topics = topics;
  }
  if (Array.isArray(source.statuses)) {
    const statuses = [...new Set(source.statuses)].filter(
      (status): status is string => typeof status === "string" && presentationStatuses.has(status),
    );
    if (statuses.length) metadata.statuses = statuses;
  }
  return metadata;
}

function metadataBadges(record: PresentationCarrier) {
  const roleLabels: Record<string, string> = {
    "canonical-data": "DATA",
    documentation: "DOC",
    entrypoint: "ENTRY",
    example: "EXAMPLE",
    generator: "GENERATOR",
    "license-notice": "LICENSE",
    "project-metadata": "META",
    "source-index": "SOURCE",
    validator: "VALIDATOR",
    "workflow-data": "WORKFLOW",
  };
  const curationLabels: Record<string, string> = {
    curated: "CURATED",
    generated: "GENERATED",
    "local-policy": "LOCAL",
  };
  const sourceLabels: Record<string, string> = {
    "registered-source": "SOURCE",
    "contains-source-reference": "SOURCE REF",
  };
  const badges = [
    record.fileRole ? roleLabels[record.fileRole] : "",
    record.curationMode ? curationLabels[record.curationMode] : "",
    record.sourceBackedStatus ? sourceLabels[record.sourceBackedStatus] : "",
  ].filter(Boolean);
  return badges;
}

function metadataSummary(record: PresentationCarrier) {
  const safe = safePresentationMetadata(record);
  const badges = metadataBadges(safe);
  const topics = safe.topics?.slice(0, 3) ?? [];
  if (!badges.length && !topics.length) return "";
  return `<div class="record-metadata">${badges.map((badge) => `<span>${escapeHtml(badge)}</span>`).join("")}${topics.length ? `<small>TOPICS · ${escapeHtml(topics.join(" · "))}</small>` : ""}</div>`;
}

function searchTokens(query: string) {
  return [...new Set(query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean))];
}

function entryMatchesScope(entry: SearchEntry) {
  if (searchScope === "guides")
    return entry.type === "markdown" &&
      (entry.fileRole === "documentation" || entry.fileRole === "entrypoint" || entry.path === "README.md" || entry.path === "CONTRIBUTING.md" || entry.path.startsWith("docs/"));
  if (searchScope === "data")
    return entry.fileRole === "canonical-data" || entry.fileRole === "workflow-data" || entry.path.startsWith("data/");
  if (searchScope === "examples") return entry.fileRole === "example" || entry.path.startsWith("examples/");
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
        if (entry.topics?.some((topic) => topic.toLocaleLowerCase().includes(token))) {
          score += 18;
          matched = true;
        }
        if (entry.fileRole === "documentation" || entry.fileRole === "entrypoint") score += 2;
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
      const badges = metadataBadges(entry);
      const topicHint = entry.topics?.slice(0, 2).join(" · ");
      return `<li><a data-search-result href="${routeFor(entry.path)}"><strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.path)} · ${escapeHtml(entry.type)}${badges.length ? ` · ${escapeHtml(badges.join(" · "))}` : ""}</span>${topicHint ? `<i>${escapeHtml(topicHint)}</i>` : ""}${snippet ? `<small>${escapeHtml(snippet)}</small>` : ""}</a></li>`;
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
      ).map((entry) => ({ ...entry, ...safePresentationMetadata(entry) }));
      searchIndexState = "ready";
    } catch {
      searchIndex = null;
      searchIndexState = "failed";
    }
    updateSearchResults();
  })();
  return searchIndexPromise;
}

function isProfileLookupArtifact(value: unknown): value is ProfileLookupArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const artifact = value as Partial<ProfileLookupArtifact>;
  return (
    artifact.version === 1 &&
    artifact.rowCount === 25440 &&
    artifact.populationManifestPath === "data/mooncat-population/manifest.json" &&
    Array.isArray(artifact.shards) &&
    artifact.shards.length > 0 &&
    artifact.shards.every(
      (shard) =>
        typeof shard === "object" &&
        shard !== null &&
        typeof shard.path === "string" &&
        typeof shard.startRescueOrder === "number" &&
        typeof shard.endRescueOrder === "number",
    ) &&
    !!artifact.catIdToRescueOrder &&
    typeof artifact.catIdToRescueOrder === "object" &&
    !Array.isArray(artifact.catIdToRescueOrder)
  );
}

async function loadProfileLookup() {
  if (profileLookupPromise) return profileLookupPromise;
  profileLookupState = "loading";
  profileLookupPromise = (async () => {
    try {
      const response = await fetch("./kb/profile-lookup.json");
      if (!response.ok) throw new Error(`Request returned ${response.status}`);
      const payload: unknown = await response.json();
      if (!isProfileLookupArtifact(payload)) throw new Error("Invalid profile lookup artifact");
      profileLookup = payload;
      profileLookupState = "ready";
    } catch {
      profileLookup = null;
      profileLookupState = "failed";
    }
  })();
  return profileLookupPromise;
}

function profileShardForOrder(rescueOrder: number) {
  return profileLookup?.shards.find(
    (shard) =>
      rescueOrder >= shard.startRescueOrder && rescueOrder <= shard.endRescueOrder,
  );
}

function isProfileRow(value: unknown): value is MooncatProfileRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<MooncatProfileRow>;
  return (
    typeof row.catId === "string" &&
    typeof row.rescueOrder === "number" &&
    !!row.traits &&
    typeof row.traits === "object" &&
    !Array.isArray(row.traits) &&
    typeof row.genesis === "boolean" &&
    !!row.color &&
    typeof row.color === "object" &&
    !Array.isArray(row.color) &&
    Array.isArray(row.rescueBuckets) &&
    Array.isArray(row.characterCategories) &&
    (row.name === null || (typeof row.name === "object" && !Array.isArray(row.name)))
  );
}

async function readProfileRow(shard: ProfileShard, rescueOrder: number, catId?: string) {
  const response = await fetch(
    `./kb/content/${shard.path.split("/").map(encodeURIComponent).join("/")}`,
  );
  if (!response.ok) throw new Error(`Request returned ${response.status}`);
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { rows?: unknown }).rows))
    throw new Error("Population shard has no rows");
  const row = (payload as { rows: unknown[] }).rows.find((candidate) => {
    if (!isProfileRow(candidate)) return false;
    return catId ? candidate.catId === catId : candidate.rescueOrder === rescueOrder;
  });
  if (!isProfileRow(row)) throw new Error("Population row unavailable");
  return row;
}

async function lookupProfile() {
  profileResult = null;
  profileError = "";
  profileRequestState = "loading";
  const rawValue = profileInput.trim();
  try {
    await loadProfileLookup();
    if (!profileLookup || profileLookupState !== "ready") {
      profileError = "The generated static profile index is unavailable. Open the archive or try again after regenerating the KB.";
      return;
    }

    let rescueOrder: number;
    let normalizedValue: string;
    let normalizedCatId: string | undefined;
    if (profileKind === "rescueOrder") {
      if (!/^\d+$/.test(rawValue)) {
        profileError = "Rescue order must be a whole number from 0 through 25439.";
        return;
      }
      rescueOrder = Number(rawValue);
      if (!Number.isSafeInteger(rescueOrder) || rescueOrder < 0 || rescueOrder > 25439) {
        profileError = "Rescue order must be a whole number from 0 through 25439.";
        return;
      }
      normalizedValue = String(rescueOrder);
    } else {
      if (!/^0x[0-9a-fA-F]{10}$/.test(rawValue)) {
        profileError = "Cat ID must use 0x followed by exactly 10 hexadecimal digits.";
        return;
      }
      normalizedCatId = rawValue.toLowerCase();
      const mappedOrder = profileLookup.catIdToRescueOrder[normalizedCatId];
      if (!Number.isInteger(mappedOrder)) {
        profileError = `No static population row matches Cat ID ${normalizedCatId}.`;
        return;
      }
      rescueOrder = mappedOrder;
      normalizedValue = normalizedCatId;
    }

    const shard = profileShardForOrder(rescueOrder);
    if (!shard) {
      profileError = "The generated profile index has no shard for that rescue order.";
      return;
    }
    const row = await readProfileRow(shard, rescueOrder, normalizedCatId);
    profileResult = {
      kind: profileKind,
      value: rawValue,
      normalizedValue,
      row,
      shard,
    };
  } catch {
    profileError = "The static population row could not be loaded from the generated KB.";
  } finally {
    profileRequestState = "idle";
  }
}

function profileValue(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return escapeHtml(String(value));
}

function profileList(values: string[]) {
  return values.length
    ? `<ul class="profile-list">${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`
    : '<p class="profile-muted">None recorded</p>';
}

function profileObjectFields(values: Record<string, unknown>) {
  return Object.entries(values)
    .map(([key, value]) => `<div><dt>${escapeHtml(labelFor(key))}</dt><dd>${profileValue(value)}</dd></div>`)
    .join("");
}

function profileSourceLink(path: string, label: string) {
  return findFile(path)
    ? `<a href="${routeFor(path)}">${escapeHtml(label)}</a>`
    : `<span>${escapeHtml(label)}</span>`;
}

function profileResultMarkup() {
  if (profileRequestState === "loading") return '<p class="profile-status">Loading the static population row…</p>';
  if (profileLookupState === "failed" && !profileResult) return '<p class="profile-error" role="alert">The generated static profile index is unavailable. Open the archive or regenerate the KB artifacts.</p>';
  if (profileError) return `<p class="profile-error" role="alert">${escapeHtml(profileError)}</p>`;
  if (!profileResult) return '<p class="profile-muted">Enter an explicit identifier to resolve one static population row.</p>';
  const { row, shard } = profileResult;
  const nameText = row.name && typeof row.name.text === "string" ? row.name.text : "Unnamed in the pinned finalized snapshot";
  const nameMeta = row.name
    ? `<small>FINALIZED SNAPSHOT · ${row.name.namedYear ? `NAMED ${profileValue(row.name.namedYear)}` : "RECORDED NAME"}</small>`
    : `<small>NAME FIELD IS NULL IN THE PINNED FINALIZED SNAPSHOT</small>`;
  return `<article class="profile-result"><header class="profile-result-header"><p class="eyebrow">STATIC POPULATION ROW</p><h2>${escapeHtml(nameText)}</h2><p class="profile-result-id"><code>${escapeHtml(row.catId)}</code><span>RESCUE ORDER ${row.rescueOrder}</span></p>${nameMeta}</header><div class="profile-field-grid"><section class="profile-field"><h3>Identity</h3><dl>${profileObjectFields({ catId: row.catId, rescueOrder: row.rescueOrder })}</dl></section><section class="profile-field"><h3>Traits</h3><dl>${profileObjectFields(row.traits)}</dl></section><section class="profile-field"><h3>Color classification</h3><dl>${profileObjectFields(row.color)}</dl><p class="profile-muted">Display classification only; not an on-chain trait, palette, rarity, or rendering proof.</p></section><section class="profile-field"><h3>Membership</h3><dl><div><dt>Genesis</dt><dd>${profileValue(row.genesis)}</dd></div></dl><h4>Rescue buckets</h4>${profileList(row.rescueBuckets)}<h4>Character categories</h4>${profileList(row.characterCategories)}</section></div><aside class="profile-provenance"><h3>Static provenance boundary</h3><p>This profile is read from the generated MoonCat KB population snapshot. It does not establish current ownership, accessory state, market state, live chain/API state, provisional naming, or complete naming history.</p><p class="profile-links">${profileSourceLink("docs/mooncat-population-index.md", "Population index")}${profileSourceLink("docs/identifier-conventions.md", "Identifier conventions")}${profileSourceLink("data/mooncat-population/manifest.json", "Population manifest")}${profileSourceLink(shard.path, "Underlying shard")}</p></aside></article>`;
}

function profilePage() {
  const inputLabel = profileKind === "rescueOrder" ? "Rescue order (0–25439)" : "Cat ID (0x + 10 hex digits)";
  return shell(`<section class="profile-page"><p class="eyebrow">HUMAN ENTRYPOINT // STATIC LOOKUP</p><h1>MoonCat profile lookup</h1><p class="curated-lede">Resolve one MoonCat from the generated population snapshot by choosing an identifier kind explicitly. This lookup is local and read-only.</p>${lcarsTextBar("Resolve a MoonCat")}<form class="profile-lookup-form" data-profile-form><label for="profile-identifier-kind">Identifier kind</label><select id="profile-identifier-kind" data-profile-kind><option value="rescueOrder" ${profileKind === "rescueOrder" ? "selected" : ""}>Rescue order</option><option value="catIdBytes5" ${profileKind === "catIdBytes5" ? "selected" : ""}>Bytes5 Cat ID</option></select><label for="profile-identifier">${inputLabel}</label><input id="profile-identifier" data-profile-input required autocomplete="off" spellcheck="false" value="${escapeHtml(profileInput)}" placeholder="${profileKind === "rescueOrder" ? "e.g. 100" : "e.g. 0x00958b3253"}"/><button type="submit" ${profileRequestState === "loading" ? "disabled" : ""}>Resolve static profile</button></form><p class="profile-help">No bare value is guessed: the selected kind controls validation. Uppercase hexadecimal letters are accepted and displayed normalized to lowercase.</p><div data-profile-result>${profileResultMarkup()}</div></section>`, humanSectionTitle("profile"));
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
  return ["guide", "topics", "examples", "archive", "profile"].includes(section)
    ? (section as HumanSection)
    : "";
}

function rememberInternalRouteClick(event: MouseEvent) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) return;
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest<HTMLAnchorElement>('a[href^="#/"]');
  const destination = link?.getAttribute("href");
  if (!destination || destination === currentRoute()) return;
  inAppRouteHistory.push(currentRoute());
  internalRouteClickPending = true;
}

function reconcileRouteHistory() {
  if (internalRouteClickPending) {
    internalRouteClickPending = false;
    return;
  }
  const existingIndex = inAppRouteHistory.lastIndexOf(currentRoute());
  if (existingIndex >= 0) inAppRouteHistory.splice(existingIndex);
}

function navigateBack() {
  while (inAppRouteHistory.at(-1) === currentRoute()) inAppRouteHistory.pop();
  const destination = inAppRouteHistory.pop() ?? "#/";
  if (destination !== currentRoute()) location.hash = destination;
}

function lcarsTextBar(label: string) {
  return `<div class="lcars-text-bar"><h2>${escapeHtml(label)}</h2></div>`;
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
    profile: "MoonCat Profile Lookup",
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
  const navItems: [string, string, string?][] = [
    ["Guide", guideHref],
    ["Topics", routeForSection("topics")],
    ["Examples", routeForSection("examples")],
    ["Profile", routeForSection("profile")],
    ["Search", routeForSection("archive"), "search"],
    ["Archive", routeForSection("archive"), "archive"],
  ];
  const nav = navItems
    .map(
      ([label, href, action], index) =>
        `<a href="${href}"${action ? ` data-top-action="${action}"` : ""}><span>0${index + 1}</span>${label}</a>`,
    )
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
  const workspaceClass = sectionFromHash() === "archive"
    ? "library-workspace archive-first"
    : "library-workspace";
  return `<section class="wrap-standard" id="column-3">
    <div class="wrap shell-header-row">
      <div class="left-frame-top">
        <a class="panel-1-button" href="#/"><span>MOONCAT</span><span>KNOWLEDGE</span><span>ARCHIVE</span></a>
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
          <button type="button" class="panel-3" data-back-control aria-label="Back to previous library page">03<span class="hop" aria-hidden="true"><i>-</i>BACK</span></button>
          <a class="panel-4" href="${routeForSection("archive")}" data-left-action="data">04<span class="hop"><i aria-hidden="true">-</i>DATA</span></a>
          <a class="panel-5" href="${routeFor("docs/contract-abi-event-registry.md")}">05<span class="hop"><i aria-hidden="true">-</i>CONTRACTS</span></a>
          <a class="panel-6" href="${routeFor("docs/reference-policy.md")}">06<span class="hop"><i aria-hidden="true">-</i>SOURCES</span></a>
          <a class="panel-7" href="${routeFor("data/kb-gap-index.json")}">07<span class="hop"><i aria-hidden="true">-</i>GAPS</span></a>
          <a class="panel-8" href="${routeFor("docs/agent-usage.md")}">08<span class="hop"><i aria-hidden="true">-</i>AGENTS</span></a>
          <a class="panel-9" href="${routeFor("docs/kb-integrity.md")}">09<span class="hop"><i aria-hidden="true">-</i>INTEGRITY</span></a>
          <a class="panel-10" href="${routeFor("CONTRIBUTING.md")}">10<span class="hop"><i aria-hidden="true">-</i>CONTRIBUTE</span></a>
        </div>
      </aside>
      <div class="right-frame">
        <div class="bar-panel" aria-hidden="true"><div class="bar-6"></div><div class="bar-7"></div><div class="bar-8"></div><div class="bar-9"></div><div class="bar-10"></div></div>
        <main id="content" tabindex="-1"><div class="${workspaceClass}">${library}<div class="content-pane">${content}</div></div></main>
        <footer class="site-footer"><span>MOONCAT KB // READ-ONLY PRESENTATION LAYER</span><span>LCARS Inspired Website Template by <a href="https://www.thelcars.com/" target="_blank" rel="noreferrer">www.TheLCARS.com</a>.</span></footer>
      </div>
    </div>
  </section>`;
}

function renderTree(node: FolderNode, depth = 0): string {
  return `<ul class="tree ${depth ? "nested" : ""}">${node.children
    .map((child) => {
      if (child.kind === "file") {
        const badges = metadataBadges(child);
        return `<li><a class="tree-file ${child.path === activePath ? "active" : ""}" href="${routeFor(child.path)}" title="${escapeHtml(child.path)}"><span>${escapeHtml(child.title)}</span><span class="tree-file-meta">${badges.map((badge) => `<i>${badge}</i>`).join("")}<em>${child.extension.slice(1)}</em></span></a></li>`;
      }
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
      `<section class="curated-page"><p class="eyebrow">HUMAN ENTRYPOINT // START HERE</p><h1>Using MoonCat KB</h1><p class="curated-lede">A goal-oriented introduction to the archive, its evidence boundaries, and the quickest route to a useful answer.</p>${lcarsTextBar("Start here")}<div class="curated-actions">${guideLink}<a class="curated-secondary" href="${routeForSection("topics")}"><strong>Explore by goal</strong><small>Choose a topic without browsing folders.</small></a></div><section class="curated-note"><h2>Read the guide first</h2><p>The guide is the primary human starting point. The complete technical archive remains available as a secondary, file-oriented view.</p></section></section>`,
      humanSectionTitle(section),
    );
  if (section === "topics")
    return shell(
      `<section class="curated-page"><p class="eyebrow">HUMAN ENTRYPOINT // TOPICS</p><h1>Explore by goal</h1><p class="curated-lede">Choose a starting point by what you want to understand or build. Each card routes to an existing source document.</p>${lcarsTextBar("Curated destinations")}<div class="curated-actions"><a class="curated-primary" href="${routeForSection("profile")}"><strong>Look up one MoonCat</strong><small>Resolve a rescue order or bytes5 Cat ID from the static population.</small></a></div>${curatedCards(LIBRARY_TOPICS)}<div class="curated-actions"><a class="curated-secondary" href="${routeForSection("guide")}"><strong>Read the human guide</strong><small>Get the archive's orientation and boundaries.</small></a><a class="curated-secondary" href="${routeForSection("archive")}"><strong>Open all records</strong><small>Browse the complete generated file tree.</small></a></div></section>`,
      humanSectionTitle(section),
    );
  if (section === "examples")
    return shell(
      `<section class="curated-page"><p class="eyebrow">HUMAN ENTRYPOINT // EXAMPLES</p><h1>Executable examples</h1><p class="curated-lede">Small, local examples that demonstrate bounded ways to use the KB without adding a live service or competing dataset.</p>${lcarsTextBar("Local examples")}${curatedCards(LIBRARY_EXAMPLES, "curated-grid examples-grid")}<div class="curated-actions"><a class="curated-secondary" href="${routeForSection("guide")}"><strong>Read the human guide</strong><small>Choose a goal before opening an implementation.</small></a><a class="curated-secondary" href="${routeForSection("archive")}"><strong>Open all records</strong><small>Find supporting docs and data in the technical tree.</small></a></div></section>`,
      humanSectionTitle(section),
    );
  if (section === "profile") return profilePage();
  return shell(
    `<section class="curated-page"><p class="eyebrow">SECONDARY VIEW // COMPLETE FILE TREE</p><h1>Technical archive</h1><p class="curated-lede">All generated Markdown, JSON, and text records remain available in the archive browser at left. Use search or the tree when you already know the file or need technical detail.</p>${lcarsTextBar("Browse all records")}<div class="curated-actions"><a class="curated-primary" href="${routeForSection("guide")}"><strong>Return to human guide</strong><small>Start with a goal-oriented route.</small></a><a class="curated-secondary" href="${routeForSection("topics")}"><strong>Browse curated topics</strong><small>Use the human-facing entrypoints.</small></a></div></section>`,
    humanSectionTitle(section),
  );
}

function home() {
  const source = manifest?.source.commit
    ? `SOURCE COMMIT ${manifest.source.commit.slice(0, 12)}`
    : "SOURCE COMMIT UNAVAILABLE";
  return shell(
    `<section class="home-hero"><p class="eyebrow">MOONCAT DAO // HUMAN-FIRST KNOWLEDGE SYSTEM</p><h1>MoonCat Knowledge Archive</h1><p>A read-only library for people who want a useful starting point before opening the complete technical record set.</p><div class="home-meta"><span>${manifest?.fileCount ?? 0} PUBLISHABLE RECORDS</span><span>${source}</span></div></section><section class="guide-spotlight"><p class="eyebrow">PRIMARY STARTING POINT</p>${lcarsTextBar("Using MoonCat KB")}<p>Begin with the goal-oriented guide, then follow a curated topic or example into the source-backed archive.</p>${guideLinkMarkup()}<div class="spotlight-links"><a href="${routeForSection("topics")}">Explore by goal <span>→</span></a><a href="${routeForSection("examples")}">Open examples <span>→</span></a><a href="${routeForSection("profile")}">Profile lookup <span>→</span></a><a href="${routeForSection("archive")}">Technical archive <span>→</span></a></div></section><section class="home-topic-preview"><div><p class="eyebrow">CURATED TOPICS</p>${lcarsTextBar("Where do you want to go?")}</div><div class="topic-preview-grid">${LIBRARY_TOPICS.slice(0, 6).map((link) => linkMarkup(link, "topic-preview-link")).filter(Boolean).join("")}</div><a class="curated-secondary" href="${routeForSection("topics")}"><strong>See all topics</strong><small>Browse the complete goal-oriented index.</small></a></section>`,
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
  holder.querySelectorAll<HTMLElement>("code").forEach((code) => {
    if (code.closest("pre, a")) return;
    const exactPath = code.textContent ?? "";
    if (exactPath.trim() !== exactPath || !looksLikePath(exactPath)) return;
    if (!findFile(exactPath)) return;
    const link = document.createElement("a");
    link.className = "inline-file-link";
    link.href = routeFor(exactPath);
    code.replaceWith(link);
    link.append(code);
  });
  holder.querySelectorAll<HTMLUListElement>("ul").forEach((list) =>
    list.classList.add("lcars-list"),
  );
  holder.querySelectorAll<HTMLHRElement>("hr").forEach((rule) => {
    const bar = document.createElement("div");
    bar.className = "lcars-bar";
    bar.setAttribute("role", "separator");
    rule.replaceWith(bar);
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
  return /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.(?:md|json)$/i.test(value);
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
      `${breadcrumbs(file)}<header class="record-header"><p class="eyebrow">${file.type.toUpperCase()} RECORD // ${formatSize(file.size)}</p><h1>${escapeHtml(file.title)}</h1><p>${escapeHtml(file.path)}</p>${metadataSummary(file)}<div class="view-switch"><button class="${!rawMode ? "selected" : ""}" data-mode="structured">${file.type === "json" ? "Structured" : "Rendered"}</button><button class="${rawMode ? "selected" : ""}" data-mode="raw">Raw content</button></div></header>${view}`,
      file.title,
    );
  } catch (error) {
    return shell(
      `${breadcrumbs(file)}<section class="error-state"><h1>Record unavailable</h1><p>The archive manifest lists this file, but its copied content could not be loaded: ${escapeHtml(error instanceof Error ? error.message : "Unknown error")}.</p></section>`,
      "Record unavailable",
    );
  }
}

function updateSearchScopeControls() {
  document.querySelectorAll<HTMLButtonElement>("[data-search-scope]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.searchScope === searchScope);
  });
}

function focusArchiveSearch() {
  document.querySelector<HTMLInputElement>("#library-search-input")?.focus();
}

function bindPage() {
  document
    .querySelector<HTMLButtonElement>("[data-back-control]")
    ?.addEventListener("click", navigateBack);
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
      updateSearchScopeControls();
      updateSearchResults();
    }),
  );
  document.querySelectorAll<HTMLAnchorElement>("[data-top-action]").forEach((link) =>
    link.addEventListener("click", (event) => {
      const action = link.dataset.topAction;
      if (action === "search") {
        if (currentRoute() === routeForSection("archive")) {
          archiveSearchFocusPending = false;
          event.preventDefault();
          focusArchiveSearch();
        } else {
          archiveSearchFocusPending = true;
        }
      } else if (action === "archive") {
        archiveSearchFocusPending = false;
        searchScope = "all";
        if (currentRoute() === routeForSection("archive")) {
          event.preventDefault();
          updateSearchScopeControls();
          updateSearchResults();
        }
      }
    }),
  );
  document.querySelectorAll<HTMLAnchorElement>("[data-left-action='data']").forEach((link) =>
    link.addEventListener("click", (event) => {
      searchScope = "data";
      if (currentRoute() === routeForSection("archive")) {
        event.preventDefault();
        updateSearchScopeControls();
        updateSearchResults();
        focusArchiveSearch();
      } else {
        archiveSearchFocusPending = true;
      }
    }),
  );
  document
    .querySelectorAll<HTMLAnchorElement>("[data-search-result]")
    .forEach((result) => result.addEventListener("click", () => clearSearch()));
  const profileForm = document.querySelector<HTMLFormElement>("[data-profile-form]");
  const profileSelect = document.querySelector<HTMLSelectElement>("[data-profile-kind]");
  const profileInputElement = document.querySelector<HTMLInputElement>("[data-profile-input]");
  profileSelect?.addEventListener("change", () => {
    profileKind = profileSelect.value === "catIdBytes5" ? "catIdBytes5" : "rescueOrder";
    profileInput = profileInputElement?.value ?? "";
    profileResult = null;
    profileError = "";
    void render(true);
  });
  profileForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    profileKind = profileSelect?.value === "catIdBytes5" ? "catIdBytes5" : "rescueOrder";
    profileInput = profileInputElement?.value ?? "";
    void lookupProfile().then(() => {
      if (sectionFromHash() === "profile") void render(true);
    });
  });
  if (sectionFromHash() === "profile" && profileLookupState === "idle") {
    void loadProfileLookup().then(() => {
      if (sectionFromHash() === "profile") void render(true);
    });
  }
}

async function render(preserveMode = false) {
  activePath = pathFromHash();
  if (!preserveMode) rawMode = false;
  const currentTree = app?.querySelector<HTMLElement>(".library-tree-scroll");
  if (currentTree) archiveTreeScrollTop = currentTree.scrollTop;
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
  const nextTree = app?.querySelector<HTMLElement>(".library-tree-scroll");
  if (nextTree) nextTree.scrollTop = archiveTreeScrollTop;
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
  document.addEventListener("click", rememberInternalRouteClick);
  window.addEventListener("hashchange", () => {
    reconcileRouteHistory();
    void render().then(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      const shouldFocusArchiveSearch = archiveSearchFocusPending;
      archiveSearchFocusPending = false;
      if (shouldFocusArchiveSearch && sectionFromHash() === "archive") {
        focusArchiveSearch();
      }
    });
  });
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
