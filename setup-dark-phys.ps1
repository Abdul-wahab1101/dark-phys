param([switch]$IncludeOpenMontage)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Engines = Join-Path $Root "engines"
New-Item -ItemType Directory -Force -Path $Engines | Out-Null

function Require-Command($Name, $Hint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required. $Hint"
  }
}
Require-Command git "Install Git for Windows: https://git-scm.com/download/win"
Require-Command node "Install Node.js 20 LTS: https://nodejs.org/"
Require-Command npm "Install Node.js with npm."
Require-Command python "Install Python 3.10+: https://www.python.org/downloads/"
$NodeVersion = [version](node -p "process.versions.node")
if ($NodeVersion -lt [version]"18.17.0") { throw "Node.js 18.17+ is required by the YouTube agent. Install Node 20 LTS. Current: $NodeVersion" }
$Py = python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
$Parts = $Py.Split('.')
if ([int]$Parts[0] -lt 3 -or ([int]$Parts[0] -eq 3 -and [int]$Parts[1] -lt 10)) { throw "Python 3.10+ is required." }

$Youtube = Join-Path $Engines "youtube-automation-agent"
$YoutubeCommit = "e973d515aef90c467da2289144df737a3bd03859"
if (-not (Test-Path (Join-Path $Youtube ".git"))) {
  if ((Test-Path $Youtube) -and (Get-ChildItem -Force $Youtube | Select-Object -First 1)) {
    throw "The YouTube engine folder exists but is not a Git checkout and is not empty. Back it up or rename it, then rerun setup."
  }
  git clone https://github.com/darkzOGx/youtube-automation-agent.git $Youtube
  if ($LASTEXITCODE -ne 0) { throw "Could not clone the pinned YouTube Automation Agent." }
  git -C $Youtube fetch --depth 1 origin $YoutubeCommit
  if ($LASTEXITCODE -ne 0) { throw "Could not fetch the pinned YouTube Automation Agent commit." }
  git -C $Youtube checkout --detach $YoutubeCommit
  if ($LASTEXITCODE -ne 0) { throw "Could not check out the pinned YouTube Automation Agent commit." }
} else {
  $CurrentYoutubeCommit = (& git -C $Youtube rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw "The existing YouTube engine Git checkout is damaged." }
  if ($CurrentYoutubeCommit -ne $YoutubeCommit) { throw "Existing YouTube engine is at $CurrentYoutubeCommit, but this integration requires $YoutubeCommit. Back up local work and correct the checkout before setup." }
  Write-Host "Pinned YouTube engine already present; preserving local changes."
}
Push-Location $Youtube
try {
  if (Test-Path "package-lock.json") { npm ci } else { npm install }
  if ($LASTEXITCODE -ne 0) { throw "YouTube agent dependency installation failed." }
  npx playwright install chromium
  if ($LASTEXITCODE -ne 0) { throw "Playwright Chromium installation failed." }
  if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") { Copy-Item ".env.example" ".env" }
    else { throw "Upstream .env.example is missing; check the YouTube agent checkout." }
  }
  New-Item -ItemType Directory -Force -Path "config" | Out-Null
} finally { Pop-Location }

# The Dark Phys thumbnail designer runs from the repository root, not from the
# upstream engine folder, so its native Sharp dependency must exist at root.
Write-Host "Installing Dark Phys root thumbnail runtime dependency (sharp)..."
Push-Location $Root
try {
  npm install --no-save --no-package-lock sharp
  if ($LASTEXITCODE -ne 0) { throw "Dark Phys root Sharp dependency installation failed." }
  node -e "const sharp=require('sharp'); if(typeof sharp!=='function') process.exit(1); console.log('PASS root Sharp runtime:', require('sharp/package.json').version)"
  if ($LASTEXITCODE -ne 0) { throw "Dark Phys root Sharp dependency cannot be loaded." }
} finally { Pop-Location }

if ($IncludeOpenMontage) {
  $OpenMontage = Join-Path $Engines "OpenMontage"
  $OpenMontageCommit = "2e003e65fa99a0f329478a2c1cdcf26bc481933a"
  if (-not (Test-Path (Join-Path $OpenMontage ".git"))) {
    if ((Test-Path $OpenMontage) -and (Get-ChildItem -Force $OpenMontage | Select-Object -First 1)) {
      throw "The OpenMontage folder exists but is not a Git checkout and is not empty. Back it up or rename it, then rerun setup."
    }
    git clone https://github.com/OpenMontageInc/OpenMontage.git $OpenMontage
    if ($LASTEXITCODE -ne 0) { throw "Could not clone OpenMontage." }
    git -C $OpenMontage fetch --depth 1 origin $OpenMontageCommit
    if ($LASTEXITCODE -ne 0) { throw "Could not fetch the pinned OpenMontage commit." }
    git -C $OpenMontage checkout --detach $OpenMontageCommit
    if ($LASTEXITCODE -ne 0) { throw "Could not check out the pinned OpenMontage commit." }
  } else {
    $CurrentOpenMontageCommit = (& git -C $OpenMontage rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw "The existing OpenMontage Git checkout is damaged." }
    if ($CurrentOpenMontageCommit -ne $OpenMontageCommit) { throw "Existing OpenMontage is at $CurrentOpenMontageCommit, but this integration requires $OpenMontageCommit. Back up local work and correct the checkout before setup." }
    Write-Host "Pinned OpenMontage checkout already present; preserving local changes."
  }
} else {
  Write-Host "Skipping optional OpenMontage clone. Run .\\setup-openmontage.ps1 only when advanced rendering is needed."
}

Write-Host ""
Write-Host "Dark Phys engines are ready."
Write-Host "YouTube agent: $Youtube"
if ($IncludeOpenMontage) { Write-Host "OpenMontage:   $OpenMontage" } else { Write-Host "OpenMontage:   skipped (optional)" }
Write-Host "Next: add provider key to engines\youtube-automation-agent\.env"
Write-Host "Then run .\start-dark-phys.ps1"
