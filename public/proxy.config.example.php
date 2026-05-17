<?php
// Copy to proxy.config.php on the server and fill in secrets.
//
// proxy.config.php is gitignored — it never travels through this repo.
// The deploy script also --excludes it so server-side secrets are not
// overwritten by `npm run deploy`.

return [
    // Google Drive API v3 key, restricted by HTTP referrer to the
    // crbntyp.com domains. Used by ?action=list only — the audio stream
    // path does not need a key (uses public Drive download URLs).
    'DRIVE_API_KEY' => 'YOUR_GOOGLE_DRIVE_API_KEY',
];
