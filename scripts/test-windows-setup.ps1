$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Scripts = @("setup-dark-phys.ps1", "setup-openmontage.ps1", "start-dark-phys.ps1", "start-dark-phys-lite.ps1", "start-dark-phys-channel.ps1")
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
$Channel = Get-Content (Join-Path $Root "start-dark-phys-channel.ps1") -Raw
$OpenMontage = Get-Content (Join-Path $Root "setup-openmontage.ps1") -Raw
foreach ($Needle in @("e973d515aef90c467da2289144df737a3bd03859", "Node.js 20 LTS", "Python 3.10+", "IncludeOpenMontage")) {
  if (-not $Setup.Contains($Needle)) { throw "Setup script missing expected pinned requirement: $Needle" }
}
if (-not $OpenMontage.Contains("2e003e65fa99a0f329478a2c1cdcf26bc481933a")) { throw "Optional OpenMontage installer must pin the tested upstream commit." }
if (-not $OpenMontage.Contains("requirements.txt")) { throw "Optional OpenMontage installer must install Python requirements." }
if (-not $OpenMontage.Contains("22.23.4") -or -not $OpenMontage.Contains("NodeCompatible")) { throw "OpenMontage installer must enforce the pinned Remotion Composer Node runtime." }
if (-not $OpenMontage.Contains("npm ci")) { throw "OpenMontage installer must use the lockfile for reproducible composer dependencies." }
if (-not $Setup.Contains("20.17.0") -or -not $Setup.Contains("npm ci")) { throw "Main installer must enforce Node 20.17+ and use npm ci after security lockfile regeneration." }
if (-not $Setup.Contains("patch-upstream-dependencies.js")) { throw "Main installer must apply the reviewed upstream dependency security patch before npm ci." }
if ($Setup.Contains("require('sharp/package.json')")) { throw "Main installer must not import Sharp package.json through the restricted exports map." }
$DependencyPatch = Get-Content (Join-Path $Root "scripts/patch-upstream-dependencies.js") -Raw
foreach ($Package in @("axios", "sharp", "form-data", "ws", "body-parser", "1.21.1", "0.35.5", "4.0.6", "8.23.0", "1.20.9")) {
  if (-not $DependencyPatch.Contains($Package)) { throw "Dependency security patch is missing $Package." }
}
if (-not $Setup.Contains("npm install --no-save --no-package-lock sharp")) { throw "Main installer must install the root-level Sharp dependency required by the thumbnail agent." }
if (-not $Setup.Contains("apply-thumbnail-upgrade.js")) { throw "Main installer must patch the actual upstream thumbnail pipeline." }
if (-not $Setup.Contains("channel-workspaces")) { throw "Main installer must also upgrade existing isolated channel workspaces." }
if (-not $Start.Contains("npm start")) { throw "Normal launcher does not invoke npm start." }
if (-not $Start.Contains("phase7-readiness.js")) { throw "Normal launcher must run the Phase 7 readiness gate." }
if (-not $Lite.Contains("phase7-readiness.js")) { throw "Lightweight launcher must run the Phase 7 readiness gate." }
if (-not $Channel.Contains("phase7-readiness.js")) { throw "Channel launcher must run the Phase 7 readiness gate." }
foreach ($Needle in @("NODE_OPTIONS", "UV_THREADPOOL_SIZE", "OMP_NUM_THREADS", "BelowNormal")) {
  if (-not $Lite.Contains($Needle)) { throw "Lightweight launcher missing $Needle" }
}
Write-Host "PASS setup pins, requirements, and launcher configuration"
Write-Host "NOTE: this is a safe validation; it does not clone engines or install packages."
