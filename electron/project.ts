// The editor's project file, an IdeaBlade Validation Project (*.ivproj, such as temphire.ivproj): the metadata files
// to open together, the sources, and the settings a team shares (other validators, camelCase). It's JSON. Paths in it
// are relative to it, with forward slashes, so it works in every clone; the renderer gets them absolute. Keys the
// editor doesn't know (such as $comment) are kept when it writes the file.
//
// The main process (main.ts) calls these for the renderer's `project:*` and `sources:*-patterns` requests; the
// renderer's view of the results is `Project` and `PatternMatch` in src/app/services/host.ts.
import { watch, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export const PROJECT_EXTENSION = '.ivproj';

/** Values to try against a pattern rule: ones it should accept and ones it should reject. */
export interface RegexTestSet {
  shouldPass: string[];
  shouldFail: string[];
}

/** A project file as read, with absolute paths (`sources` as written: files or patterns). */
export interface ParsedProject {
  path: string;
  metadata: string[];
  sources: string[];
  otherValidators: string[];
  camelCase: boolean;
  regexTests: Record<string, RegexTestSet>;
}

/** A source pattern, absolute, and the files it matches now. */
export interface PatternMatch {
  pattern: string;
  files: string[];
}

/** The project as the renderer gets it: the parsed file plus what its source entries stand for now. */
export interface Project extends ParsedProject {
  /** The files the source entries stand for now, which the editor loads. */
  sourceFiles: string[];
  /** The pattern entries with the files each matches. */
  patterns: PatternMatch[];
}

/** What the renderer asks to write (its ProjectState, with absolute paths). Missing tests mean none. */
export interface ProjectToWrite {
  metadata: string[];
  sources: string[];
  otherValidators: string[];
  camelCase: boolean;
  regexTests?: Record<string, RegexTestSet>;
}

/** True for a project file, by its extension in any case (`TempHire.IVPROJ` too). */
export function isProjectFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === PROJECT_EXTENSION;
}

/**
 * The project for a file: the *.ivproj in its folder, or in the nearest folder above that has one. With several in
 * one folder, the first by name. Used when a metadata file is opened on its own, to open its project with it.
 */
export async function findProject(filePath: string): Promise<string | undefined> {
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

/**
 * A project file name for a folder, with the extension: `temphire.angular` -> `temphire.angular.ivproj`. A name that
 * has the extension already keeps it once; an empty one becomes `validation.ivproj`.
 */
export function projectFileName(name: string): string {
  const base = name.replace(/\.ivproj$/i, '').trim() || 'validation';
  return `${base}${PROJECT_EXTENSION}`;
}

/**
 * The project from its JSON text, with absolute paths (resolved against the project file's folder). Throws with a
 * message for the user when the file isn't a project: not an object, or lists that aren't lists of strings.
 */
export function parseProject(projectPath: string, text: string): ParsedProject {
  const json: unknown = JSON.parse(text);
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error('A project file is a JSON object.');
  const obj = json as Record<string, unknown>;
  const dir = path.dirname(projectPath);
  const paths = (key: string): string[] => {
    const value = obj[key] ?? [];
    if (!Array.isArray(value) || value.some((p) => typeof p !== 'string')) throw new Error(`'${key}' must be a list of paths.`);
    return (value as string[]).map((p) => path.resolve(dir, p));
  };
  const otherValidators = obj['otherValidators'] ?? [];
  if (!Array.isArray(otherValidators) || otherValidators.some((v) => typeof v !== 'string')) {
    throw new Error("'otherValidators' must be a list of validator names.");
  }
  // Values to try against pattern rules: { "Address.zipcode": { "shouldPass": [...], "shouldFail": [...] } }.
  // Anything that isn't a string is dropped rather than refused: the editor writes these, people rarely do.
  const regexTests: Record<string, RegexTestSet> = {};
  for (const [key, set] of Object.entries((obj['regexTests'] ?? {}) as Record<string, unknown>)) {
    const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);
    if (set && typeof set === 'object') {
      const s = set as Record<string, unknown>;
      regexTests[key] = { shouldPass: list(s['shouldPass']), shouldFail: list(s['shouldFail']) };
    }
  }
  return {
    path: projectPath,
    metadata: paths('metadata'),
    sources: paths('sources'),
    otherValidators: otherValidators as string[],
    camelCase: obj['camelCase'] === undefined ? true : obj['camelCase'] !== false,
    regexTests,
  };
}

