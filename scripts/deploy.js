const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Local deploy: rsync dist/ → /var/www/crbntyp/plyr/ on the VPS, then fix
// ownership/perms so Apache + www-data can serve files (and write to the
// proxy.php cache directory).
//
// Auth: password prompts come through twice — once for rsync, once for the
// follow-up ssh. To eliminate them, drop a public key into the server's
// /root/.ssh/authorized_keys (one-time setup).

const SERVER = 'root@148.230.122.104';
const REMOTE_PATH = '/var/www/crbntyp/plyr/';
// SSH key lives inside WSL at ~/.ssh/carbontype-admin (0600). Referenced
// explicitly so the deploy doesn't depend on whichever key happens to be
// the default — also avoids ssh-agent confusion.
const SSH_KEY_WSL = '~/.ssh/carbontype-admin';
const SSH_OPTS = `-i ${SSH_KEY_WSL} -o StrictHostKeyChecking=accept-new -o BatchMode=yes`;
const ROOT = path.join(__dirname, '..');
const distDir = path.join(ROOT, 'dist');

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

// WSL rsync — Windows has no native rsync, so we use the Ubuntu one. The
// WSL_PATH conversion turns D:\…\dist\ into /mnt/d/…/dist/ which WSL's
// rsync expects.
const winDist = distDir.replace(/\\/g, '/');
const wslDist = '/mnt/' + winDist.charAt(0).toLowerCase() + winDist.slice(2) + '/';

run(
  'wsl',
  [
    'rsync',
    '-avz',
    '--delete',
    "--exclude=.git/",
    "--exclude=node_modules/",
    "--exclude=.DS_Store",
    '-e', `ssh ${SSH_OPTS}`,
    wslDist,
    `${SERVER}:${REMOTE_PATH}`,
  ],
  'rsync dist/ → server',
);

// Permissions fix — every rsync resets ownership to whatever user the SSH
// session is, so Apache (www-data) loses access. Standard pattern: own as
// www-data, dirs 755, files 644.
run(
  'wsl',
  [
    'ssh',
    ...SSH_OPTS.split(' '),
    SERVER,
    `chown -R www-data:www-data ${REMOTE_PATH} && find ${REMOTE_PATH} -type d -exec chmod 755 {} \\; && find ${REMOTE_PATH} -type f -exec chmod 644 {} \\;`,
  ],
  'fix permissions',
);

console.log('\n✅ Deployed to https://crbntyp.com/plyr/');
