# Installs the latest Universal TV Remote for the current user. No administrator rights needed.
#   irm https://raw.githubusercontent.com/dor2500/universal-tv-remote/main/install.ps1 | iex
# Messages stay in English: Windows PowerShell can garble non-ASCII text in a piped script.
& {
    $ErrorActionPreference = 'Stop'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $installDir = Join-Path $env:LOCALAPPDATA 'Programs\Universal TV Remote'
    $target = Join-Path $installDir 'Universal TV Remote.exe'
    $shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Universal TV Remote.lnk'

    Write-Host 'Looking for the latest release...'
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/dor2500/universal-tv-remote/releases/latest' -Headers @{ 'User-Agent' = 'universal-tv-remote-installer' }
    $asset = $release.assets | Where-Object { $_.name -like '*.exe' } | Select-Object -First 1
    if (-not $asset) { throw "Release $($release.tag_name) has no Windows download." }

    Write-Host "Downloading $($release.tag_name) ($([math]::Round($asset.size / 1MB)) MB)..."
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    $download = "$target.download"
    $progress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue' # the progress bar slows large downloads badly
    try {
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $download -UseBasicParsing
    } finally {
        $ProgressPreference = $progress
    }

    if ((Get-Item $download).Length -ne $asset.size) {
        Remove-Item $download -Force
        throw 'The download is incomplete. Run the command again.'
    }
    if ($asset.digest -match '^sha256:(.+)$') {
        if ((Get-FileHash $download -Algorithm SHA256).Hash -ne $Matches[1]) {
            Remove-Item $download -Force
            throw 'The download failed its checksum. Nothing was installed.'
        }
    }

    try {
        Move-Item -Force -Path $download -Destination $target
    } catch {
        Remove-Item $download -Force -ErrorAction SilentlyContinue
        throw 'Universal TV Remote seems to be running. Close it and run the command again.'
    }

    # Earlier versions were called LG TV Remote. Saved TVs stay in their folder, and the new version finds them.
    Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA 'ProgramsLG TV Remote') -ErrorAction SilentlyContinue
    Remove-Item -Force (Join-Path ([Environment]::GetFolderPath('Programs')) 'LG TV Remote.lnk') -ErrorAction SilentlyContinue

    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($shortcut)
    $link.TargetPath = $target
    $link.WorkingDirectory = $installDir
    $link.Save()

    Write-Host "Installed $($release.tag_name) to $installDir"
    Write-Host 'Find it in the Start menu as "Universal TV Remote".'
    if ($env:TV_REMOTE_NO_LAUNCH -ne '1') { Start-Process $target }
}
