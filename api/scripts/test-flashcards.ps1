<#
  test-flashcards.ps1 — automatyczna weryfikacja Ścieżki A (Faza 2, slice S-02).

  Testuje router /flashcards BEZ OpenAI i bez audio: seeduje fiszki wprost do
  lokalnego D1, po czym sprawdza przez HTTP: listę propozycji, generatingCount,
  akceptację, odrzucenie i izolację po user_id (cudza fiszka -> 404).

  Wymagania:
    - działający `npm run dev` w katalogu api/ (Worker na porcie 3030),
    - ustawiony JWT_SECRET w api/.dev.vars (OPENAI_API_KEY NIE jest potrzebny),
    - zastosowana migracja 0003 (`wrangler d1 migrations apply ... --local`).

  Uruchomienie (z dowolnego katalogu):
    pwsh api/scripts/test-flashcards.ps1
    # lub inny host:
    pwsh api/scripts/test-flashcards.ps1 -Api http://localhost:3030

  Każde uruchomienie tworzy świeżego użytkownika (unikalny email), więc dane
  testowe są izolowane między przebiegami i nie wymagają sprzątania.
#>

[CmdletBinding()]
param(
  [string]$Api = 'http://localhost:3030'
)

$ErrorActionPreference = 'Stop'

# --- Liczniki i helpery raportujące ----------------------------------------
$script:pass = 0
$script:fail = 0

function Assert($cond, $msg) {
  if ($cond) {
    Write-Host "  PASS  $msg" -ForegroundColor Green
    $script:pass++
  } else {
    Write-Host "  FAIL  $msg" -ForegroundColor Red
    $script:fail++
  }
}

function Info($msg) { Write-Host "  ..    $msg" -ForegroundColor DarkGray }

# Jeden punkt wejścia do HTTP — -SkipHttpErrorCheck zwraca odpowiedź także dla
# 4xx/5xx (PowerShell 7+), więc oczekiwane 404 nie wywracają skryptu.
function Req {
  param(
    [string]$Method,
    [string]$Path,
    [hashtable]$Headers = @{},
    $BodyObj = $null
  )
  $params = @{
    Uri                = "$Api$Path"
    Method             = $Method
    Headers            = $Headers
    SkipHttpErrorCheck = $true
  }
  if ($null -ne $BodyObj) {
    $params.Body = ($BodyObj | ConvertTo-Json -Compress)
    $params.ContentType = 'application/json'
  }
  return Invoke-WebRequest @params
}

function AsJson($resp) {
  if ([string]::IsNullOrWhiteSpace($resp.Content)) { return $null }
  return $resp.Content | ConvertFrom-Json
}

# --- Lokalizacja katalogu api/ (dla wywołań wrangler) ----------------------
$ApiDir = Split-Path $PSScriptRoot -Parent

Write-Host ""
Write-Host "=== Ścieżka A: router /flashcards (API, bez OpenAI) ===" -ForegroundColor Cyan
Write-Host "API: $Api" -ForegroundColor DarkGray
Write-Host "api/: $ApiDir" -ForegroundColor DarkGray
Write-Host ""

# --- 0. Serwer odpowiada? --------------------------------------------------
try {
  $health = Req GET '/health'
} catch {
  Write-Host "Nie mogę połączyć się z $Api — czy `npm run dev` działa na 3030?" -ForegroundColor Red
  exit 1
}
Assert ($health.StatusCode -eq 200) "Worker odpowiada na /health (200)"

# --- 1. Rejestracja świeżego użytkownika -----------------------------------
$suffix = "{0}{1}" -f (Get-Date -Format 'HHmmss'), (Get-Random -Maximum 99999)
$email1 = "track-a-$suffix@example.com"
$reg1 = AsJson (Req POST '/auth/register' @{} @{ email = $email1; password = 'haslo12345' })
$token1 = $reg1.token
$userId1 = $reg1.user.id
$h1 = @{ Authorization = "Bearer $token1" }
Assert ($null -ne $token1 -and $null -ne $userId1) "Rejestracja usera #1 ($email1), id=$userId1"

# --- 2. Seed: sytuacja 'done'+3 fiszki, oraz sytuacja 'pending' (generatingCount) ---
# Lokalne D1 EGZEKWUJE klucze obce, a `last_insert_rowid()` NIE przenosi się
# między statementami w `wrangler d1 execute` — dlatego sytuację wstawiamy z
# RETURNING id i używamy realnego id literalnie przy fiszkach.
# Teksty bez apostrofów, żeby nie kolidowały z literałami SQL w pojedynczych cudzysłowach.

function Invoke-D1 {
  param([string]$Sql)
  Push-Location $ApiDir
  try {
    $raw = npx wrangler d1 execute my-english-day-db --local --json --command $Sql 2>$null
  } finally {
    Pop-Location
  }
  $parsed = $null
  try { $parsed = $raw | ConvertFrom-Json } catch {}
  # Przy błędzie statementu --json nie wypisuje wyniku na stdout → brak/niepoprawny JSON.
  if ($null -eq $parsed -or -not $parsed[0].success) {
    throw "Seed nieudany dla SQL:`n$Sql"
  }
  return $parsed
}

