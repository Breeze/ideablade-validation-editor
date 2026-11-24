// The editor's project file, an IdeaBlade Validation Project (*.ivproj, such as temphire.ivproj): the metadata files
// to open together, the sources, and the settings a team shares (other validators, camelCase). It's JSON. Paths in it
// are relative to it, with forward slashes, so it works in every clone; the renderer gets them absolute. Keys the
// editor doesn't know (such as $comment) are kept when it writes the file.
const fs = require('node:fs/promises');
const path = require('node:path');

const PROJECT_EXTENSION = '.ivproj';

function isProjectFile(filePath) {
  return path.extname(filePath).toLowerCase() === PROJECT_EXTENSION;
}

/**
 * The project for a file: the *.ivproj in its folder, or in the nearest folder above that has one. With several in
 * one folder, the first by name.
 */
async function findProject(filePath) {
  let dir = path.dirname(path.resolve(filePath));
  for (;;) {
    try {
      const projects = (await fs.readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isFile() && isProjectFile(e.name))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
      if (projects.length) return path.join(dir, projects[0]);
    } catch {
      // not readable: go on up
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** A project file name for a folder, with the extension: `temphire.angular` -> `temphire.angular.ivproj`. */
function projectFileName(name) {
  const base = name.replace(/\.ivproj$/i, '').trim() || 'validation';
  return `${base}${PROJECT_EXTENSION}`;
}

/** The project from its JSON text, with absolute paths. */
function parseProject(projectPath, text) {
  const json = JSON.parse(text);
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error('A project file is a JSON object.');
  const dir = path.dirname(projectPath);
  const paths = (key) => {
    const value = json[key] ?? [];
    if (!Array.isArray(value) || value.some((p) => typeof p !== 'string')) throw new Error(`'${key}' must be a list of paths.`);
    return value.map((p) => path.resolve(dir, p));
  };
  const otherValidators = json.otherValidators ?? [];
  if (!Array.isArray(otherValidators) || otherValidators.some((v) => typeof v !== 'string')) {
    throw new Error("'otherValidators' must be a list of validator names.");
  }
  // Values to try against pattern rules: { "Address.zipcode": { "shouldPass": [...], "shouldFail": [...] } }.
  const regexTests = {};
  for (const [key, set] of Object.entries(json.regexTests ?? {})) {
    const list = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []);
    if (set && typeof set === 'object') regexTests[key] = { shouldPass: list(set.shouldPass), shouldFail: list(set.shouldFail) };
  }
  return {
    path: projectPath,
    metadata: paths('metadata'),
    sources: paths('sources'),
    otherValidators,
    camelCase: json.camelCase === undefined ? true : json.camelCase !== false,
    regexTests,
  };
}

const isPattern = (p) => /[*?[]/.test(p);

/** The files a source entry stands for: itself, or what a pattern like `client/src/app/core/model/*.ts` matches. */
async function expand(absolutePattern) {
  if (!isPattern(absolutePattern)) return [absolutePattern];
  const files = [];
  // fs.glob wants forward slashes; node_modules never holds the app's own models.
  for await (const file of fs.glob(absolutePattern.split(path.sep).join('/'), { exclude: (f) => /[\\/]node_modules$/.test(f) })) {
    files.push(path.resolve(file));
  }
  return files.sort();
}

/**
 * The project, with absolute paths. `sources` are the entries as written (files or patterns); `sourceFiles` are the
 * files they stand for now, which the editor loads.
 */
async function readProject(projectPath) {
  const project = parseProject(projectPath, await fs.readFile(projectPath, 'utf8'));
  const sourceFiles = [...new Set((await Promise.all(project.sources.map(expand))).flat())];
  return { ...project, sourceFiles };
}

/**
 * The source entries to write for the files the editor has loaded: the file's patterns that still match one of
 * them, then each loaded file no kept pattern covers. A file a pattern matches comes back on the next load even if it
 * was removed in the editor; to drop it, change the pattern.
 */
async function sourceEntries(projectPath, files) {
  let patterns = [];
  try {
    patterns = parseProject(projectPath, await fs.readFile(projectPath, 'utf8')).sources.filter(isPattern);
  } catch {
    patterns = [];
  }
  const kept = [];
  const covered = new Set();
  for (const pattern of patterns) {
    const matches = (await expand(pattern)).filter((f) => files.includes(f));
    if (matches.length) {
      kept.push(pattern);
      matches.forEach((f) => covered.add(f));
    }
  }
  return [...kept, ...files.filter((f) => !covered.has(f))];
}

/** The project file's text: relative paths, and the keys of `existingText` the editor doesn't manage kept as they were. */
function projectText(projectPath, project, existingText) {
  const dir = path.dirname(projectPath);
  const relative = (p) => {
    const r = path.relative(dir, p).split(path.sep).join('/');
    return r === '' ? '.' : r;
  };
  let existing = {};
  try {
    existing = existingText ? JSON.parse(existingText) : {};
  } catch {
    existing = {};
  }
  const managed = {
    metadata: project.metadata.map(relative),
    sources: project.sources.map(relative),
    otherValidators: project.otherValidators,
    camelCase: project.camelCase,
  };
  const json = {
    $comment:
      existing.$comment ??
      'IdeaBlade Validation Editor project: the metadata files to open together, the sources (Breeze metadata, TS and C# files) and shared settings. Paths are relative to this file.',
    ...existing,
    ...managed,
  };
  // The values to try against pattern rules, sorted by rule so the file diffs well; left out when there are none.
  const tests = Object.entries(project.regexTests ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (tests.length) json.regexTests = Object.fromEntries(tests);
  else delete json.regexTests;
  const eol = existingText?.includes('\r\n') ? '\r\n' : '\n';
  return JSON.stringify(json, null, 2).replace(/\n/g, eol) + eol;
}

/** Writes the project; `project.sources` are the loaded source files, written back as the file's patterns where they fit. */
async function writeProject(projectPath, project) {
  let existingText;
  try {
    existingText = await fs.readFile(projectPath, 'utf8');
  } catch {
    existingText = undefined;
  }
  const sources = await sourceEntries(projectPath, project.sources);
  await fs.writeFile(projectPath, projectText(projectPath, { ...project, sources }, existingText), 'utf8');
  return readProject(projectPath);
}

/** The folder a pattern starts in, and whether its wildcards reach into subfolders. */
function patternBase(absolutePattern) {
  const parts = absolutePattern.split(/[\\/]/);
  const first = parts.findIndex(isPattern);
  const rest = parts.slice(first);
  return { dir: parts.slice(0, first).join(path.sep) || path.sep, recursive: rest.length > 1 || rest[0].includes('**') };
}

/**
 * Watches the folders the project's patterns point at, and calls `onChange` with the files they stand for whenever
 * that changes: a new DTO in a folder of DTOs, a deleted entity. Changes to the files themselves are the source
 * watcher's business (main.cjs); this only notices files appearing and disappearing. Returns a function that stops it.
 */
async function watchProjectFolders(projectPath, onChange, settleMs = 300) {
  const project = await readProject(projectPath);
  let current = project.sourceFiles;
  let timer;
  const check = async () => {
    try {
      const next = (await readProject(projectPath)).sourceFiles;
      if (next.length !== current.length || next.some((f, i) => f !== current[i])) {
        current = next;
        onChange(next);
      }
    } catch {
      // the project file is being rewritten, or is broken for now: its own watcher reports that
    }
  };
  const watchers = [];
  const seen = new Set();
  for (const pattern of project.sources.filter(isPattern)) {
    const { dir, recursive } = patternBase(pattern);
    const key = `${dir}|${recursive}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const watcher = require('node:fs').watch(dir, { recursive }, () => {
        clearTimeout(timer);
        timer = setTimeout(check, settleMs); // a generator writes many files at once: look once it's done
      });
      watcher.on('error', () => {});
      watchers.push(watcher);
    } catch {
      // the folder doesn't exist (yet): nothing to watch
    }
  }
  return () => {
    clearTimeout(timer);
    watchers.forEach((w) => w.close());
  };
}

module.exports = { PROJECT_EXTENSION, isProjectFile, projectFileName, findProject, parseProject, projectText, readProject, writeProject, watchProjectFolders, patternBase };
