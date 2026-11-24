// `npm test` runs the main-process tests (electron/*.test.cjs) with the Node that Electron ships, not the Node that
// builds the app: the main process always runs on Electron's (Node 24.22 in Electron 45), whatever .node-version
// says, so its code is tested on that.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const electron = createRequire(import.meta.url)('electron'); // the path of the Electron binary
const version = spawnSync(electron, ['-p', 'process.versions.node'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
console.log(`Main-process tests on Electron's Node ${version.stdout.trim()}`);
// The files by name: Node 24's runner takes a folder argument for a file.
const files = readdirSync('electron').filter((f) => f.endsWith('.test.cjs')).map((f) => `electron/${f}`);
const result = spawnSync(electron, ['--test', ...files], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
process.exit(result.status ?? 1);
