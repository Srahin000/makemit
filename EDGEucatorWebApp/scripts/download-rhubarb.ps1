# Download and setup Rhubarb Lip Sync for Windows

Write-Host "Downloading Rhubarb Lip Sync..." -ForegroundColor Cyan

# Get latest release info
$releaseUrl = "https://api.github.com/repos/DanielSWolf/rhubarb-lip-sync/releases/latest"
$releaseInfo = Invoke-RestMethod -Uri $releaseUrl

# Find Windows asset
$windowsAsset = $releaseInfo.assets | Where-Object { $_.name -like "*windows*" } | Select-Object -First 1

if (-not $windowsAsset) {
    Write-Host "Error: Could not find Windows release" -ForegroundColor Red
    exit 1
}

Write-Host "Found release: $($windowsAsset.name)" -ForegroundColor Green
Write-Host "Download URL: $($windowsAsset.browser_download_url)" -ForegroundColor Yellow

# Create rhubarb directory in project
$rhubarbDir = Join-Path $PSScriptRoot "..\rhubarb"
if (-not (Test-Path $rhubarbDir)) {
    New-Item -ItemType Directory -Path $rhubarbDir | Out-Null
}

$zipPath = Join-Path $rhubarbDir "rhubarb.zip"
$extractPath = $rhubarbDir

# Download
Write-Host "Downloading to: $zipPath" -ForegroundColor Cyan
Invoke-WebRequest -Uri $windowsAsset.browser_download_url -OutFile $zipPath

# Extract
Write-Host "Extracting..." -ForegroundColor Cyan
Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

# Find rhubarb.exe
$rhubarbExe = Get-ChildItem -Path $extractPath -Filter "rhubarb.exe" -Recurse | Select-Object -First 1

if ($rhubarbExe) {
    Write-Host "`n✅ Rhubarb installed successfully!" -ForegroundColor Green
    Write-Host "Location: $($rhubarbExe.FullName)" -ForegroundColor Yellow
    Write-Host "`nTo use it, you can:" -ForegroundColor Cyan
    Write-Host "1. Add this path to your PATH environment variable, OR" -ForegroundColor White
    Write-Host "2. Use the full path: $($rhubarbExe.FullName)" -ForegroundColor White
    Write-Host "`nTesting installation..." -ForegroundColor Cyan
    & $rhubarbExe.FullName -h
} else {
    Write-Host "`n❌ Error: Could not find rhubarb.exe after extraction" -ForegroundColor Red
    Write-Host "Please check: $extractPath" -ForegroundColor Yellow
    exit 1
}

