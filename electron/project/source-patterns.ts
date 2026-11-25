// Source patterns: a source entry with wildcards, such as a folder of DTOs (`dir/**/*.{ts,cs}`), stands for the files
// it matches. Here they're expanded to those files, and the folders they point at are watched, so files appearing or
// disappearing there (a new DTO, a deleted entity) reach the renderer as the patterns' new lists of files.
//
// The project file (project-file.ts) expands its source entries with these when it's read; the renderer asks for them
// through the `sources:*-patterns` handlers (ipc/sources.ts). The renderer's view of the result is `PatternMatch` in
// src/app/services/host.ts.
import { watch, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PatternMatch } from '../types';

/** True for a source entry with wildcards (`*`, `?`, `[`), which stands for the files it matches. */
export const isPattern = (p: string): boolean => /[*?[]/.test(p);

/**
 * The files a source entry (absolute) stands for: itself, or what a pattern like `client/src/app/core/model/*.ts`
 * matches, sorted.
 */
export async function expandSourceEntry(absolutePattern: string): Promise<string[]> {
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
      return { pattern, files: await expandSourceEntry(pattern) };
    }),
  );
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
 * not. Changes to the files themselves are the source watcher's business (ipc/sources.ts); this only notices files
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
