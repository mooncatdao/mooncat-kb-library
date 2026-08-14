import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const kbRoot = resolve(process.env.MCKB_PATH || join(repoRoot, '..', 'mckb'));
const outputRoot = join(repoRoot, 'public', 'kb');
const contentRoot = join(outputRoot, 'content');
const supportedExtensions = new Set(['.md', '.json', '.txt']);
const rootFiles = new Set(['README.md', 'CONTRIBUTING.md', 'llms.txt']);
const allowedRoots = new Set(['docs', 'data', 'examples']);
const excludedNames = new Set(['result.md', 'agents.md', 'references', 'scripts', '.git', 'node_modules']);
const maxSearchTextLength = 24000;
const allowedFileRoles = new Set(['canonical-data', 'documentation', 'entrypoint', 'example', 'generator', 'license-notice', 'project-metadata', 'source-index', 'validator', 'workflow-data']);
const allowedCurationModes = new Set(['curated', 'generated', 'local-policy']);
const allowedStatuses = new Set(['curated', 'doc', 'example', 'generated', 'script']);
const allowedSourceBackedStatuses = new Set(['contains-source-reference', 'not-applicable', 'registered-source']);

if (!existsSync(kbRoot)) {
  console.error(`MoonCat KB was not found at ${kbRoot}. Set MCKB_PATH to the KB checkout.`);
  process.exit(1);
}

