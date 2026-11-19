param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9-]{1,39}$')]
  [string]$ChannelId
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $Root "scripts\channel-workspace.js") start --id $ChannelId
exit $LASTEXITCODE
