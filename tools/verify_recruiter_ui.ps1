Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$indexPath = Join-Path $repoRoot 'index.html'
$i18nPath = Join-Path $repoRoot 'assets/js/i18n.js'
$chatbotPath = Join-Path $repoRoot 'assets/js/chatbot.js'

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
Assert-True (Test-Path $chatbotPath) "Missing chatbot.js: $chatbotPath"

$index = Get-Content -Raw $indexPath
$i18n = Get-Content -Raw $i18nPath
$chatbot = Get-Content -Raw $chatbotPath

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

$requiredKeys = [regex]::Matches($index, 'data-i18n="(chat\.jd\.[^"]+)"') |
  ForEach-Object { $_.Groups[1].Value } |
  Sort-Object -Unique

Assert-True ($requiredKeys.Count -gt 0) 'No recruiter data-i18n keys were found in index.html.'
Assert-True ($requiredKeys -contains 'chat.jd.fileAction') 'Recruiter file action key chat.jd.fileAction is missing from index.html.'

foreach ($key in $requiredKeys) {
  Assert-Match $index "data-i18n=`"$([regex]::Escape($key))`"[^>]*>[^<]+" "English DOM source is missing data-i18n key '$key' with visible text."
  Assert-Match $i18n "`"$([regex]::Escape($key))`"\s*:\s*`"[^`"]+`"" "Bahasa Melayu translation is missing key '$key'."
}

$disclaimerEn = 'This is an estimated compatibility score based only on the job description and Ameer''s published profile. It is not an objective hiring decision, technical assessment, or guarantee of suitability.'
$disclaimerMs = 'Ini ialah skor keserasian anggaran yang berasaskan hanya pada huraian jawatan dan profil terbitan Ameer. Ia bukan keputusan pengambilan pekerja yang objektif, penilaian teknikal, atau jaminan kesesuaian.'

Assert-Contains $index $disclaimerEn 'English disclaimer'
Assert-Contains $i18n $disclaimerMs 'Bahasa Melayu disclaimer'
Assert-Match $index 'id="chat-jd-disclaimer"[\s\S]*?This is an estimated compatibility score based only on the job description and Ameer''s published profile\.' 'Recruiter disclaimer element must contain the exact English disclaimer text.'
Assert-Match $chatbot 'createJdNode\("p",\s*"chat-jd-result-disclaimer",\s*t\("jdDisclaimer"\)\)' 'chatbot.js must render the disclaimer again above every recruiter result.'
Assert-Match $chatbot 'jdDisclaimer:\s*"This is an estimated compatibility score based only on the job description and Ameer''s published profile\.' 'chatbot.js must keep the exact English disclaimer text for dynamic result rendering.'

$expectedChips = @(
  'What does he do now?',
  'Which projects are still live?',
  'What''s his tech stack?',
  'How do I contact him?'
)

foreach ($chip in $expectedChips) {
  Assert-Contains $index $chip 'Original AIMeer suggestion chip'
}

Assert-Match $index '<button class="chat-jd-file-btn" id="chat-jd-file-trigger" type="button" aria-controls="chat-jd-file" data-i18n="chat\.jd\.fileAction">' 'Recruiter file chooser must be a focusable button that controls the hidden file input.'
Assert-Match $chatbot 'jdFileTrigger\.addEventListener\("click",\s*function \(\)\s*\{\s*jdFile\.click\(\);\s*\}\);' 'chatbot.js must wire the visible recruiter file button to the hidden file input.'

Assert-Match $index '<script src="assets/js/i18n\.js" defer></script>\s*<script src="assets/js/main\.js" defer></script>\s*<script src="assets/js/aimeer-device\.js" defer></script>\s*<script src="assets/js/jd-extractor\.js" defer></script>\s*<script src="assets/js/jd-matcher\.js" defer></script>\s*<script src="assets/js/chatbot\.js" defer></script>' 'JD extractor and matcher scripts must load before chatbot.js.'

Write-Host 'Recruiter UI verification passed.'
