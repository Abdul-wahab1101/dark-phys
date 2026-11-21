$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$OM = Join-Path $Root "engines\OpenMontage"
$Commit = "2e003e65fa99a0f329478a2c1cdcf26bc481933a"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git for Windows is required." }
if (-not (Test-Path (Join-Path $OM ".git"))) {
  if ((Test-Path $OM) -and (Get-ChildItem -Force $OM | Select-Object -First 1)) {
    throw "The OpenMontage folder exists but is not a Git checkout and is not empty. Back it up or rename it, then rerun setup."
  }
  $Engines = Split-Path -Parent $OM
  New-Item -ItemType Directory -Force -Path $Engines | Out-Null
  git clone https://github.com/OpenMontageInc/OpenMontage.git $OM
  if ($LASTEXITCODE -ne 0) { throw "Could not clone OpenMontage." }
  git -C $OM fetch --depth 1 origin $Commit
  if ($LASTEXITCODE -ne 0) { throw "Could not fetch the pinned OpenMontage commit." }
  git -C $OM checkout --detach $Commit
  if ($LASTEXITCODE -ne 0) { throw "Could not check out the pinned OpenMontage commit." }
} else {
  $CurrentCommit = (& git -C $OM rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { throw "The existing OpenMontage Git checkout is damaged." }
  if ($CurrentCommit -ne $Commit) { throw "Existing OpenMontage is at $CurrentCommit, but this integration requires $Commit. Back up local work and correct the checkout before setup." }
  Write-Host "Pinned OpenMontage checkout already present; preserving local changes."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 22.23.4+ is required for the pinned OpenMontage Remotion Composer." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is required for the OpenMontage Remotion Composer." }
$NodeVersion = [version](node -p "process.versions.node")
$NodeCompatible = (($NodeVersion.Major -eq 22 -and $NodeVersion -ge [version]"22.23.4") -or
                   ($NodeVersion.Major -eq 24 -and $NodeVersion -ge [version]"24.22.1") -or
                   ($NodeVersion.Major -eq 26 -and $NodeVersion -ge [version]"26.12.1"))
if (-not $NodeCompatible) { throw "OpenMontage Remotion Composer requires Node 22.23.4+, 24.22.1+ or 26.12.1+ (supported release lines). Current: $NodeVersion. Install Node 22.23.4 LTS or newer supported release." }
$Python = Get-Command python -ErrorAction SilentlyContinue
if (-not $Python) { throw "Python 3.10+ is required." }
$PythonVersion = [version](python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.0')")
if ($PythonVersion -lt [version]"3.10.0") { throw "Python 3.10+ is required. Current: $PythonVersion" }
$Venv = Join-Path $OM ".venv"
if (-not (Test-Path $Venv)) { python -m venv $Venv; if ($LASTEXITCODE -ne 0) { throw "Could not create the OpenMontage Python virtual environment." } }
$VenvPython = Join-Path $Venv "Scripts\python.exe"
& $VenvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Could not upgrade pip in the OpenMontage virtual environment." }
& $VenvPython -m pip install -r (Join-Path $OM "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Could not install OpenMontage Python requirements." }
$Composer = Join-Path $OM "remotion-composer"
if (Test-Path (Join-Path $Composer "package-lock.json")) {
  Push-Location $Composer
  try { npm ci; if ($LASTEXITCODE -ne 0) { throw "Could not install locked Remotion Composer dependencies." } } finally { Pop-Location }
} elseif (Test-Path (Join-Path $Composer "package.json")) {
  Push-Location $Composer
  try { npm install; if ($LASTEXITCODE -ne 0) { throw "Could not install Remotion Composer dependencies." } } finally { Pop-Location }
}
Write-Host ""
Write-Host "OpenMontage core + Remotion dependencies installed."
Write-Host "FFmpeg must be available on PATH: ffmpeg -version"
Write-Host "Run a render smoke test: & '$VenvPython' render_demo.py --list"
Write-Host "Then: & '$VenvPython' render_demo.py world-in-numbers"
Write-Host "HyperFrames is an optional separate runtime; see OPENMONTAGE-INTEGRATION.md."
