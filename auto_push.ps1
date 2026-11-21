param (
    [string]$Message = ""
)

$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($Message)) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $Message = "auto update: $timestamp"
}

$status = git status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
    Write-Host "[Auto-Push] Workspace sach, khong co thay doi nao can day len GitHub." -ForegroundColor Yellow
    exit 0
}

Write-Host "[Auto-Push] Dang them tat ca thay doi..." -ForegroundColor Cyan
git add -A

Write-Host "[Auto-Push] Dang commit: '$Message'..." -ForegroundColor Cyan
git commit -m "$Message"

Write-Host "[Auto-Push] Dang day len GitHub (shopwarlergen/MCPMC)..." -ForegroundColor Cyan
git push origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host "[Auto-Push] Thanh cong! Ma nguon da duoc dong bo len https://github.com/shopwarlergen/MCPMC" -ForegroundColor Green
} else {
    Write-Host "[Auto-Push] Co loi xay ra khi push len GitHub!" -ForegroundColor Red
}
