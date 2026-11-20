$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Scripts = @("setup-dark-phys.ps1", "start-dark-phys.ps1", "start-dark-phys-lite.ps1")
foreach ($Name in $Scripts) {
  $Path = Join-Path $Root $Name
  if (-not (Test-Path $Path)) { throw "Missing PowerShell script: $Name" }
  $Tokens = $null; $Errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$Tokens, [ref]$Errors) | Out-Null
  if ($Errors.Count) { throw "$Name has PowerShell parse errors: $($Errors -join '; ')" }
  Write-Host "PASS PowerShell syntax: $Name"
}
$Setup = Get-Content (Join-Path $Root "setup-dark-phys.ps1") -Raw
$Start = Get-Content (Join-Path $Root "start-dark-phys.ps1") -Raw
$Lite = Get-Content (Join-Path $Root "start-dark-phys-lite.ps1") -Raw
foreach ($Needle in @("e973d515aef90c467da2289144df737a3bd03859", "2e003e65fa99a0f329478a2c1cdcf26bc481933a", "Node.js 20 LTS", "Python 3.10+")) {
  if (-not $Setup.Contains($Needle)) { throw "Setup script missing expected pinned requirement: $Needle" }
}
if (-not $Start.Contains("npm start")) { throw "Normal launcher does not invoke npm start." }\nif (-not $Start.Contains("phase7-readiness.js")) { throw "Normal launcher must run the Phase 7 readiness gate." }\nif (-not $Lite.Contains("phase7-readiness.js")) { throw "Lightweight launcher must run the Phase 7 readiness gate." }
foreach ($Needle in @("NODE_OPTIONS", "UV_THREADPOOL_SIZE", "OMP_NUM_THREADS", "BelowNormal")) {
  if (-not $Lite.Contains($Needle)) { throw "Lightweight launcher missing $Needle" }
}
Write-Host "PASS setup pins, requirements, and launcher configuration"
Write-Host "NOTE: this is a safe validation; it does not clone engines or install packages."
