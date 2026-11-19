$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$App = Join-Path $Root "engines\youtube-automation-agent"
if (-not (Test-Path (Join-Path $App "index.js"))) {
  throw "Engines not installed. Run .\setup-dark-phys.ps1 first."
}
if (-not (Test-Path (Join-Path $App "node_modules"))) {
  throw "Node dependencies missing. Run .\setup-dark-phys.ps1 first."
}
Push-Location $App
try {
  Write-Host "Starting Dark Phys YouTube operator at http://localhost:3456"
  Write-Host "Publishing stays approval-gated inside the YouTube agent."
  npm start
} finally { Pop-Location }
