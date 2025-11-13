# FTP Auto-Deployment Setup

This repository is configured to automatically deploy to your FTP hosting when you push to GitHub.

## How It Works

When you push to the `master` branch (or any `claude/**` branch), GitHub Actions will:
1. Build your project (`npm run build`)
2. Upload the `dist/` folder to your FTP server
3. Deploy to: `public_html/carbontype.co/player/`

## Required GitHub Secrets

You need to add these secrets to your GitHub repository:

### Setup Instructions:

1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** for each of the following:

| Secret Name | Value |
|-------------|-------|
| `FTP_SERVER` | `ftp.carbontype.co` |
| `FTP_USERNAME` | `carbontype@carbontype.co` |
| `FTP_PASSWORD` | `Cantona1979!` |

## Testing the Deployment

Once the secrets are added:
1. Make any change to your code
2. Commit and push to `master` or your Claude branch
3. Go to **Actions** tab in GitHub to see the deployment progress
4. Check your site at: `https://carbontype.co/player/`

## Deployment Details

- **Server**: ftp.carbontype.co
- **Port**: 21 (standard FTP)
- **Remote Path**: `public_html/carbontype.co/player/`
- **Local Source**: `dist/` folder (after build)

## Security Note

⚠️ **IMPORTANT**: Delete the FTP credentials from this file after setting up the GitHub secrets! This file should NOT contain passwords in production.

The credentials are stored securely in GitHub Secrets and are never exposed in logs or code.
