Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$profilePath = Join-Path $repoRoot 'assets/data/aimeer-profile.json'
$kbPath = Join-Path $repoRoot 'assets/data/aimeer-kb.txt'
$specPath = Join-Path $repoRoot 'docs/superpowers/specs/2026-07-24-portfolio-site-design.md'

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

function Assert-Contains {
  param(
    [string]$Content,
    [string]$Needle,
    [string]$Label
  )

  Assert-True ($Content.Contains($Needle)) "$Label is missing: $Needle"
}

Assert-True (Test-Path $profilePath) "Missing recruiter profile registry: $profilePath"
Assert-True (Test-Path $kbPath) "Missing KB file: $kbPath"
Assert-True (Test-Path $specPath) "Missing design registry file: $specPath"

$profile = Get-Content -Raw $profilePath | ConvertFrom-Json
$kb = Get-Content -Raw $kbPath
$spec = Get-Content -Raw $specPath

Assert-True ($profile.profileVersion -eq '2026-07-26') 'Unexpected profileVersion.'
Assert-True ($profile.noticePeriod.valueMonths -eq 3) 'Expected a three-month notice period.'
Assert-True ($profile.noticePeriod.text -eq 'Stated contractual notice period: three months after confirmation.') 'Unexpected notice-period text.'

$currentRole = @($profile.roles | Where-Object title -eq 'Full Stack Web Specialist' | Select-Object -First 1)[0]
$previousRole = @($profile.roles | Where-Object title -eq 'Web Application Developer' | Select-Object -First 1)[0]

Assert-True ($null -ne $currentRole) 'Missing Full Stack Web Specialist role.'
Assert-True ($null -ne $previousRole) 'Missing Web Application Developer role.'
Assert-True ($currentRole.from -eq '2025-08-01') 'Current-role effective date must be 2025-08-01.'
Assert-True ($previousRole.from -eq '2023-08-14') 'Previous-role start date must be 2023-08-14.'

$diploma = @($profile.education | Where-Object qualification -eq 'Diploma in Computer Science' | Select-Object -First 1)[0]
$degree = @($profile.education | Where-Object qualification -eq 'Bachelor of Information Technology (Hons.) Intelligent Systems Engineering' | Select-Object -First 1)[0]

Assert-True ($null -ne $diploma) 'Missing diploma education entry.'
Assert-True ($null -ne $degree) 'Missing degree education entry.'
Assert-True ([double]$diploma.cgpa -eq 3.03) 'Diploma CGPA must be 3.03.'
Assert-True ([double]$degree.cgpa -eq 2.79) 'Degree CGPA must be 2.79.'

$requiredPrivacyExclusions = @(
  'salary',
  'nric',
  'home address',
  'date of birth',
  'benefits',
  'leave',
  'medical',
  'confidential contract terms'
)

foreach ($item in $requiredPrivacyExclusions) {
  Assert-True (@($profile.privacyExclusions) -contains $item) "Missing privacy exclusion: $item"
}

$kbRequiredSnippets = @(
  'RECRUITER EVIDENCE REGISTRY',
  'Full Stack Web Specialist at RetailAIM Malaysia Sdn. Bhd. effective 2025-08-01.',
  'Web Application Developer at RetailAIM Malaysia Sdn. Bhd. from 2023-08-14 until 2025-07-31.',
  'Stated contractual notice period: three months after confirmation.',
  'Ameer-supplied performance context',
  'organizational-structure change',
  'CGPA 3.03',
  'CGPA 2.79',
  'Evidence label: professional',
  'Evidence label: academic',
  'Evidence label: user-provided context'
)

foreach ($snippet in $kbRequiredSnippets) {
  Assert-Contains $kb $snippet 'KB'
}

$specRequiredSnippets = @(
  'Full Stack Web Specialist effective 2025-08-01',
  'Web Application Developer from 2023-08-14 to 2025-07-31',
  'three months after confirmation',
  'CGPA 3.03',
  'CGPA 2.79'
)

foreach ($snippet in $specRequiredSnippets) {
  Assert-Contains $spec $snippet 'Design registry'
}

$forbiddenPatterns = @(
  '(?i)\b\d{6}-\d{2}-\d{4}\b',
  '(?i)\bno\.\s*\d+\b',
  '(?i)\bjalan\b',
  '(?i)\bshah alam, selangor, malaysia\b',
  '(?i)\brm\s*\d',
  '(?i)\bsalary amount\b'
)

foreach ($pattern in $forbiddenPatterns) {
  Assert-True (-not [regex]::IsMatch($kb, $pattern)) "Forbidden content found in KB matching pattern: $pattern"
}

Write-Host 'Recruiter profile verification passed.'
