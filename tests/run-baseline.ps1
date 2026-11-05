# Usage: powershell -File tests\run-baseline.ps1 [-Mode check|record]
# Runs PanelLadder on tests\samples.js in headless Edge and compares with (or records) tests\baseline.json.
param([ValidateSet("check", "record")][string]$Mode = "check")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$url = "file:///" + ($root -replace "\\", "/")
$edge = @("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Write-Error "msedge.exe not found"; exit 2 }

$tmp = Join-Path $env:TEMP ("panellab-s0-" + [guid]::NewGuid().ToString("N"))
New-Item $tmp -ItemType Directory | Out-Null
try {
  $page = @"
<html><body><pre id="rep"></pre>
<script>window.onerror=function(m){document.getElementById('rep').textContent='ERR '+m}</script>
<script src="$url/js/ladder.js"></script>
<script src="$url/tests/samples.js"></script>
<script>
const R={};
for(const k in PANEL_SAMPLES){const c=PANEL_SAMPLES[k];R[k]={svg:PanelLadder.render(c),nets:PanelLadder.nets(c),parse:PanelLadder.parse(c)};}
document.getElementById('rep').textContent=JSON.stringify(R);
</script></body></html>
"@
  $html = Join-Path $tmp "h.html"; $out = Join-Path $tmp "o.txt"
  [IO.File]::WriteAllText($html, $page, (New-Object Text.UTF8Encoding $false))
  Start-Process $edge -ArgumentList "--headless", "--disable-gpu", "--virtual-time-budget=3000", "--dump-dom", ("file:///" + ($html -replace "\\", "/")) -RedirectStandardOutput $out -RedirectStandardError (Join-Path $tmp "e.txt") -Wait -NoNewWindow
  $dom = Get-Content $out -Raw -Encoding UTF8
  $m = [regex]::Match($dom, '<pre id="rep">(.*?)</pre>', "Singleline")
  if (-not $m.Success) { Write-Error "harness output not found"; exit 2 }
  $json = [Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
  if ($json.StartsWith("ERR")) { Write-Error $json; exit 2 }
  $file = Join-Path $PSScriptRoot "baseline.json"
  if ($Mode -eq "record") {
    [IO.File]::WriteAllText($file, $json, (New-Object Text.UTF8Encoding $false))
    $n = @(($json | ConvertFrom-Json).PSObject.Properties).Count
    Write-Host "recorded $n samples -> $file"
    exit 0
  }
  if (-not (Test-Path $file)) { Write-Error "baseline.json missing; run with -Mode record"; exit 2 }
  $new = $json | ConvertFrom-Json
  $old = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
  $bad = 0
  $keys = @($old.PSObject.Properties.Name) + @($new.PSObject.Properties.Name) | Select-Object -Unique
  foreach ($k in $keys) {
    $a = if ($old.PSObject.Properties[$k]) { $old.$k | ConvertTo-Json -Compress -Depth 50 } else { "<missing>" }
    $b = if ($new.PSObject.Properties[$k]) { $new.$k | ConvertTo-Json -Compress -Depth 50 } else { "<missing>" }
    if ($a -eq $b) { Write-Host "PASS $k" } else { Write-Host "FAIL $k"; $bad++ }
  }
  Write-Host ("{0} sample(s) differ" -f $bad)
  exit ([int]($bad -gt 0))
} finally {
  Remove-Item $tmp -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue
}
