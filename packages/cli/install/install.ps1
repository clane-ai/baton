# Baton installer for Windows.  Usage:  irm https://clane.sh/baton/install.ps1 | iex
# Downloads the standalone `baton` executable from the GitHub release of clane-ai/baton,
# puts it in %LOCALAPPDATA%\Programs\baton and adds that folder to the user PATH.
#   $env:BATON_VERSION   pin a version (default: latest release)
#   $env:BATON_GH_TOKEN  GitHub token, needed while the clane-ai/baton repository is private
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = 'clane-ai/baton'
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq 'Arm64') { 'arm64' } else { 'x64' }
if ($arch -eq 'arm64') { Write-Host 'Windows on ARM: using the x64 build under emulation.' }
$asset = 'baton-windows-x64.exe'
$dir = Join-Path $env:LOCALAPPDATA 'Programs\baton'
$exe = Join-Path $dir 'baton.exe'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$headers = @{ 'User-Agent' = 'baton-installer' }
if ($env:BATON_GH_TOKEN) { $headers['Authorization'] = "Bearer $env:BATON_GH_TOKEN" }
$tag = if ($env:BATON_VERSION) { "cli-v$($env:BATON_VERSION -replace '^v','')" } else { $null }

if ($env:BATON_GH_TOKEN) {
  # Private repository: resolve the asset through the API and download it as octet-stream.
  $relUrl = if ($tag) { "https://api.github.com/repos/$repo/releases/tags/$tag" } else { "https://api.github.com/repos/$repo/releases/latest" }
  $rel = Invoke-RestMethod -Uri $relUrl -Headers $headers
  $a = $rel.assets | Where-Object { $_.name -eq $asset } | Select-Object -First 1
  if (-not $a) { throw "release $($rel.tag_name) has no asset named $asset" }
  $h = $headers.Clone(); $h['Accept'] = 'application/octet-stream'
  Write-Host "Downloading baton $($rel.tag_name) ..."
  Invoke-WebRequest -Uri $a.url -Headers $h -OutFile "$exe.tmp"
} else {
  $url = if ($tag) { "https://github.com/$repo/releases/download/$tag/$asset" } else { "https://github.com/$repo/releases/latest/download/$asset" }
  Write-Host "Downloading $url ..."
  Invoke-WebRequest -Uri $url -Headers $headers -OutFile "$exe.tmp"
}
Move-Item -Force "$exe.tmp" $exe

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not ($userPath -split ';' | Where-Object { $_ -eq $dir })) {
  [Environment]::SetEnvironmentVariable('Path', "$userPath;$dir", 'User')
  Write-Host "Added $dir to your user PATH (open a new terminal for it to apply)."
}
$env:Path = "$env:Path;$dir"

$v = & $exe version
Write-Host ""
Write-Host "Installed $v at $exe"
Write-Host ""
Write-Host "Next, inside your product repository, run the command your operator gave you:"
Write-Host "  baton join <invite-code>"
