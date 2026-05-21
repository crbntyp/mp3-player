const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Local deploy: rsync dist/ → /var/www/crbntyp/plyr/ on the VPS, then fix
// ownership/perms so Apache + www-data can serve files (and write to the
// proxy.php cache directory).
//
// Cross-platform: runs rsync/ssh natively on macOS/Linux, shells through
// WSL on Windows (Windows has no native rsync).

const SERVER = 'root@148.230.122.104';
const REMOTE_PATH = '/var/www/crbntyp/plyr/';
const ROOT = path.join(__dirname, '..');
const distDir = path.join(ROOT, 'dist');

const platform = os.platform();
const isWin = platform === 'win32';
// SSH key path differs per OS: WSL uses a key inside its own home dir;
// macOS/Linux use the standard ~/.ssh/id_ed25519. Referenced explicitly so
// the deploy doesn't depend on ssh-agent state.
const SSH_KEY = isWin ? '~/.ssh/carbontype-admin' : '~/.ssh/id_ed25519';
const SSH_OPTS = `-i ${SSH_KEY} -o StrictHostKeyChecking=accept-new -o BatchMode=yes`;

if (!fs.existsSync(distDir)) {
  console.error('❌ No dist/ directory. Run `npm run build` first.');
  process.exit(1);
}

function run(cmd, args, label) {
  console.log(`\n▶ ${label}`);
  console.log(`  ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    console.error(`\n❌ ${label} failed (exit ${result.status})`);
    process.exit(result.status || 1);
  }
}

// On Windows, paths need WSL translation (D:\...\dist\ → /mnt/d/.../dist/).
// On macOS/Linux, the native path works directly with the trailing slash.
let srcPath;
if (isWin) {
  const winDist = distDir.replace(/\\/g, '/');
  srcPath = '/mnt/' + winDist.charAt(0).toLowerCase() + winDist.slice(2) + '/';
} else {
  srcPath = distDir + '/';
}

const rsyncArgs = [
  '-avz',
  '--delete',
  '--exclude=.git/',
  '--exclude=node_modules/',
  '--exclude=.DS_Store',
  // Server-only files: proxy.config.php holds secrets, cache/ is the
  // runtime cache directory the proxy writes to. Excluding them from
  // --delete keeps server state intact across deploys.
  '--exclude=proxy.config.php',
  '--exclude=cache/',
  '-e', `ssh ${SSH_OPTS}`,
  srcPath,
  `${SERVER}:${REMOTE_PATH}`,
];

const sshArgs = [
  ...SSH_OPTS.split(' '),
  SERVER,
  `chown -R www-data:www-data ${REMOTE_PATH} && find ${REMOTE_PATH} -type d -exec chmod 755 {} \\; && find ${REMOTE_PATH} -type f -exec chmod 644 {} \\;`,
];

if (isWin) {
  run('wsl', ['rsync', ...rsyncArgs], 'rsync dist/ → server');
  run('wsl', ['ssh', ...sshArgs], 'fix permissions');
} else {
  run('rsync', rsyncArgs, 'rsync dist/ → server');
  run('ssh', sshArgs, 'fix permissions');
}

console.log('\n✅ Deployed to https://crbntyp.com/plyr/');
