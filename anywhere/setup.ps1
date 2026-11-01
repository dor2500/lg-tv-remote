# Puts TV Anywhere online and installs it on an LG TV in Developer Mode. Run from the repository folder after `npm install`:
#   powershell -ExecutionPolicy Bypass -File anywhere\setup.ps1
# It opens a browser once, to sign in to your own free Cloudflare account. The relay then runs on that account.
param([string]$Device = 'tv', [switch]$SkipInstall)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host 'Building the phone app...'
node anywhere/build.js

Push-Location anywhere/relay
try {
    npx --yes wrangler@4 whoami 2>&1 | Out-String | ForEach-Object {
        if ($_ -match 'not authenticated') { npx --yes wrangler@4 login }
    }
    Write-Host 'Putting the relay and phone app online...'
    $output = npx --yes wrangler@4 deploy 2>&1 | Out-String
    Write-Host $output
} finally {
    Pop-Location
}
if ($output -notmatch 'https://[a-z0-9.-]+\.workers\.dev') { throw 'Could not find the address in the deploy output above.' }
$site = $Matches[0]
$relay = $site -replace '^https', 'wss'

Write-Host 'Building the LG app...'
node anywhere/build.js $relay
$ipkFolder = Join-Path $root 'anywhere\dist'
ares-package anywhere/dist/webos -o $ipkFolder
$ipk = Join-Path $ipkFolder 'com.dor2500.tvanywhere_0.1.0_all.ipk'

if (-not $SkipInstall) {
    ares-install --device $Device $ipk
    ares-launch --device $Device com.dor2500.tvanywhere
    Write-Host 'On the TV: accept the request with the remote.'
}
Write-Host ''
Write-Host "Open this on your phone and add it to the home screen: $site"
Write-Host "The LG app file is at: $ipk"
