param(
  [Parameter(Mandatory=$true)][string]$Title,
  [ValidateSet('long','shorts')][string]$Mode = 'long',
  [string]$ScriptFile = '',
  [string]$SourceVideo = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$args = @('scripts/export-openmontage.js','--title',$Title,'--mode',$Mode)
if ($Mode -eq 'long') {
  if (-not $ScriptFile) { throw 'Long mode requires -ScriptFile.' }
  $args += @('--script',$ScriptFile)
} else {
  if (-not $SourceVideo) { throw 'Shorts mode requires -SourceVideo.' }
  $args += @('--source-video',$SourceVideo)
}
& node @args
if ($LASTEXITCODE -ne 0) { throw 'OpenMontage handoff export failed.' }
$slug = ([regex]::Replace($Title.ToLowerInvariant(),'[^a-z0-9]+','-')).Trim('-').Substring(0,[Math]::Min(56,([regex]::Replace($Title.ToLowerInvariant(),'[^a-z0-9]+','-')).Trim('-').Length))
if (-not $slug) { $slug = 'dark-phys-video' }
$project = Join-Path $root ('engines/OpenMontage/dark-phys-handoff/' + $slug)
$returnDir = Join-Path $project 'RETURN-TO-DARK-PHYS'
New-Item -ItemType Directory -Force -Path $returnDir | Out-Null
$watchCommand = 'Set-Location ' + (ConvertTo-Json $root -Compress) + '; node scripts/watch-openmontage-return.js ' + (ConvertTo-Json $returnDir -Compress)
Start-Process -FilePath 'powershell.exe' -WindowStyle Minimized -ArgumentList @('-NoProfile','-Command',$watchCommand)
Start-Process -FilePath 'notepad.exe' -ArgumentList (Join-Path $project 'OPENMONTAGE-PROMPT.md')
Write-Host 'Handoff exported. Return watcher is running; copy OpenMontage deliverables into:' -ForegroundColor Green
Write-Host $returnDir