/** True for a source entry with wildcards (`*`, `?`, `[`), which stands for the files it matches. */
export const isPattern = (p: string): boolean => /[*?[]/.test(p);

/** The files a source entry stands for: itself, or what a pattern like `client/src/app/core/model/*.ts` matches. */
async function expand(absolutePattern: string): Promise<string[]> {
  if (!isPattern(absolutePattern)) return [absolutePattern];
  const files: string[] = [];
  // fs.glob wants forward slashes; node_modules never holds the app's own models.
  for await (const file of fs.glob(absolutePattern.split(path.sep).join('/'), { exclude: (f: string) => /[\\/]node_modules$/.test(f) })) {
    files.push(path.resolve(file));
  }
  return files.sort();
}

/**
 * Patterns (relative ones to `baseDir`), each made absolute, with the files it matches now, in the order given.
 * `dir/**\/*.{ts,cs}` is a folder and its subfolders. The renderer asks for this when sources are added as a folder.
 */
export async function expandPatterns(patterns: string[], baseDir?: string): Promise<PatternMatch[]> {
  return Promise.all(
    patterns.map(async (p) => {
      const pattern = path.resolve(baseDir ?? '', p);
      return { pattern, files: await expand(pattern) };
    }),
  );
}

/**
 * The project, with absolute paths. `sources` are the entries as written (files or patterns); `sourceFiles` are the
 * files they stand for now, which the editor loads; `patterns` are the pattern entries with the files each matches.
 */
export async function readProject(projectPath: string): Promise<Project> {
  const project = parseProject(projectPath, await fs.readFile(projectPath, 'utf8'));
  const sourceFiles = [...new Set((await Promise.all(project.sources.map(expand))).flat())];
  const patterns = await expandPatterns(project.sources.filter(isPattern));
  return { ...project, sourceFiles, patterns };
}

/**
 * The project file's text: relative paths, and the keys of `existingText` the editor doesn't manage kept as they were
 * (a `$comment`, a team's own keys). The existing file's line endings are kept too, so saving doesn't show as a
 * change to every line.
 */
export function projectText(projectPath: string, project: ProjectToWrite, existingText?: string): string {
  const dir = path.dirname(projectPath);
  const relative = (p: string): string => {
    const r = path.relative(dir, p).split(path.sep).join('/');
    return r === '' ? '.' : r;
  };
  let existing: Record<string, unknown> = {};
  try {
    existing = existingText ? (JSON.parse(existingText) as Record<string, unknown>) : {};
  } catch {
    existing = {};
  }
  const managed = {
    metadata: project.metadata.map(relative),
    sources: project.sources.map(relative),
    otherValidators: project.otherValidators,
    camelCase: project.camelCase,
  };
  const json: Record<string, unknown> = {
    $comment:
      existing['$comment'] ??
      'IdeaBlade Validation Editor project: the metadata files to open together, the sources (Breeze metadata, TS and C# files) and shared settings. Paths are relative to this file.',
    ...existing,
    ...managed,
  };
  // The values to try against pattern rules, sorted by rule so the file diffs well; left out when there are none.
  const tests = Object.entries(project.regexTests ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (tests.length) json['regexTests'] = Object.fromEntries(tests);
  else delete json['regexTests'];
  const eol = existingText?.includes('\r\n') ? '\r\n' : '\n';
  return JSON.stringify(json, null, 2).replace(/\n/g, eol) + eol;
}

/**
 * Writes the project; `project.sources` are the entries to write, absolute: files and patterns. Returns the project as
 * read back, so the renderer gets the patterns' files as they are now.
 */
export async function writeProject(projectPath: string, project: ProjectToWrite): Promise<Project> {
  let existingText: string | undefined;
  try {
    existingText = await fs.readFile(projectPath, 'utf8');
  } catch {
    existingText = undefined;
  }
  await fs.writeFile(projectPath, projectText(projectPath, project, existingText), 'utf8');
  return readProject(projectPath);
}

/** The folder a pattern starts in, and whether its wildcards reach into subfolders (what to watch, and how deep). */
export function patternBase(absolutePattern: string): { dir: string; recursive: boolean } {
  const parts = absolutePattern.split(/[\\/]/);
  const first = parts.findIndex(isPattern);
  const rest = parts.slice(first);
  return { dir: parts.slice(0, first).join(path.sep) || path.sep, recursive: rest.length > 1 || rest[0].includes('**') };
}

/**
 * Watches the folders source patterns (absolute) point at, and calls `onChange` with each pattern's files whenever
 * that changes: a new DTO in a folder of DTOs, a deleted entity. The patterns are the editor's, saved to a project or
 * not. Changes to the files themselves are the source watcher's business (main.ts); this only notices files
 * appearing and disappearing. Returns a function that stops it.
 */
export async function watchPatterns(
  patterns: string[],
  onChange: (matches: PatternMatch[]) => void,
  settleMs = 300,
): Promise<() => void> {
  const key = (list: PatternMatch[]): string => JSON.stringify(list.map((p) => p.files));
  let current = key(await expandPatterns(patterns));
  let timer: NodeJS.Timeout | undefined;
  const check = async (): Promise<void> => {
    const next = await expandPatterns(patterns);
    if (key(next) === current) return;
    current = key(next);
    onChange(next);
  };
  const watchers: FSWatcher[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns.filter(isPattern)) {
    const { dir, recursive } = patternBase(pattern);
    const folderKey = `${dir}|${recursive}`;
    if (seen.has(folderKey)) continue;
    seen.add(folderKey);
    try {
      const watcher = watch(dir, { recursive }, () => {
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
