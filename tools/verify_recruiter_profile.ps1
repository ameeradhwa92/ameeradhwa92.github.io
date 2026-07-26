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

function Normalize-List {
  param(
    [object[]]$Values
  )

  return @($Values | ForEach-Object { "$_".Trim().ToLowerInvariant() } | Sort-Object -Unique)
}

function Assert-SetEqual {
  param(
    [object[]]$Actual,
    [object[]]$Expected,
    [string]$Label
  )

  $actualNorm = Normalize-List $Actual
  $expectedNorm = Normalize-List $Expected
  $actualJoined = $actualNorm -join '|'
  $expectedJoined = $expectedNorm -join '|'
  Assert-True ($actualJoined -eq $expectedJoined) "$Label mismatch. Actual=[$actualJoined] Expected=[$expectedJoined]"
}

Assert-True (Test-Path $profilePath) "Missing recruiter profile registry: $profilePath"
Assert-True (Test-Path $kbPath) "Missing KB file: $kbPath"
Assert-True (Test-Path $specPath) "Missing design registry file: $specPath"

$profileRaw = Get-Content -Raw $profilePath
$profile = $profileRaw | ConvertFrom-Json
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
Assert-True ($previousRole.to -eq '2025-07-31') 'Previous-role end date must be 2025-07-31.'
Assert-True ($currentRole.PSObject.Properties.Name -contains 'sourceDistinction') 'Current role must preserve source distinction.'
Assert-True ($currentRole.sourceDistinction.PSObject.Properties.Name -contains 'letterConfirmedFacts') 'Missing letter-confirmed fact list.'
Assert-True ($currentRole.sourceDistinction.PSObject.Properties.Name -contains 'userProvidedContext') 'Missing user-provided context list.'

$requiredLetterFacts = @(
  'Full Stack Web Specialist effective 2025-08-01.',
  'The redesignation letter confirms the organizational-structure change.'
)
$requiredUserContext = @(
  'Outstanding performance in the previous role.'
)

Assert-SetEqual $currentRole.sourceDistinction.letterConfirmedFacts $requiredLetterFacts 'Current-role letter-confirmed facts'
Assert-SetEqual $currentRole.sourceDistinction.userProvidedContext $requiredUserContext 'Current-role user-provided context facts'

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
  'signatures',
  'confidential contract language'
)

$profilePrivacy = @($profile.privacyExclusions)
Assert-SetEqual $profilePrivacy $requiredPrivacyExclusions 'Profile privacy exclusions'

$requiredFactSnippets = @(
  'Full Stack Web Specialist effective 2025-08-01',
  'Web Application Developer from 2023-08-14 to 2025-07-31',
  'Stated contractual notice period: three months after confirmation.',
  'organizational-structure change',
  'outstanding performance',
  'CGPA 3.03',
  'CGPA 2.79',
  'Evidence label: professional',
  'Evidence label: academic',
  'Evidence label: user-provided context'
)

Assert-Contains $kb 'RECRUITER EVIDENCE REGISTRY' 'KB'
foreach ($snippet in $requiredFactSnippets) {
  Assert-Contains $kb $snippet 'KB'
}

foreach ($snippet in $requiredFactSnippets[0..6]) {
  Assert-Contains $spec $snippet 'Design registry'
}

$kbPrivacyLine = 'Privacy exclusions for recruiter matching: salary, nric, home address, date of birth, benefits, leave, medical, signatures, confidential contract language.'
$specPrivacyLine = 'Recruiter-facing privacy exclusions: salary, nric, home address, date of birth, benefits, leave, medical, signatures, confidential contract language.'
Assert-Contains $kb $kbPrivacyLine 'KB'
Assert-Contains $spec $specPrivacyLine 'Design registry'

$kbPrivacyValues = (($kbPrivacyLine -split ':', 2)[1] -split ',') | ForEach-Object { $_.Trim().TrimEnd('.') }
$specPrivacyValues = (($specPrivacyLine -split ':', 2)[1] -split ',') | ForEach-Object { $_.Trim().TrimEnd('.') }
Assert-SetEqual $kbPrivacyValues $requiredPrivacyExclusions 'KB privacy exclusions'
Assert-SetEqual $specPrivacyValues $requiredPrivacyExclusions 'Design registry privacy exclusions'

$mixedSkills = @(
  $profile.skills | Where-Object {
    $_.PSObject.Properties.Name -contains 'evidenceType' -and $_.evidenceType -eq 'mixed'
  }
)
Assert-True ($mixedSkills.Count -eq 0) "Skills must not use evidenceType 'mixed'."

foreach ($skill in @($profile.skills)) {
  if ($skill.PSObject.Properties.Name -contains 'evidenceRecords') {
    Assert-True (@($skill.evidenceRecords).Count -gt 0) "Skill '$($skill.name)' has empty evidenceRecords."
    foreach ($record in @($skill.evidenceRecords)) {
      Assert-True ($record.evidenceType -in @('professional', 'academic')) "Skill '$($skill.name)' has invalid evidenceType '$($record.evidenceType)'."
    }
  }
}

$kbPublicContent = $kb.Replace($kbPrivacyLine, '')

$forbiddenPatterns = @(
  '(?i)\b\d{6}-\d{2}-\d{4}\b',
  '(?i)\b(address|home address|date of birth|dob|benefits|leave entitlement|medical coverage|signature|signatures|confidential contract language)\b',
  '(?i)\bno\.\s*\d+\b',
  '(?i)\bjalan\b',
  '(?i)\blorong\b',
  '(?i)\btaman\b',
  '(?i)\brm\s*\d',
  '(?i)\bborn in\s+\d{4}\b',
  '(?i)\bsalary amount\b'
)

foreach ($pattern in $forbiddenPatterns) {
  Assert-True (-not [regex]::IsMatch($kbPublicContent, $pattern)) "Forbidden content found in KB matching pattern: $pattern"
}

Write-Host 'Recruiter profile verification passed.'
