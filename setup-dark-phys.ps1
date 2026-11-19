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
$NodeMajor = [int]((node -p "process.versions.node.Split('.')[0]"))
if ($NodeMajor -lt 18) { throw "Node.js 18.17+ is required by the YouTube agent. Install Node 20 LTS." }
$Py = python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
$Parts = $Py.Split('.')
if ([int]$Parts[0] -lt 3 -or ([int]$Parts[0] -eq 3 -and [int]$Parts[1] -lt 10)) { throw "Python 3.10+ is required." }

$Youtube = Join-Path $Engines "youtube-automation-agent"
if (-not (Test-Path (Join-Path $Youtube ".git"))) {
  git clone --depth 1 --branch master https://github.com/darkzOGx/youtube-automation-agent.git $Youtube
} else { Write-Host "YouTube agent already cloned; keeping your local changes." }
Push-Location $Youtube
try {
  npm install
  npx playwright install chromium
  if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }
  New-Item -ItemType Directory -Force -Path "config" | Out-Null
} finally { Pop-Location }

$OpenMontage = Join-Path $Engines "OpenMontage"
if (-not (Test-Path (Join-Path $OpenMontage ".git"))) {
  git clone --depth 1 https://github.com/OpenMontageInc/OpenMontage.git $OpenMontage
} else { Write-Host "OpenMontage already cloned; keeping your local changes." }

Write-Host ""
Write-Host "Dark Phys engines are ready."
Write-Host "YouTube agent: $Youtube"
Write-Host "OpenMontage:   $OpenMontage"
Write-Host "Next: add provider key to engines\youtube-automation-agent\.env"
Write-Host "Then run .\start-dark-phys.ps1"
