$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$port = 8765
$url = "http://127.0.0.1:$port/"
Write-Host "타임라인 비주얼라이저: $url"
Write-Host "종료하려면 Ctrl+C"
Start-Process $url
python -m http.server $port --bind 127.0.0.1
