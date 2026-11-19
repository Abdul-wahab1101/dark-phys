$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$OM = Join-Path $Root "engines\OpenMontage"
if (-not (Test-Path (Join-Path $OM ".git"))) {
  throw "OpenMontage is not cloned. Run .\setup-dark-phys.ps1 first."
}
$Python = Get-Command python -ErrorAction SilentlyContinue
if (-not $Python) { throw "Python 3.10+ is required." }
$Venv = Join-Path $OM ".venv"
if (-not (Test-Path $Venv)) { python -m venv $Venv }
$VenvPython = Join-Path $Venv "Scripts\python.exe"
& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install -r (Join-Path $OM "requirements.txt")
$Composer = Join-Path $OM "remotion-composer"
if (Test-Path (Join-Path $Composer "package-lock.json")) {
  Push-Location $Composer
  try { npm ci } finally { Pop-Location }
} elseif (Test-Path (Join-Path $Composer "package.json")) {
  Push-Location $Composer
  try { npm install } finally { Pop-Location }
}
Write-Host ""
Write-Host "OpenMontage core + Remotion dependencies installed."
Write-Host "FFmpeg must be available on PATH: ffmpeg -version"
Write-Host "Run a render smoke test: & '$VenvPython' render_demo.py --list"
Write-Host "Then: & '$VenvPython' render_demo.py world-in-numbers"
Write-Host "HyperFrames is an optional separate runtime; see OPENMONTAGE-INTEGRATION.md."
