$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$App = Join-Path $Root "engines\youtube-automation-agent"
if (-not (Test-Path (Join-Path $App "index.js"))) { throw "Engines not installed. Run .\setup-dark-phys.ps1 first." }
if (-not (Test-Path (Join-Path $App "node_modules"))) { throw "Node dependencies missing. Run .\setup-dark-phys.ps1 first." }
$env:NODE_OPTIONS = "--max-old-space-size=2048"
$env:UV_THREADPOOL_SIZE = "2"
$env:OMP_NUM_THREADS = "2"
Push-Location $App
try {
  Write-Host "Starting Dark Phys in LIGHTWEIGHT mode (Node heap capped at 2 GB)."
  Write-Host "Recommended: render one project at a time and close unused browser tabs."
  Write-Host "Publishing remains approval-gated inside the upstream dashboard."
  $Process = Start-Process -FilePath "npm.cmd" -ArgumentList "start" -NoNewWindow -PassThru
  try { $Process.PriorityClass = "BelowNormal" } catch { Write-Warning "Could not lower process priority; continuing." }
  Wait-Process -Id $Process.Id
  if ($Process.ExitCode -ne 0) { throw "Dark Phys exited with code $($Process.ExitCode)." }
} finally { Pop-Location }
