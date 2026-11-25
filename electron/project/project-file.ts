// The editor's project file, an IdeaBlade Validation Project (*.ivproj, such as temphire.ivproj): the metadata files
// to open together, the sources, and the settings a team shares (other validators, camelCase, values to try against
// pattern rules). It's JSON. Paths in it are relative to it, with forward slashes, so it works in every clone; the
// renderer gets them absolute. Keys the editor doesn't know (such as $comment) are kept when it writes the file.
//
// The renderer reaches these through the `project:*` handlers (ipc/project.ts); its view of the results is `Project`
// in src/app/services/host.ts. Source entries that are patterns are expanded with source-patterns.ts.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ParsedProject, Project, ProjectToWrite, RegexTestSet } from '../types';
import { expandPatterns, expandSourceEntry, isPattern } from './source-patterns';

export const PROJECT_EXTENSION = '.ivproj';

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

/**
 * The project, with absolute paths. `sources` are the entries as written (files or patterns); `sourceFiles` are the
 * files they stand for now, which the editor loads; `patterns` are the pattern entries with the files each matches.
 */
export async function readProject(projectPath: string): Promise<Project> {
  const project = parseProject(projectPath, await fs.readFile(projectPath, 'utf8'));
  const sourceFiles = [...new Set((await Promise.all(project.sources.map((s) => expandSourceEntry(s)))).flat())];
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
