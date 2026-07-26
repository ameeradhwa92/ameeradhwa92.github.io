Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$indexPath = Join-Path $repoRoot 'index.html'
$i18nPath = Join-Path $repoRoot 'assets/js/i18n.js'

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

function Assert-Match {
  param(
    [string]$Content,
    [string]$Pattern,
    [string]$Message
  )

  Assert-True ([regex]::IsMatch($Content, $Pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)) $Message
}

function Assert-Contains {
  param(
    [string]$Content,
    [string]$Needle,
    [string]$Label
  )

  Assert-True ($Content.Contains($Needle)) "$Label is missing: $Needle"
}

Assert-True (Test-Path $indexPath) "Missing index.html: $indexPath"
Assert-True (Test-Path $i18nPath) "Missing i18n.js: $i18nPath"

$index = Get-Content -Raw $indexPath
$i18n = Get-Content -Raw $i18nPath

$stableIds = @(
  'chat-jd-toggle',
  'chat-jd-panel',
  'chat-jd-input',
  'chat-jd-file',
  'chat-jd-file-name',
  'chat-jd-analyze',
  'chat-jd-clear',
  'chat-jd-disclaimer',
  'chat-jd-status',
  'chat-jd-result'
)

foreach ($id in $stableIds) {
  Assert-Match $index "id=`"$id`"" "Missing recruiter UI control id '$id' in index.html."
}

$requiredKeys = @(
  'chat.jd.toggle',
  'chat.jd.title',
  'chat.jd.body',
  'chat.jd.pasteLabel',
  'chat.jd.pasteHint',
  'chat.jd.fileLabel',
  'chat.jd.fileHint',
  'chat.jd.fileEmpty',
  'chat.jd.analyze',
  'chat.jd.clear',
  'chat.jd.disclaimer',
  'chat.jd.status.idle',
  'chat.jd.resultTitle'
)

foreach ($key in $requiredKeys) {
  Assert-Match $index "data-i18n=`"$([regex]::Escape($key))`"[^>]*>[^<]+" "English DOM source is missing data-i18n key '$key' with visible text."
  Assert-Match $i18n "`"$([regex]::Escape($key))`"\s*:\s*`"[^`"]+`"" "Bahasa Melayu translation is missing key '$key'."
}

$disclaimerEn = 'This is an estimated compatibility score based only on the job description and Ameer''s published profile. It is not an objective hiring decision, technical assessment, or guarantee of suitability.'
$disclaimerMs = 'Ini ialah skor keserasian anggaran yang berasaskan hanya pada huraian jawatan dan profil terbitan Ameer. Ia bukan keputusan pengambilan pekerja yang objektif, penilaian teknikal, atau jaminan kesesuaian.'

Assert-Contains $index $disclaimerEn 'English disclaimer'
Assert-Contains $i18n $disclaimerMs 'Bahasa Melayu disclaimer'
Assert-Match $index 'id="chat-jd-disclaimer"[\s\S]*?This is an estimated compatibility score based only on the job description and Ameer''s published profile\.' 'Recruiter disclaimer element must contain the exact English disclaimer text.'

$expectedChips = @(
  'What does he do now?',
  'Which projects are still live?',
  'What''s his tech stack?',
  'How do I contact him?'
)

foreach ($chip in $expectedChips) {
  Assert-Contains $index $chip 'Original AIMeer suggestion chip'
}

Assert-Match $index '<script src="assets/js/i18n\.js" defer></script>\s*<script src="assets/js/main\.js" defer></script>\s*<script src="assets/js/aimeer-device\.js" defer></script>\s*<script src="assets/js/jd-extractor\.js" defer></script>\s*<script src="assets/js/jd-matcher\.js" defer></script>\s*<script src="assets/js/chatbot\.js" defer></script>' 'JD extractor and matcher scripts must load before chatbot.js.'

Write-Host 'Recruiter UI verification passed.'
