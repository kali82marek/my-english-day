<#
.SYNOPSIS
  Smoke-test endpointów /situations (Faza 2, S-01) przeciw lokalnemu `wrangler dev`.

.DESCRIPTION
  Weryfikuje ręczne kryteria 2.3–2.7 z planu:
    2.3 POST /situations → 201 status=pending w < 1 s
    2.4 GET /situations → status=done z polskim transkryptem (po kilku sekundach)
    2.6 GET zwraca tylko sytuacje zalogowanego usera (świeży user = pusta lista na starcie)
    2.7 DELETE /:id → 204; nieistniejąca/cudza → 404

  Wymaga:
    - prawidłowego OPENAI_API_KEY w api/.dev.vars (wrangler dev ładuje go sam),
    - krótkiego pliku audio po polsku (.m4a / .mp3 / .wav / .webm), max 25 MB.

  Uruchom z katalogu api:
    pwsh ./scripts/smoke-situations.ps1 -AudioPath .\scripts\sample.m4a

.PARAMETER AudioPath
  Ścieżka do pliku audio z krótką polską wypowiedzią.

.PARAMETER Port
  Port dev servera (zgodnie z lekcją zespołu: 3030).

.PARAMETER DurationMs
  Wartość duration_ms wysyłana z nagraniem (metadana).

.PARAMETER TimeoutSec
  Maks. czas oczekiwania na zakończenie transkrypcji (wyjście z 'pending').
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$AudioPath,
  [int]$Port = 3030,
  [int]$DurationMs = 3000,
  [int]$TimeoutSec = 60
)

$ErrorActionPreference = 'Stop'
$base = "http://localhost:$Port"

if (-not (Test-Path $AudioPath)) {
  throw "Nie znaleziono pliku audio: $AudioPath"
}
$audioItem = Get-Item $AudioPath
Write-Host "Plik audio: $($audioItem.FullName) ($([math]::Round($audioItem.Length/1KB,1)) KB)" -ForegroundColor Cyan

# --- 1. Start wrangler dev w tle ---------------------------------------------
Write-Host "`n[1/6] Startuję 'wrangler dev --port $Port' w tle..." -ForegroundColor Yellow
$devJob = Start-Job -ScriptBlock {
  param($dir, $port)
  Set-Location $dir
  npx wrangler dev --port $port 2>&1
} -ArgumentList (Get-Location).Path, $Port

