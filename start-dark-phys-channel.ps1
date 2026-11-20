param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9-]{1,39}$')]
  [string]$ChannelId
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $Root
try {
  Write-Host "Running Dark Phys production readiness checks..."
  node .\scripts\phase7-readiness.js
  if ($LASTEXITCODE -ne 0) { throw "Production readiness blocked. Fix the listed prerequisites before launch." }
} finally { Pop-Location }
node (Join-Path $Root "scripts\channel-workspace.js") start --id $ChannelId
exit $LASTEXITCODE
