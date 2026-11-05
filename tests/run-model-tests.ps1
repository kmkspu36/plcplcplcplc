# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tests\run-model-tests.ps1
# Runs tests\model-tests.js (PanelLadderModel) in headless Edge and prints PASS/FAIL per case.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$url = "file:///" + ($root -replace "\\", "/")
$edge = @("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Write-Error "msedge.exe not found"; exit 2 }
$tmp = Join-Path $env:TEMP ("panellab-model-" + [guid]::NewGuid().ToString("N"))
New-Item $tmp -ItemType Directory | Out-Null
try {
  $page = @"
<html><body><pre id="rep"></pre>
<script>window.onerror=function(m){document.getElementById('rep').textContent='ERR '+m}</script>
<script src="$url/js/storage.js"></script>
<script src="$url/js/ladder.js"></script>
<script src="$url/js/ladder-model.js"></script>
<script src="$url/js/ladder-editor.js"></script>
<script src="$url/tests/samples.js"></script>
<script src="$url/tests/model-tests.js"></script>
<script>document.getElementById('rep').textContent=JSON.stringify(runModelTests());</script></body></html>
"@
  $html = Join-Path $tmp "h.html"; $o = Join-Path $tmp "o.txt"
  [IO.File]::WriteAllText($html, $page, (New-Object Text.UTF8Encoding $false))
  Start-Process $edge -ArgumentList "--headless", "--disable-gpu", "--virtual-time-budget=3000", "--dump-dom", ("file:///" + ($html -replace "\\", "/")) -RedirectStandardOutput $o -RedirectStandardError (Join-Path $tmp "e.txt") -Wait -NoNewWindow
  $dom = Get-Content $o -Raw -Encoding UTF8
  $m = [regex]::Match($dom, '<pre id="rep">(.*?)</pre>', "Singleline")
  if (-not $m.Success) { Write-Error "harness output not found"; exit 2 }
  $json = [Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
  if ($json.StartsWith("ERR")) { Write-Error $json; exit 2 }
  $bad = 0
  foreach ($r in ($json | ConvertFrom-Json)) {
    if ($r.ok) { Write-Host "PASS $($r.name)" } else { Write-Host "FAIL $($r.name) $($r.d)"; $bad++ }
  }
  Write-Host "$bad failed"
  exit ([int]($bad -gt 0))
} finally {
  Remove-Item $tmp -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue
}
