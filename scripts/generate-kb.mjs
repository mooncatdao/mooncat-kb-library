import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');
const kbRoot = resolve(process.env.MCKB_PATH || join(repoRoot, '..', 'mckb'));
const outputRoot = join(repoRoot, 'public', 'kb');
const contentRoot = join(outputRoot, 'content');
const supportedExtensions = new Set(['.md', '.json', '.txt']);
const rootFiles = new Set(['README.md', 'llms.txt']);
const allowedRoots = new Set(['docs', 'data', 'examples']);
const excludedNames = new Set(['result.md', 'agents.md', 'references', 'scripts', '.git', 'node_modules']);
const maxSearchTextLength = 24000;

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

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(contentRoot, { recursive: true });
const tree = makeFolder('', '');

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
  })),
}, null, 2)}\n`);
console.log(`Generated ${files.length} KB files from ${kbRoot}`);
