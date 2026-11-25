// electron-builder afterPack hook: signs the macOS app ad hoc (codesign -s -). There's no Apple Developer certificate,
// so electron-builder doesn't sign it (mac.identity is null), and macOS on Apple silicon won't run code that isn't
// signed at all; an ad-hoc signature is enough for it to start once the user has allowed it (right-click → Open, or
// `xattr -dr com.apple.quarantine` on the app). It isn't notarized, so Gatekeeper still asks. Other platforms: nothing.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSignMac(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing  ${app}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
