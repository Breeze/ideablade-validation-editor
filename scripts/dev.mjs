// `npm run dev`: `ng serve` with live reload, and Electron pointed at it. Arguments after `--` go to the app,
// e.g. `npm run dev -- samples/temphire.validation.metadata.json --source=samples/temphire.breeze-metadata.json`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';

const port = 4300;
const url = `http://localhost:${port}`;
const isWindows = process.platform === 'win32';

const ng = spawn(isWindows ? 'npx.cmd' : 'npx', ['ng', 'serve', '--port', String(port)], { stdio: 'inherit', shell: isWindows });

const portOpen = () =>
  new Promise((resolve) => {
    const socket = net.connect(port, 'localhost', () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
while (!(await portOpen())) await new Promise((r) => setTimeout(r, 500));

const electron = createRequire(import.meta.url)('electron'); // the path of the Electron binary
const app = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ELECTRON_START_URL: url } });

const stop = () => {
  if (isWindows) spawn('taskkill', ['/pid', String(ng.pid), '/T', '/F']);
  else ng.kill();
};
app.on('exit', (code) => {
  stop();
  process.exit(code ?? 0);
});
process.on('SIGINT', () => app.kill());
