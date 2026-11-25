// `npm test` runs the main-process tests (electron/**/*.test.ts, compiled by `npm run build:electron` to
// dist-electron/**/*.test.js, which `npm test` does just before this) with the Node that Electron ships, not the Node
// that builds the app: the main process always runs on Electron's (Node 24.22 in Electron 45), whatever
// .node-version says, so its code is tested on that.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const outDir = 'dist-electron'; // tsconfig.electron.json's outDir
// Every compiled test, in subfolders too, by file name: Node 24's runner takes a folder argument for a file.
const files = existsSync(outDir)
  ? readdirSync(outDir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.test.js'))
      .map((f) => `${outDir}/${f.split('\\').join('/')}`)
      .sort()
  : [];
if (!files.length) {
  // Without files, node --test would look for tests itself, and find the .ts sources.
  console.error(`No tests in ${outDir}/: compile the main process first (npm run build:electron).`);
  process.exit(1);
}

const electron = createRequire(import.meta.url)('electron'); // the path of the Electron binary
const version = spawnSync(electron, ['-p', 'process.versions.node'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
console.log(`Main-process tests on Electron's Node ${version.stdout.trim()}`);
const result = spawnSync(electron, ['--test', ...files], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
process.exit(result.status ?? 1);
