// IPC: metadata in TypeScript files. It needs the TypeScript compiler, so the renderer asks for it here
// (typescript/metadata-read.ts, typescript/metadata-write.ts). These work on text only: the renderer reads and writes
// the file itself (file:read, file:save in files.ts).
import { ipcMain } from 'electron';
import type { JsonObject } from '../types';
import { readTsMetadata } from '../typescript/metadata-read';
import { insertTsMetadata, newTsMetadataFile, removeTsMetadata, writeTsMetadata } from '../typescript/metadata-write';

/** Registers the `ts:*` handlers. */
export function registerTypeScriptHandlers(): void {
  /** The metadata maps in a TS file's text, as JSON (or read-only, with the reason). */
  ipcMain.handle('ts:read-metadata', (_e, text: string, fileName: string) => readTsMetadata(text, fileName));
  /** The TS file's text with one map replaced by new JSON, the rest of the file kept. */
  ipcMain.handle('ts:write-metadata', (_e, text: string, fileName: string, name: string, json: JsonObject) => writeTsMetadata(text, fileName, name, json));
  /** The TS file's text with another map added at the end. */
  ipcMain.handle('ts:insert-metadata', (_e, text: string, fileName: string, name: string, json: JsonObject) => insertTsMetadata(text, fileName, name, json));
  /** The TS file's text without a map (and its doc comment). */
  ipcMain.handle('ts:remove-metadata', (_e, text: string, fileName: string, name: string) => removeTsMetadata(text, fileName, name));
  /** A new TS file's text holding one map (File → New → TypeScript). */
  ipcMain.handle('ts:new-metadata', (_e, name: string, json: JsonObject) => newTsMetadataFile(name, json));
}