try {
  # --- 2. Czekaj na /health --------------------------------------------------
  Write-Host "[2/6] Czekam aż serwer odpowie na /health..." -ForegroundColor Yellow
  $ready = $false
  foreach ($i in 1..40) {
    Start-Sleep -Milliseconds 750
    try {
      $h = Invoke-RestMethod -Uri "$base/health" -TimeoutSec 3
      if ($h.status -eq 'ok') { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) {
    Write-Host "Serwer nie wstał. Log wrangler dev:" -ForegroundColor Red
    Receive-Job $devJob | Write-Host
    throw "wrangler dev nie odpowiedział na /health w czasie."
  }
  Write-Host "    Serwer gotowy." -ForegroundColor Green

  # --- 3. Rejestracja świeżego usera (unikalny email = czysta izolacja) ------
  $email = "smoke+$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())@example.com"
  Write-Host "`n[3/6] Rejestruję testowego usera: $email" -ForegroundColor Yellow
  $reg = Invoke-RestMethod -Uri "$base/auth/register" -Method Post `
    -ContentType 'application/json' `
    -Body (@{ email = $email; password = 'haslo-testowe-123' } | ConvertTo-Json)
  $token = $reg.token
  if (-not $token) { throw "Brak tokenu z /auth/register." }
  $auth = @{ Authorization = "Bearer $token" }
  Write-Host "    Token otrzymany (user id=$($reg.user.id))." -ForegroundColor Green

  # 2.6 (część): świeży user → pusta lista dnia
  $before = Invoke-RestMethod -Uri "$base/situations" -Headers $auth
  Write-Host "    GET /situations na starcie: $($before.situations.Count) sytuacji (oczekiwane 0)." -ForegroundColor Green

  # --- 4. POST /situations + pomiar czasu (kryterium 2.3: < 1 s) -------------
  # Używamy curl.exe — PowerShell `-Form` generuje multipart, którego parser undici
  # w workerd odrzuca ("Content-Disposition ... missing a name"). curl daje czysty,
  # standardowy multipart (taki jak realny klient React Native w Fazie 3).
  Write-Host "`n[4/6] POST /situations przez curl.exe (mierzę czas odpowiedzi)..." -ForegroundColor Yellow
  $mime = switch ($audioItem.Extension.ToLower()) {
    '.m4a'  { 'audio/m4a' }
    '.mp3'  { 'audio/mpeg' }
    '.wav'  { 'audio/wav' }
    '.webm' { 'audio/webm' }
    default { 'application/octet-stream' }
  }
  $raw = curl.exe -s -X POST "$base/situations" `
    -H "Authorization: Bearer $token" `
    --form "audio=@$($audioItem.FullName);type=$mime" `
    --form "duration_ms=$DurationMs" `
    -w "`n%{http_code}`n%{time_total}"
  $lines = $raw -split "`n"
  $timeTotal = [double]($lines[-1])
  $statusCode = [int]($lines[-2])
  $bodyJson = ($lines[0..($lines.Count - 3)] -join "`n").Trim()
  $elapsedMs = [int]($timeTotal * 1000)

  if ($statusCode -ne 201) {
    Write-Host "    POST zwrócił ${statusCode}: $bodyJson" -ForegroundColor Red
    throw "Oczekiwano 201."
  }
  $created = $bodyJson | ConvertFrom-Json
  $okFast = $elapsedMs -lt 1000
  Write-Host "    201 OK — status='$($created.status)', id=$($created.id), czas=${elapsedMs} ms (< 1000 ms: $okFast)" -ForegroundColor ($okFast ? 'Green' : 'Red')
  if ($created.status -ne 'pending') { Write-Host "    UWAGA: status nie jest 'pending'." -ForegroundColor Red }

  # --- 5. Polling aż transkrypcja się sfinalizuje (2.4) ----------------------
  Write-Host "`n[5/6] Czekam na finalizację transkrypcji (timeout ${TimeoutSec}s)..." -ForegroundColor Yellow
  $final = $null
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $list = Invoke-RestMethod -Uri "$base/situations" -Headers $auth
    $row = $list.situations | Where-Object { $_.id -eq $created.id }
    Write-Host "    ...status=$($row.status)" -ForegroundColor DarkGray
    if ($row.status -ne 'pending') { $final = $row; break }
  }
  if (-not $final) { throw "Transkrypcja nie zakończyła się w ${TimeoutSec}s (osierocony 'pending'?)." }

  if ($final.status -eq 'done') {
    Write-Host "    DONE ✓ transkrypt:" -ForegroundColor Green
    Write-Host "      „$($final.transcript)”" -ForegroundColor White
  } else {
    Write-Host "    status='failed' — sprawdź klucz OPENAI_API_KEY w .dev.vars lub format audio." -ForegroundColor Red
  }

  # --- 6. DELETE (2.7): istniejący → 204; ponowny → 404 ----------------------
  Write-Host "`n[6/6] DELETE /situations/$($created.id)..." -ForegroundColor Yellow
  $del = Invoke-WebRequest -Uri "$base/situations/$($created.id)" -Method Delete -Headers $auth -SkipHttpErrorCheck
  Write-Host "    DELETE → $($del.StatusCode) (oczekiwane 204)" -ForegroundColor ($del.StatusCode -eq 204 ? 'Green' : 'Red')
  $del2 = Invoke-WebRequest -Uri "$base/situations/$($created.id)" -Method Delete -Headers $auth -SkipHttpErrorCheck
  Write-Host "    Ponowny DELETE (już usunięty) → $($del2.StatusCode) (oczekiwane 404)" -ForegroundColor ($del2.StatusCode -eq 404 ? 'Green' : 'Red')

  Write-Host "`n=== SMOKE-TEST ZAKOŃCZONY ===" -ForegroundColor Cyan
  Write-Host "Podsumowanie kryteriów:" -ForegroundColor Cyan
  Write-Host "  2.3 201 pending < 1 s ......... $okFast (${elapsedMs} ms)"
  Write-Host "  2.4 transkrypt done .......... $($final.status -eq 'done')"
  Write-Host "  2.6 izolacja (start = 0) ..... $($before.situations.Count -eq 0)"
  Write-Host "  2.7 DELETE 204 / 404 ......... $(($del.StatusCode -eq 204) -and ($del2.StatusCode -eq 404))"
  Write-Host "`n(2.5 — kasacja pliku R2 po sukcesie / pozostanie przy 'failed' — sprawdź ręcznie w logu wrangler dev lub przez 'wrangler r2 object')." -ForegroundColor DarkGray
}
finally {
  Write-Host "`nZatrzymuję wrangler dev..." -ForegroundColor Yellow
  Stop-Job $devJob -ErrorAction SilentlyContinue
  Remove-Job $devJob -Force -ErrorAction SilentlyContinue
}