function titleFor(name) {
  return basename(name, extname(name)).replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fileType(extension) {
  if (extension === '.md') return 'markdown';
  if (extension === '.json') return 'json';
  return 'text';
}

function isExcluded(name) {
  return name.startsWith('.') || excludedNames.has(name.toLowerCase());
}

function makeFolder(name, path = '') {
  return { kind: 'folder', name, path, title: name ? titleFor(name) : 'MoonCat KB', children: [] };
}

function scanDirectory(source, destination, relativePath, folder) {
  for (const entry of readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (isExcluded(entry.name)) continue;
    const sourcePath = join(source, entry.name);
    const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const child = makeFolder(entry.name, entryPath);
      scanDirectory(sourcePath, join(destination, entry.name), entryPath, child);
      if (child.children.length) folder.children.push(child);
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    if (!entry.isFile() || !supportedExtensions.has(extension)) continue;
    mkdirSync(destination, { recursive: true });
    cpSync(sourcePath, join(destination, entry.name));
    const stats = statSync(sourcePath);
    folder.children.push({
      kind: 'file', name: entry.name, path: entryPath,
      title: titleFor(entry.name), extension, type: fileType(extension),
      size: stats.size, modified: stats.mtime.toISOString(),
    });
  }
}

function sourceCommit() {
  try {
    return execFileSync('git', ['-C', kbRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function safeMetadataString(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : undefined;
}

function safeMetadataList(value, allowed) {
  if (!Array.isArray(value)) return undefined;
  const values = [...new Set(value)].filter((item) => typeof item === 'string' && allowed.has(item));
  return values.length ? values : undefined;
}

function presentationMetadata(entry) {
  if (!entry || typeof entry !== 'object') return {};
  const metadata = {};
  const fileRole = safeMetadataString(entry.fileRole, allowedFileRoles);
  const curationMode = safeMetadataString(entry.curationMode, allowedCurationModes);
  const statuses = safeMetadataList(entry.statuses, allowedStatuses);
  const sourceBackedStatus = safeMetadataString(entry.sourceBackedStatus, allowedSourceBackedStatuses);
  const topics = Array.isArray(entry.topics)
    ? [...new Set(entry.topics)].filter((topic) => typeof topic === 'string' && topic.length <= 64).slice(0, 8)
    : undefined;
  if (fileRole) metadata.fileRole = fileRole;
  if (topics?.length) metadata.topics = topics;
  if (curationMode) metadata.curationMode = curationMode;
  if (statuses) metadata.statuses = statuses;
  if (sourceBackedStatus) metadata.sourceBackedStatus = sourceBackedStatus;
  return metadata;
}

function readPresentationManifest() {
  try {
    const source = readFileSync(join(kbRoot, 'data', 'kb-manifest.json'), 'utf8');
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed.entries)) return new Map();
    return new Map(parsed.entries.map((entry) => [entry?.path, presentationMetadata(entry)]).filter(([path]) => typeof path === 'string'));
  } catch {
    return new Map();
  }
}

function normalizeSearchText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function markdownSearchText(value) {
  return normalizeSearchText(
    value
      .replace(/```[^\n]*\n?/g, ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[`*_>#~|]/g, ' '),
  );
}

function jsonSearchText(value, terms = []) {
  if (value === null) {
    terms.push('null');
  } else if (Array.isArray(value)) {
    value.forEach((item) => jsonSearchText(item, terms));
  } else if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      terms.push(key);
      jsonSearchText(item, terms);
    });
  } else {
    terms.push(String(value));
  }
  return terms;
}

function searchTextFor(file) {
  const source = readFileSync(join(contentRoot, file.path), 'utf8');
  const text = file.type === 'markdown'
    ? markdownSearchText(source)
    : file.type === 'json'
      ? (() => {
          try {
            return normalizeSearchText(jsonSearchText(JSON.parse(source)).join(' '));
          } catch {
            return normalizeSearchText(source);
          }
        })()
      : normalizeSearchText(source);
  return text.slice(0, maxSearchTextLength);
}

function buildRenderLookup() {
  const manifestPath = join(kbRoot, 'data', 'mooncat-renders', 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const renderManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const shards = renderManifest?.layout?.shards;
    const encoding = renderManifest?.encoding;
    if (
      renderManifest?.rowCount !== 25440 ||
      renderManifest?.layout?.kind !== 'fixed-rescue-order-shards' ||
      !Array.isArray(shards) ||
      shards.length !== 26 ||
      renderManifest?.layout?.shardCount !== 26 ||
      encoding?.id !== 'palette-index-nibble-base64-v1'
    ) return null;
    const normalizedShards = shards.map((shard) => {
      if (
        typeof shard?.path !== 'string' ||
        !shard.path.startsWith('data/mooncat-renders/shards/') ||
        shard.path.split('/').includes('..') ||
        !Number.isInteger(shard.startRescueOrder) ||
        !Number.isInteger(shard.endRescueOrder) ||
        !Number.isInteger(shard.rowCount) ||
        shard.startRescueOrder < 0 ||
        shard.endRescueOrder > 25439 ||
        shard.startRescueOrder > shard.endRescueOrder ||
        shard.rowCount !== shard.endRescueOrder - shard.startRescueOrder + 1 ||
        !existsSync(join(kbRoot, shard.path))
      ) throw new Error('Invalid render shard metadata');
      return {
        path: shard.path,
        startRescueOrder: shard.startRescueOrder,
        endRescueOrder: shard.endRescueOrder,
      };
    });
    normalizedShards.sort((left, right) => left.startRescueOrder - right.startRescueOrder);
    if (
      normalizedShards[0]?.startRescueOrder !== 0 ||
      normalizedShards.at(-1)?.endRescueOrder !== 25439 ||
      normalizedShards.some((shard, index) =>
        index > 0 && shard.startRescueOrder !== normalizedShards[index - 1].endRescueOrder + 1,
      )
    ) return null;
    return {
      manifestPath: 'data/mooncat-renders/manifest.json',
      rowCount: 25440,
      encoding: 'palette-index-nibble-base64-v1',
      shards: normalizedShards,
    };
  } catch {
    return null;
  }
}

function buildProfileLookup() {
  const manifestPath = join(kbRoot, 'data', 'mooncat-population', 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const populationManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const shards = populationManifest?.layout?.shards;
    if (populationManifest?.rowCount !== 25440 || !Array.isArray(shards)) return null;
    const catIdToRescueOrder = {};
    let rowCount = 0;
    for (const shard of shards) {
      if (typeof shard?.path !== 'string') return null;
      const shardPath = join(kbRoot, shard.path);
      const shardData = JSON.parse(readFileSync(shardPath, 'utf8'));
      if (!Array.isArray(shardData?.rows)) return null;
      for (const row of shardData.rows) {
        if (
          typeof row?.catId !== 'string' ||
          !/^0x[0-9a-f]{10}$/.test(row.catId) ||
          !Number.isInteger(row.rescueOrder) ||
          row.rescueOrder < 0 ||
          row.rescueOrder > 25439
        ) return null;
        if (Object.prototype.hasOwnProperty.call(catIdToRescueOrder, row.catId)) return null;
        catIdToRescueOrder[row.catId] = row.rescueOrder;
        rowCount += 1;
      }
    }
    if (rowCount !== populationManifest.rowCount) return null;
    const render = buildRenderLookup();
    return {
      version: 1,
      rowCount,
      populationManifestPath: 'data/mooncat-population/manifest.json',
      shards: shards.map((shard) => ({
        path: shard.path,
        startRescueOrder: shard.startRescueOrder,
        endRescueOrder: shard.endRescueOrder,
      })),
      catIdToRescueOrder,
      ...(render ? { render } : {}),
    };
  } catch {
    return null;
  }
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(contentRoot, { recursive: true });
const tree = makeFolder('', '');
const presentationByPath = readPresentationManifest();

for (const file of rootFiles) {
  const source = join(kbRoot, file);
  if (!existsSync(source)) continue;
  cpSync(source, join(contentRoot, file));
  const stats = statSync(source);
  const extension = extname(file).toLowerCase();
  tree.children.push({ kind: 'file', name: file, path: file, title: titleFor(file), extension, type: fileType(extension), size: stats.size, modified: stats.mtime.toISOString() });
}

for (const name of allowedRoots) {
  const source = join(kbRoot, name);
  if (!existsSync(source)) continue;
  const folder = makeFolder(name, name);
  scanDirectory(source, join(contentRoot, name), name, folder);
  if (folder.children.length) tree.children.push(folder);
}

const files = [];
function collect(node) {
  if (node.kind === 'file') files.push(node);
  else node.children.forEach(collect);
}
collect(tree);
for (const file of files) Object.assign(file, presentationByPath.get(file.path) || {});
writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  source: { path: relative(repoRoot, kbRoot).split(sep).join('/'), commit: sourceCommit() },
  fileCount: files.length,
  tree,
}, null, 2)}\n`);
writeFileSync(join(outputRoot, 'search-index.json'), `${JSON.stringify({
  version: 1,
  fileCount: files.length,
  entries: files.map((file) => ({
    path: file.path,
    title: file.title,
    type: file.type,
    text: searchTextFor(file),
    ...(presentationByPath.get(file.path) || {}),
  })),
}, null, 2)}\n`);
const profileLookup = buildProfileLookup();
if (profileLookup) {
  writeFileSync(join(outputRoot, 'profile-lookup.json'), `${JSON.stringify(profileLookup)}\n`);
}
console.log(`Generated ${files.length} KB files from ${kbRoot}`);