$seedOk = $true
try {
  Info "Seeduję dane do lokalnego D1..."
  # Sytuacja stranskrybowana, z fiszkami już wygenerowanymi.
  $sitDone = (Invoke-D1 "INSERT INTO situations (user_id, status, flashcards_status) VALUES ($userId1, 'done', 'done') RETURNING id;")[0].results[0].id
  # 3 fiszki zakotwiczone w tej sytuacji (FK spełniony realnym id).
  Invoke-D1 ("INSERT INTO flashcards (situation_id, user_id, type, front_en, back_pl, example_en) VALUES " +
    "($sitDone, $userId1, 'word', 'invoice', 'faktura', 'Send me the invoice.'), " +
    "($sitDone, $userId1, 'phrase', 'right away', 'od razu', 'I will do it right away.'), " +
    "($sitDone, $userId1, 'sentence', 'Could you repeat that?', 'Mozesz powtorzyc?', '');") | Out-Null
  # Druga sytuacja: stranskrybowana, ale fiszki wciąż w trakcie -> generatingCount.
  Invoke-D1 "INSERT INTO situations (user_id, status, flashcards_status) VALUES ($userId1, 'done', 'pending');" | Out-Null
} catch {
  $seedOk = $false
  Write-Host $_.Exception.Message -ForegroundColor DarkRed
}
Assert $seedOk "Seed wstawił sytuację + 3 fiszki (FK ok) do lokalnego D1"
if (-not $seedOk) {
  Write-Host "Seed nieudany — przerywam (czy migracja 0003 jest zastosowana --local?)." -ForegroundColor Red
  exit 1
}

# --- 3. GET /proposals — 3 propozycje + generatingCount == 1 ---------------
$p = AsJson (Req GET '/flashcards/proposals' $h1)
Assert ($p.proposals.Count -eq 3) "GET /proposals zwraca 3 propozycje (jest: $($p.proposals.Count))"
Assert ($p.generatingCount -eq 1) "generatingCount == 1 (sytuacja done+pending) (jest: $($p.generatingCount))"

# Kształt DTO — bez status/user_id, z oczekiwanymi polami.
$first = $p.proposals[0]
$hasShape = ($null -ne $first.id) -and ($null -ne $first.situation_id) -and `
            ($null -ne $first.front_en) -and ($null -ne $first.back_pl) -and `
            ($null -eq $first.status) -and ($null -eq $first.user_id)
Assert $hasShape "Kształt fiszki: id/situation_id/front_en/back_pl obecne, status/user_id ukryte"

$cardAccept = $p.proposals[0].id   # do akceptacji
$cardReject = $p.proposals[1].id   # do odrzucenia
$cardKeep   = $p.proposals[2].id   # zostaje 'proposed' (test izolacji)

# --- 4. Akceptacja: POST /:id/accept -> 200, znika z proposals -------------
$acc = Req POST "/flashcards/$cardAccept/accept" $h1
Assert ($acc.StatusCode -eq 200) "POST /flashcards/$cardAccept/accept -> 200"

$p2 = AsJson (Req GET '/flashcards/proposals' $h1)
$acceptGone = -not ($p2.proposals.id -contains $cardAccept)
Assert ($p2.proposals.Count -eq 2 -and $acceptGone) "Zaakceptowana fiszka znika z proposals (zostaje 2)"

# --- 5. Odrzucenie: DELETE /:id -> 204, wiersz skasowany ------------------
$del = Req DELETE "/flashcards/$cardReject" $h1
Assert ($del.StatusCode -eq 204) "DELETE /flashcards/$cardReject -> 204"

$p3 = AsJson (Req GET '/flashcards/proposals' $h1)
$rejectGone = -not ($p3.proposals.id -contains $cardReject)
Assert ($p3.proposals.Count -eq 1 -and $rejectGone) "Odrzucona fiszka znika z proposals (zostaje 1)"

# --- 6. Izolacja: drugi user nie tknie fiszki pierwszego (404) ------------
$suffix2 = "{0}{1}" -f (Get-Date -Format 'HHmmss'), (Get-Random -Maximum 99999)
$reg2 = AsJson (Req POST '/auth/register' @{} @{ email = "track-a-iso-$suffix2@example.com"; password = 'haslo12345' })
$h2 = @{ Authorization = "Bearer $($reg2.token)" }
Assert ($null -ne $reg2.token) "Rejestracja usera #2 (do testu izolacji)"

$isoAccept = Req POST "/flashcards/$cardKeep/accept" $h2
Assert ($isoAccept.StatusCode -eq 404) "User #2: accept cudzej fiszki ($cardKeep) -> 404"

$isoDelete = Req DELETE "/flashcards/$cardKeep" $h2
Assert ($isoDelete.StatusCode -eq 404) "User #2: delete cudzej fiszki ($cardKeep) -> 404"

# Fiszka pierwszego usera nietknięta — wciąż widoczna jako propozycja u właściciela.
$p4 = AsJson (Req GET '/flashcards/proposals' $h1)
$keepStillThere = ($p4.proposals.id -contains $cardKeep)
Assert $keepStillThere "Cudza próba nie zmieniła fiszki user #1 (nadal w jego proposals)"

# Lista propozycji user #2 jest pusta — pełna izolacja danych.
$p2list = AsJson (Req GET '/flashcards/proposals' $h2)
Assert ($p2list.proposals.Count -eq 0) "User #2 nie widzi cudzych propozycji (lista pusta)"

# --- Podsumowanie ----------------------------------------------------------
Write-Host ""
$total = $script:pass + $script:fail
if ($script:fail -eq 0) {
  Write-Host "WYNIK: $($script:pass)/$total PASS — Ścieżka A zaliczona." -ForegroundColor Green
  exit 0
} else {
  Write-Host "WYNIK: $($script:pass)/$total PASS, $($script:fail) FAIL." -ForegroundColor Red
  exit 1
}
