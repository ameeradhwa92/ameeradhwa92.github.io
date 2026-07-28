(function (global) {
  "use strict";

  var CATEGORY_ORDER = [
    "coreTechnologies",
    "professionalExperience",
    "architectureDeliveryCloud",
    "domainIntegrations",
    "mobile",
    "educationCoursework",
    "languagesCommunication"
  ];

  var CATEGORY_META = {
    coreTechnologies: { label: "Core technologies", weight: 35 },
    professionalExperience: { label: "Professional experience and seniority", weight: 20 },
    architectureDeliveryCloud: { label: "Production architecture, delivery, and cloud", weight: 15 },
    domainIntegrations: { label: "Domain and integrations", weight: 10 },
    mobile: { label: "Mobile delivery", weight: 5 },
    educationCoursework: { label: "Education and coursework", weight: 10 },
    languagesCommunication: { label: "Communication and collaboration", weight: 5 }
  };

  var STRENGTH_FACTOR = {
    required: 1,
    neutral: 0.75,
    preferred: 0.5
  };

  var MATCH_FACTOR = {
    strong: 1,
    partial: 0.5,
    gap: 0,
    unverified: 0
  };

  var PRIVACY_TERMS = [
    "salary",
    "compensation",
    "current pay",
    "expected pay",
    "current package",
    "salary expectation",
    "salary expectations"
  ];

  var AMBIGUOUS_SHORT_ALIASES = {
    ts: true,
    ef: true,
    arm: true
  };

  var UMBRELLA_ALIASES = [
    {
      canonical: "Azure",
      aliases: ["azure", "microsoft azure"],
      category: "architectureDeliveryCloud",
      skillNames: ["Azure SQL", "Azure DevOps", "Azure App Service", "Bicep"]
    },
    {
      canonical: "Communication",
      aliases: ["communication", "stakeholder communication", "written communication", "verbal communication"],
      category: "languagesCommunication",
      evidenceType: "user-provided",
      evidence: ["Language ability is represented as Bahasa Malaysia native and English professional."]
    },
    {
      canonical: "English",
      aliases: ["english"],
      category: "languagesCommunication",
      evidenceType: "user-provided",
      evidence: ["Language ability is represented as Bahasa Malaysia native and English professional."]
    },
    {
      canonical: "Bahasa Malaysia",
      aliases: ["bahasa malaysia", "bahasa melayu", "malay"],
      category: "languagesCommunication",
      evidenceType: "user-provided",
      evidence: ["Language ability is represented as Bahasa Malaysia native and English professional."]
    },
    {
      canonical: "Agile",
      aliases: ["agile", "agile methodologies", "agile environment", "scrum", "iterative delivery"],
      category: "professionalExperience",
      evidenceType: "user-provided",
      evidence: ["Ameer reports that the current company practices Agile methodology."]
    },
    {
      canonical: "AI-assisted development",
      aliases: ["ai-assisted coding", "genai-assisted coding", "genai-assisted development", "ai tools", "claude code", "codex", "github copilot", "cursor", "gemini cli"],
      category: "coreTechnologies",
      evidenceType: "user-provided",
      evidence: ["Ameer reports using Claude Code and Codex extensively for portfolio and application development."]
    },
    {
      canonical: "Enterprise web application development",
      aliases: ["enterprise web application development", "enterprise web applications", "web application development", "software application development"],
      category: "professionalExperience",
      evidenceType: "professional",
      evidence: ["Published career history documents 12+ years delivering enterprise web and mobile systems."]
    },
    {
      canonical: "Requirements analysis",
      aliases: ["business requirements", "requirements analysis", "analyse business requirements", "analyze business requirements"],
      category: "professionalExperience",
      evidenceType: "professional",
      evidence: ["Published project history documents delivery of business and government systems across multiple domains."]
    },
    {
      canonical: "SQL databases",
      aliases: ["sql databases", "sql database", "sql queries", "relational databases"],
      category: "coreTechnologies",
      evidenceType: "professional",
      evidence: ["Published skills and projects document MS SQL Server, Azure SQL, MySQL and SQLite delivery."]
    },
    {
      canonical: "Application quality",
      aliases: ["testing", "code reviews", "code review", "performance optimisation", "performance optimization", "secure coding", "secure coding practices", "troubleshooting"],
      category: "professionalExperience",
      evidenceType: "professional",
      evidence: ["Published resume documents testing, code review, incident response, secure delivery and continuous improvement work."]
    },
    {
      canonical: "Production delivery",
      aliases: ["ci/cd", "cicd", "application deployments", "deployments", "production support", "system enhancements", "technical documentation", "user guides", "system specifications"],
      category: "architectureDeliveryCloud",
      evidenceType: "professional",
      evidence: ["Published project history documents Azure DevOps pipelines, production deployments, system enhancements and delivery documentation."]
    },
    {
      canonical: "Stakeholder collaboration",
      aliases: ["collaborate with business users", "business users", "vendors", "product owners", "cross-functional teams", "stakeholder collaboration", "stakeholder communication"],
      category: "languagesCommunication",
      evidenceType: "professional",
      evidence: ["Published career history documents delivery with government agencies, FMCG brands and cross-functional project stakeholders."]
    }
  ];

  var RECRUITER_EVIDENCE_HINTS = [
    {
      id: "professional.production-delivery",
      terms: [
        "azure devops",
        "ci/cd",
        "cicd",
        "production delivery",
        "application deployments",
        "deployments",
        "production support",
        "system enhancements",
        "technical documentation",
        "user guides",
        "system specifications",
        "delivery documentation"
      ]
    },
    {
      id: "professional.azure-delivery",
      terms: [
        "azure",
        "azure devops",
        "azure app service",
        "bicep",
        "arm",
        "arm/bicep iac",
        "git",
        "cloud delivery",
        "infrastructure as code",
        "production delivery"
      ]
    },
    {
      id: "professional.web-api-architecture",
      terms: [
        "asp.net core",
        "asp.net",
        ".net",
        "dotnet",
        "react",
        "typescript",
        "fastapi",
        "rest/soap apis",
        "api integration",
        "web application architecture",
        "clean architecture",
        "enterprise web application development",
        "enterprise web applications",
        "web application development"
      ]
    },
    {
      id: "professional.mobile-delivery",
      terms: [
        "android",
        "android sdk",
        "ios",
        "flutter",
        "dart",
        "kotlin",
        "java",
        "mobile delivery",
        "cross-platform development"
      ]
    },
    {
      id: "professional.application-quality",
      terms: [
        "application quality",
        "testing",
        "code review",
        "code reviews",
        "incident response",
        "secure delivery",
        "continuous improvement",
        "troubleshooting",
        "performance optimisation",
        "performance optimization",
        "secure coding"
      ]
    },
    {
      id: "professional.database-design",
      terms: [
        "sql databases",
        "sql database",
        "sql queries",
        "relational databases",
        "database design",
        "ms sql server",
        "azure sql",
        "mysql",
        "sqlite"
      ]
    },
    {
      id: "professional.stakeholder-collaboration",
      terms: [
        "stakeholder collaboration",
        "stakeholder communication",
        "business requirements",
        "requirements analysis",
        "analyse business requirements",
        "analyze business requirements",
        "business users",
        "vendors",
        "product owners",
        "cross-functional teams"
      ]
    },
    {
      id: "academic.intelligent-systems",
      terms: [
        "artificial intelligence",
        "knowledge-based systems",
        "intelligent systems",
        "tesseract ocr",
        "tesseract",
        "ocr"
      ]
    },
    {
      id: "user.agile-context",
      terms: [
        "agile",
        "agile methodologies",
        "agile environment",
        "scrum",
        "iterative delivery",
        "ai-assisted development",
        "ai-assisted coding",
        "genai-assisted coding",
        "genai-assisted development",
        "ai tools",
        "claude code",
        "codex",
        "github copilot",
        "cursor",
        "gemini cli"
      ]
    }
  ];

  function roundScore(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function clampScore(value) {
    return Math.max(0, Math.min(100, value));
  }

  function normalizeKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[()]/g, " ")
      .replace(/[^a-z0-9+#./\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toTitleCase(value) {
    return String(value || "")
      .split(/\s+/)
      .filter(Boolean)
      .map(function (part) { return part.charAt(0).toUpperCase() + part.slice(1); })
      .join(" ");
  }

  function toKebabCase(value) {
    return String(value || "")
      .replace(/#/g, " sharp ")
      .replace(/\+/g, " plus ")
      .replace(/DevOps/g, "Devops")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/&/g, " and ")
      .replace(/[^A-Za-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase();
  }

  function monthsBetween(from, to) {
    var start = new Date(from + "T00:00:00Z");
    var end = new Date((to || "2026-07-26") + "T00:00:00Z");
    if (!(start instanceof Date) || isNaN(start) || !(end instanceof Date) || isNaN(end) || end < start) return 0;
    var years = end.getUTCFullYear() - start.getUTCFullYear();
    var months = end.getUTCMonth() - start.getUTCMonth();
    var total = years * 12 + months;
    if (end.getUTCDate() >= start.getUTCDate()) total += 1;
    return Math.max(0, total);
  }

  function mergeCareerIntervals(intervals, fallbackEnd) {
    var normalized = [];
    for (var index = 0; index < intervals.length; index += 1) {
      var interval = intervals[index] || {};
      var start = new Date(String(interval.from || "") + "T00:00:00Z");
      var endText = interval.to || fallbackEnd;
      var end = new Date(String(endText || "") + "T00:00:00Z");
      if (isNaN(start) || isNaN(end) || end < start) continue;
      normalized.push({ start: start, end: end });
    }
    normalized.sort(function (left, right) { return left.start - right.start; });

    var merged = [];
    for (var itemIndex = 0; itemIndex < normalized.length; itemIndex += 1) {
      var item = normalized[itemIndex];
      var previous = merged.length ? merged[merged.length - 1] : null;
      if (previous && item.start <= new Date(previous.end.getTime() + 86400000)) {
        if (item.end > previous.end) previous.end = item.end;
      } else {
        merged.push({ start: item.start, end: item.end });
      }
    }
    return merged;
  }

  function intervalMonths(interval) {
    return monthsBetween(
      interval.start.toISOString().slice(0, 10),
      interval.end.toISOString().slice(0, 10)
    );
  }

  function hasPrivacyTerm(text, exclusions) {
    var value = normalizeKey(text);
    for (var index = 0; index < PRIVACY_TERMS.length; index += 1) {
      if (value.indexOf(PRIVACY_TERMS[index]) !== -1) return true;
    }
    for (var exIndex = 0; exIndex < exclusions.length; exIndex += 1) {
      if (value.indexOf(normalizeKey(exclusions[exIndex])) !== -1) return true;
    }
    return false;
  }

  function uniquePush(list, seen, value) {
    var key = normalizeKey(value);
    if (!key || seen[key]) return;
    seen[key] = true;
    list.push(value);
  }

  function createSkillEntry(name, category) {
    return {
      canonical: name,
      category: category || inferCategory(name),
      aliases: [],
      evidence: [],
      evidenceRefs: [],
      evidenceType: null,
      hasProfessional: false,
      hasAcademic: false,
      hasUserProvided: false
    };
  }

  function addUniqueValue(list, value) {
    if (!value || list.indexOf(value) !== -1) return;
    list.push(value);
  }

  function mergeUniqueValues(target, values) {
    for (var index = 0; index < values.length; index += 1) addUniqueValue(target, values[index]);
  }

  function recruiterEvidenceSupportsTerm(record, term, includeScope) {
    if (!record || !term) return false;
    var fields = []
      .concat(record.technologies || [])
      .concat(record.capabilities || []);
    if (includeScope) fields = fields.concat(record.scope || []);
    var normalizedTerm = normalizeKey(term);
    return fields.some(function (value) { return normalizeKey(value) === normalizedTerm; });
  }

  function resolveRecruiterEvidenceRefsForValues(values, recruiterEvidenceById) {
    var refs = [];
    var normalized = values
      .map(function (value) { return normalizeKey(value); })
      .filter(Boolean);
    var canonical = normalized[0];
    for (var hintIndex = 0; hintIndex < RECRUITER_EVIDENCE_HINTS.length; hintIndex += 1) {
      var hint = RECRUITER_EVIDENCE_HINTS[hintIndex];
      var record = recruiterEvidenceById[hint.id];
      if (!record) continue;
      var canonicalSupported = recruiterEvidenceSupportsTerm(record, canonical, true);
      for (var termIndex = 0; termIndex < hint.terms.length; termIndex += 1) {
        var hintTerm = hint.terms[termIndex];
        if (normalized.indexOf(normalizeKey(hintTerm)) !== -1 &&
            (canonicalSupported || recruiterEvidenceSupportsTerm(record, hintTerm, false))) {
          addUniqueValue(refs, hint.id);
          break;
        }
      }
    }
    return refs;
  }

  function assignRequirementIds(requirements) {
    var seen = Object.create(null);
    for (var index = 0; index < requirements.length; index += 1) {
      var requirement = requirements[index];
      var baseId = [
        "req",
        toKebabCase(requirement.category),
        toKebabCase(requirement.term)
      ].join("-");
      var nextId = baseId;
      var suffix = 2;
      while (seen[nextId]) {
        nextId = baseId + "-" + suffix;
        suffix += 1;
      }
      seen[nextId] = true;
      requirement.id = nextId;
    }
    return requirements;
  }

  function buildRequirementResult(requirement, classification) {
    return {
      id: requirement.id,
      term: classification.term,
      original: requirement.original,
      strength: requirement.strength,
      heading: requirement.heading,
      category: classification.category || requirement.category,
      yearsRequired: requirement.yearsRequired,
      specificHandsOn: !!requirement.specificHandsOn,
      classification: classification.classification,
      evidenceType: classification.evidenceType,
      evidenceRefs: Array.isArray(classification.evidenceRefs) ? classification.evidenceRefs.slice() : []
    };
  }

  function inferCategory(term) {
    var key = normalizeKey(term);
    if (!key) return "coreTechnologies";
    if (/\b(year|senior|lead|delivery|ownership)\b/.test(key)) return "professionalExperience";
    if (/\b(azure|cloud|devops|app service|bicep|iac|ci cd|cicd|git)\b/.test(key)) return "architectureDeliveryCloud";
    if (/\b(android|ios|flutter|kotlin|java|swift|ionic|mobile|ocr|tesseract)\b/.test(key)) return "mobile";
    if (/\b(rest|soap|salesforce|sap|autocount|payment|whatsapp|push notification|integration)\b/.test(key)) return "domainIntegrations";
    if (/\b(english|bahasa|malay|communication|stakeholder)\b/.test(key)) return "languagesCommunication";
    if (/\b(degree|diploma|bachelor|coursework|subject|cgpa|algorithm|computer science|software engineering|information technology)\b/.test(key)) return "educationCoursework";
    return "coreTechnologies";
  }

  function addEvidenceFlags(entry, type, evidence) {
    var normalizedType = normalizeKey(type);
    if (normalizedType.indexOf("professional") !== -1 || normalizedType.indexOf("employment") !== -1) entry.hasProfessional = true;
    if (normalizedType.indexOf("academic") !== -1) entry.hasAcademic = true;
    if (normalizedType.indexOf("user provided") !== -1 || normalizedType.indexOf("user-provided") !== -1) entry.hasUserProvided = true;
    if (!entry.evidenceType) {
      if (entry.hasProfessional) entry.evidenceType = "professional";
      else if (entry.hasAcademic) entry.evidenceType = "academic";
      else if (entry.hasUserProvided) entry.evidenceType = "user-provided";
    } else if (entry.hasProfessional) {
      entry.evidenceType = "professional";
    } else if (entry.evidenceType !== "professional" && entry.hasAcademic) {
      entry.evidenceType = "academic";
    }
    for (var index = 0; index < evidence.length; index += 1) {
      if (entry.evidence.indexOf(evidence[index]) === -1) entry.evidence.push(evidence[index]);
    }
  }

  function buildProfileIndex(profile) {
    var aliasMap = Object.create(null);
    var skillMap = Object.create(null);
    var recruiterEvidence = Array.isArray(profile && profile.recruiterEvidence) ? profile.recruiterEvidence : [];
    var recruiterEvidenceById = Object.create(null);
    var professionalEvidence = [];
    var academicEvidence = [];
    var userProvidedEvidence = [];
    var professionalSeen = Object.create(null);
    var academicSeen = Object.create(null);
    var userProvidedSeen = Object.create(null);

    function registerAlias(alias, entry) {
      var key = normalizeKey(alias);
      if (!key) return;
      if (!Array.isArray(entry.aliases)) entry.aliases = [];
      if (entry.aliases.indexOf(alias) === -1) entry.aliases.push(alias);
      aliasMap[key] = entry;
    }

    function registerSkill(entry, aliases) {
      skillMap[entry.canonical] = entry;
      registerAlias(entry.canonical, entry);
      for (var aliasIndex = 0; aliasIndex < aliases.length; aliasIndex += 1) {
        registerAlias(aliases[aliasIndex], entry);
      }
      mergeUniqueValues(entry.evidenceRefs, resolveRecruiterEvidenceRefsForValues(
        [entry.canonical].concat(aliases || []),
        recruiterEvidenceById
      ));
    }

    for (var recruiterEvidenceIndex = 0; recruiterEvidenceIndex < recruiterEvidence.length; recruiterEvidenceIndex += 1) {
      var recruiterEvidenceRecord = recruiterEvidence[recruiterEvidenceIndex];
      if (recruiterEvidenceRecord && recruiterEvidenceRecord.id) {
        recruiterEvidenceById[recruiterEvidenceRecord.id] = recruiterEvidenceRecord;
      }
    }

    var skills = Array.isArray(profile && profile.skills) ? profile.skills : [];
    for (var skillIndex = 0; skillIndex < skills.length; skillIndex += 1) {
      var skill = skills[skillIndex];
      var entry = createSkillEntry(skill.name, skill.category || inferCategory(skill.name));
      var evidenceRecords = Array.isArray(skill.evidenceRecords) && skill.evidenceRecords.length
        ? skill.evidenceRecords
        : (skill.evidence || []).map(function (name) {
            return { name: name, evidenceType: skill.evidenceType || "professional" };
          });
      for (var recordIndex = 0; recordIndex < evidenceRecords.length; recordIndex += 1) {
        var record = evidenceRecords[recordIndex];
        addEvidenceFlags(entry, record.evidenceType || skill.evidenceType || "professional", [record.name]);
      }
      registerSkill(entry, skill.aliases || []);
    }

    for (var umbrellaIndex = 0; umbrellaIndex < UMBRELLA_ALIASES.length; umbrellaIndex += 1) {
      var umbrella = UMBRELLA_ALIASES[umbrellaIndex];
      var umbrellaEntry = createSkillEntry(umbrella.canonical, umbrella.category);
      if (umbrella.skillNames && umbrella.skillNames.length) {
        for (var skillNameIndex = 0; skillNameIndex < umbrella.skillNames.length; skillNameIndex += 1) {
          var linked = skillMap[umbrella.skillNames[skillNameIndex]];
          if (!linked) continue;
          addEvidenceFlags(umbrellaEntry, linked.evidenceType || "professional", linked.evidence);
          if (linked.hasProfessional) umbrellaEntry.hasProfessional = true;
          if (linked.hasAcademic) umbrellaEntry.hasAcademic = true;
          if (linked.hasUserProvided) umbrellaEntry.hasUserProvided = true;
          if (!umbrellaEntry.evidenceType) umbrellaEntry.evidenceType = linked.evidenceType;
          if (umbrellaEntry.evidenceType !== "professional" && linked.hasProfessional) umbrellaEntry.evidenceType = "professional";
        }
      }
      if (umbrella.evidence && umbrella.evidence.length) {
        addEvidenceFlags(umbrellaEntry, umbrella.evidenceType || "user-provided", umbrella.evidence);
      }
      registerSkill(umbrellaEntry, umbrella.aliases || []);
    }

    var evidenceGroups = Array.isArray(profile && profile.evidence) ? profile.evidence : [];
    for (var groupIndex = 0; groupIndex < evidenceGroups.length; groupIndex += 1) {
      var group = evidenceGroups[groupIndex];
      var items = Array.isArray(group.items) ? group.items : [];
      for (var itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        if (normalizeKey(group.label).indexOf("professional") !== -1) uniquePush(professionalEvidence, professionalSeen, items[itemIndex]);
        else if (normalizeKey(group.label).indexOf("academic") !== -1) uniquePush(academicEvidence, academicSeen, items[itemIndex]);
        else uniquePush(userProvidedEvidence, userProvidedSeen, items[itemIndex]);
      }
    }

    var education = Array.isArray(profile && profile.education) ? profile.education : [];
    var educationTerms = Object.create(null);
    var hasRelevantDegree = false;
    var highestQualificationLevel = 0;
    var highestQualificationLabel = "undisclosed qualification";
    for (var educationIndex = 0; educationIndex < education.length; educationIndex += 1) {
      var item = education[educationIndex];
      if (/\b(computer science|information technology|intelligent systems)\b/i.test(item.qualification || "")) {
        hasRelevantDegree = true;
      }
      var qualificationLevel = inferQualificationLevel(item.qualification);
      if (qualificationLevel > highestQualificationLevel) {
        highestQualificationLevel = qualificationLevel;
        highestQualificationLabel = item.qualification;
      }
      registerAlias(item.qualification, {
        canonical: item.qualification,
        category: "educationCoursework",
        evidenceType: "academic",
        evidence: [item.qualification + " - " + item.institution],
        hasProfessional: false,
        hasAcademic: true,
        hasUserProvided: false
      });
      var subjects = Array.isArray(item.subjects) ? item.subjects : [];
      for (var subjectIndex = 0; subjectIndex < subjects.length; subjectIndex += 1) {
        educationTerms[normalizeKey(subjects[subjectIndex])] = subjects[subjectIndex];
      }
      var projects = Array.isArray(item.projects) ? item.projects : [];
      for (var projectIndex = 0; projectIndex < projects.length; projectIndex += 1) {
        var project = projects[projectIndex];
        if (Array.isArray(project.stack)) {
          for (var stackIndex = 0; stackIndex < project.stack.length; stackIndex += 1) {
            educationTerms[normalizeKey(project.stack[stackIndex])] = project.stack[stackIndex];
          }
        }
      }
    }

    var verifiedTenure = profile && profile.verifiedTenure && typeof profile.verifiedTenure === "object"
      ? profile.verifiedTenure
      : {};
    var roles = Array.isArray(verifiedTenure.intervals) && verifiedTenure.intervals.length
      ? verifiedTenure.intervals
      : (Array.isArray(profile && profile.roles) ? profile.roles : []);
    var mergedIntervals = mergeCareerIntervals(roles, verifiedTenure.asOf || profile.profileVersion || "2026-07-26");
    var documentedMonths = 0;
    for (var roleIndex = 0; roleIndex < mergedIntervals.length; roleIndex += 1) {
      documentedMonths += intervalMonths(mergedIntervals[roleIndex]);
    }
    var minimumYears = Number(verifiedTenure.minimumYears) || 0;
    var documentedYears = Math.max(roundScore(documentedMonths / 12), minimumYears);
    var tenureEvidence = Array.isArray(verifiedTenure.evidence) && verifiedTenure.evidence.length
      ? verifiedTenure.evidence.slice()
      : ["Published role intervals establish approximately " + documentedYears + " years of professional tenure."];

    return {
      aliasMap: aliasMap,
      skillMap: skillMap,
      hasRelevantDegree: hasRelevantDegree,
      highestQualificationLevel: highestQualificationLevel,
      highestQualificationLabel: highestQualificationLabel,
      educationTerms: educationTerms,
      privacyExclusions: Array.isArray(profile && profile.privacyExclusions) ? profile.privacyExclusions.slice() : [],
      professionalEvidence: professionalEvidence,
      academicEvidence: academicEvidence,
      userProvidedEvidence: userProvidedEvidence,
      documentedYears: documentedYears,
      tenureEvidence: tenureEvidence
    };
  }

  function inferQualificationLevel(text) {
    var key = normalizeKey(text);
    if (/\b(phd|doctorate)\b/.test(key)) return 4;
    if (/\b(master|masters|msc|mba)\b/.test(key)) return 3;
    if (/\b(bachelor|degree|hons)\b/.test(key)) return 2;
    if (/\b(diploma)\b/.test(key)) return 1;
    return 0;
  }

  function splitLine(line) {
    return String(line || "")
      .replace(/^\s*[-*•]\s*/g, "")
      .split(/[;,]\s*/g)
      .map(function (part) { return part.trim(); })
      .filter(Boolean);
  }

  function isAdministrativeSection(heading) {
    return normalizeKey(heading) === "administrative";
  }

  function isAdministrativeLine(text) {
    var key = normalizeKey(text);
    return /^(employer questions|application questions|work location|location|salary|expected monthly basic salary|right to work|which of the following)/.test(key);
  }

  function hasAliasBoundaries(normalizedText, aliasKey, startIndex) {
    var before = startIndex > 0 ? normalizedText.charAt(startIndex - 1) : "";
    var afterIndex = startIndex + aliasKey.length;
    var after = afterIndex < normalizedText.length ? normalizedText.charAt(afterIndex) : "";
    return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
  }

  function hasUppercaseShortAlias(source, aliasKey) {
    var upper = aliasKey.toUpperCase();
    var pattern = new RegExp("(^|[^A-Za-z0-9])" + upper + "([^A-Za-z0-9]|$)");
    return pattern.test(String(source || ""));
  }

  function aliasMatches(source, alias) {
    var normalized = normalizeKey(source);
    var key = normalizeKey(alias);
    if (!normalized || !key) return false;
    if (normalized === key) return true;

    var fromIndex = 0;
    while (fromIndex <= normalized.length - key.length) {
      var foundAt = normalized.indexOf(key, fromIndex);
      if (foundAt === -1) return false;
      if (hasAliasBoundaries(normalized, key, foundAt)) {
        if (!AMBIGUOUS_SHORT_ALIASES[key] || hasUppercaseShortAlias(source, key)) return true;
      }
      fromIndex = foundAt + 1;
    }
    return false;
  }

  function collectAliasOccurrences(source, index) {
    var normalized = normalizeKey(source);
    if (!normalized) return [];

    var occurrences = [];
    var keys = Object.keys(index.aliasMap).sort(function (left, right) { return right.length - left.length || left.localeCompare(right); });
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      var key = keys[keyIndex];
      var fromIndex = 0;
      while (fromIndex <= normalized.length - key.length) {
        var foundAt = normalized.indexOf(key, fromIndex);
        if (foundAt === -1) break;
        if (hasAliasBoundaries(normalized, key, foundAt)) {
          if (!AMBIGUOUS_SHORT_ALIASES[key] || hasUppercaseShortAlias(source, key)) {
            occurrences.push({
              entry: index.aliasMap[key],
              aliasKey: key,
              start: foundAt,
              end: foundAt + key.length
            });
          }
        }
        fromIndex = foundAt + 1;
      }
    }

    occurrences.sort(function (left, right) {
      var leftLength = left.end - left.start;
      var rightLength = right.end - right.start;
      return left.start - right.start ||
        rightLength - leftLength ||
        left.aliasKey.localeCompare(right.aliasKey) ||
        left.entry.canonical.localeCompare(right.entry.canonical);
    });

    var kept = [];
    var seen = Object.create(null);
    for (var occurrenceIndex = 0; occurrenceIndex < occurrences.length; occurrenceIndex += 1) {
      var candidate = occurrences[occurrenceIndex];
      var candidateKey = [
        normalizeKey(candidate.entry.canonical),
        candidate.start,
        candidate.end
      ].join("|");
      if (seen[candidateKey]) continue;

      var contained = false;
      for (var keptIndex = 0; keptIndex < kept.length; keptIndex += 1) {
        var existing = kept[keptIndex];
        if (candidate.start >= existing.start && candidate.end <= existing.end) {
          contained = true;
          break;
        }
      }
      if (contained) continue;

      seen[candidateKey] = true;
      kept.push(candidate);
    }
    return kept;
  }

  function findAliasMatches(source, index) {
    var matches = [];
    var seen = Object.create(null);
    var occurrences = collectAliasOccurrences(source, index);
    for (var occurrenceIndex = 0; occurrenceIndex < occurrences.length; occurrenceIndex += 1) {
      var occurrence = occurrences[occurrenceIndex];
      var matchKey = [
        normalizeKey(occurrence.entry.canonical),
        occurrence.start,
        occurrence.end
      ].join("|");
      if (seen[matchKey]) continue;
      seen[matchKey] = true;
      matches.push(occurrence);
    }
    return matches;
  }

  function findBestAliasOccurrence(source, entry, preferredAlias) {
    var variants = [];
    var seen = Object.create(null);

    function addVariant(value) {
      var key = normalizeKey(value);
      if (!key || seen[key]) return;
      seen[key] = true;
      variants.push(key);
    }

    addVariant(preferredAlias);
    addVariant(entry && entry.canonical);
    var aliases = Array.isArray(entry && entry.aliases) ? entry.aliases : [];
    for (var aliasIndex = 0; aliasIndex < aliases.length; aliasIndex += 1) addVariant(aliases[aliasIndex]);

    var normalized = normalizeKey(source);
    var best = null;
    for (var variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
      var key = variants[variantIndex];
      var fromIndex = 0;
      while (fromIndex <= normalized.length - key.length) {
        var foundAt = normalized.indexOf(key, fromIndex);
        if (foundAt === -1) break;
        if (hasAliasBoundaries(normalized, key, foundAt)) {
          if (!AMBIGUOUS_SHORT_ALIASES[key] || hasUppercaseShortAlias(source, key)) {
            var candidate = {
              aliasKey: key,
              start: foundAt,
              end: foundAt + key.length
            };
            if (!best ||
              candidate.start < best.start ||
              (candidate.start === best.start && (candidate.end - candidate.start) > (best.end - best.start)) ||
              (candidate.start === best.start && candidate.end === best.end && candidate.aliasKey === normalizeKey(preferredAlias))) {
              best = candidate;
            }
          }
        }
        fromIndex = foundAt + 1;
      }
    }
    return best;
  }

  function createAliasRequirement(entry, source, strength, heading, aliasMatch) {
    return {
      term: entry.canonical,
      original: String(source || "").replace(/\s+/g, " ").trim(),
      strength: strength || "neutral",
      heading: heading || null,
      category: entry.category,
      aliasEntry: entry,
      aliasMatch: aliasMatch || findBestAliasOccurrence(source, entry, entry.canonical),
      yearsRequired: null,
      specificHandsOn: false,
      normalizedText: normalizeKey(source)
    };
  }

  function createYearsRequirement(yearsMatch, source, strength, heading) {
    var sourceText = String(source || "");
    var matchIndex = sourceText.indexOf(yearsMatch[0]);
    var matchLength = yearsMatch[0].length;
    if (matchIndex < 0) {
      var locatePattern = new RegExp("(?:\\(\\s*)?\\b" + yearsMatch[1] + "\\s*(?:\\+|plus)?\\s*\\)?\\s+years?\\b", "i");
      var located = locatePattern.exec(sourceText);
      matchIndex = located ? located.index : (yearsMatch.index || 0);
      matchLength = located ? located[0].length : matchLength;
    }
    var suffix = sourceText.slice(matchIndex + matchLength);
    return {
      term: yearsMatch[1] + (yearsMatch[2] ? "+ years" : " years"),
      original: String(source || "").replace(/\s+/g, " ").trim(),
      strength: strength || "neutral",
      heading: heading || null,
      category: "professionalExperience",
      aliasEntry: null,
      yearsRequired: Number(yearsMatch[1]),
      normalizedText: normalizeKey(source),
      specificHandsOn: /^\s*of\s+hands[- ]on\s+experience\s+(?:with|in)\b/i.test(suffix),
      specificHandsOnText: suffix
    };
  }

  function createGenericRequirement(source, strength, heading, index) {
    var text = String(source || "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    if (/^or\s+(a\s+)?related\s+field\.?$/i.test(text)) return { ignored: true };
    if (hasPrivacyTerm(text, index.privacyExclusions)) return { ignored: true };
    var resolved = resolveAlias(text, index);
    if (resolved) return createAliasRequirement(resolved, text, strength, heading);
    return {
      term: toTitleCase(text),
      original: text,
      strength: strength || "neutral",
      heading: heading || null,
      category: inferCategory(text),
      aliasEntry: null,
      yearsRequired: null,
      specificHandsOn: false,
      normalizedText: normalizeKey(text)
    };
  }

  function resolveAlias(text, index) {
    var normalized = normalizeKey(text);
    if (!normalized) return null;
    if (index.aliasMap[normalized]) return index.aliasMap[normalized];
    var matches = findAliasMatches(text, index);
    if (matches.length) return matches[0];
    if (index.educationTerms[normalized]) {
      return {
        canonical: index.educationTerms[normalized],
        category: "educationCoursework",
        evidenceType: "academic",
        evidence: [index.educationTerms[normalized]],
        hasProfessional: false,
        hasAcademic: true,
        hasUserProvided: false
      };
    }
    return null;
  }

  function extractRequirements(normalizedJd, index) {
    var requirements = [];
    var seen = Object.create(null);

    function addRequirement(requirement) {
      if (!requirement || requirement.ignored) return;
      var dedupeKey = [requirement.category, normalizeKey(requirement.term)].join("|");
      var existingIndex = seen[dedupeKey];
      if (existingIndex !== undefined) {
        var existing = requirements[existingIndex];
        var existingStrength = STRENGTH_FACTOR[existing.strength] || STRENGTH_FACTOR.neutral;
        var nextStrength = STRENGTH_FACTOR[requirement.strength] || STRENGTH_FACTOR.neutral;
        if (nextStrength > existingStrength) requirements[existingIndex] = requirement;
        return;
      }
      seen[dedupeKey] = requirements.length;
      requirements.push(requirement);
    }

    var normalizedTerms = Array.isArray(normalizedJd && normalizedJd.terms) ? normalizedJd.terms : [];
    for (var termIndex = 0; termIndex < normalizedTerms.length; termIndex += 1) {
      var atomic = normalizedTerms[termIndex] || {};
      var sourceText = atomic.sourceText || atomic.term || "";
      var atomicYears = String(atomic.term || "").match(/^(\d+)\s*(\+)?\s+years?$/i);
      if (atomicYears) {
        addRequirement(createYearsRequirement(atomicYears, sourceText, atomic.strength, atomic.section));
        continue;
      }
      var atomicEntry = index.aliasMap[normalizeKey(atomic.term)] || resolveAlias(atomic.term, index);
      if (atomicEntry) {
        addRequirement(createAliasRequirement(
          atomicEntry,
          sourceText,
          atomic.strength,
          atomic.section,
          findBestAliasOccurrence(sourceText, atomicEntry, atomic.term)
        ));
      }
    }

    var sections = Array.isArray(normalizedJd && normalizedJd.sections) ? normalizedJd.sections : [];
    var sourceSections = sections.length ? sections : [{ heading: null, strength: "neutral", lines: String(normalizedJd && normalizedJd.normalizedText || "").split("\n") }];
    for (var sectionIndex = 0; sectionIndex < sourceSections.length; sectionIndex += 1) {
      var section = sourceSections[sectionIndex];
      if (isAdministrativeSection(section.heading)) continue;
      var lines = Array.isArray(section.lines) ? section.lines : [];
      for (var lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        if (isAdministrativeLine(lines[lineIndex])) continue;
        var parts = splitLine(lines[lineIndex]);
        if (!parts.length) parts = [String(lines[lineIndex] || "").trim()];
        for (var partIndex = 0; partIndex < parts.length; partIndex += 1) {
          var source = parts[partIndex];
          var foundSpecific = false;
          var yearsPattern = /(?:\(\s*)?\b(\d+)\s*(\+|plus)?\s*\)?\s+years?\b/gi;
          var yearsMatch;
          while ((yearsMatch = yearsPattern.exec(String(source || ""))) !== null) {
            addRequirement(createYearsRequirement(yearsMatch, source, section.strength, section.heading));
            foundSpecific = true;
          }
          var aliases = findAliasMatches(source, index);
          for (var aliasIndex = 0; aliasIndex < aliases.length; aliasIndex += 1) {
            addRequirement(createAliasRequirement(aliases[aliasIndex].entry, source, section.strength, section.heading, aliases[aliasIndex]));
            foundSpecific = true;
          }
          if (!foundSpecific && normalizeKey(section.heading) !== "responsibilities") {
            addRequirement(createGenericRequirement(source, section.strength, section.heading, index));
          }
        }
      }
    }
    return assignRequirementIds(dedupeNestedAliasRequirements(requirements));
  }

  function dedupeNestedAliasRequirements(requirements) {
    var keep = [];
    var groups = Object.create(null);

    for (var index = 0; index < requirements.length; index += 1) {
      var requirement = requirements[index];
      if (!requirement || !requirement.aliasEntry || !requirement.aliasMatch) {
        keep.push(requirement);
        continue;
      }
      var groupKey = [
        requirement.normalizedText,
        normalizeKey(requirement.heading),
        requirement.strength
      ].join("|");
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(requirement);
    }

    var groupKeys = Object.keys(groups);
    for (var groupIndex = 0; groupIndex < groupKeys.length; groupIndex += 1) {
      var group = groups[groupKeys[groupIndex]];
      group.sort(function (left, right) {
        var leftLength = left.aliasMatch.end - left.aliasMatch.start;
        var rightLength = right.aliasMatch.end - right.aliasMatch.start;
        return rightLength - leftLength ||
          left.aliasMatch.start - right.aliasMatch.start ||
          left.term.localeCompare(right.term);
      });

      var kept = [];
      for (var itemIndex = 0; itemIndex < group.length; itemIndex += 1) {
        var candidate = group[itemIndex];
        var contained = false;
        for (var keptIndex = 0; keptIndex < kept.length; keptIndex += 1) {
          var existing = kept[keptIndex];
          if (candidate.aliasMatch.start >= existing.aliasMatch.start &&
              candidate.aliasMatch.end <= existing.aliasMatch.end &&
              normalizeKey(candidate.term) !== normalizeKey(existing.term)) {
            contained = true;
            break;
          }
        }
        if (!contained) kept.push(candidate);
      }

      kept.sort(function (left, right) {
        return left.aliasMatch.start - right.aliasMatch.start ||
          left.term.localeCompare(right.term);
      });
      for (var keptRequirementIndex = 0; keptRequirementIndex < kept.length; keptRequirementIndex += 1) {
        keep.push(kept[keptRequirementIndex]);
      }
    }

    return keep;
  }

  function classifyRequirement(requirement, index) {
    var strengthFactor = STRENGTH_FACTOR[requirement.strength] || STRENGTH_FACTOR.neutral;
    if (requirement.yearsRequired !== null) {
      if (requirement.specificHandsOn) {
        var handsOnMatches = findAliasMatches(requirement.specificHandsOnText, index);
        var professionalHandsOn = handsOnMatches.find(function (match) {
          return match.entry && match.entry.hasProfessional;
        });
        if (professionalHandsOn) {
          return {
            id: requirement.id,
            term: requirement.term,
            original: requirement.original,
            label: "Partial match (professional evidence; specific duration is not published)",
            category: requirement.category,
            classification: "partial",
            evidenceType: "professional",
            evidence: professionalHandsOn.entry.evidence.slice(),
            evidenceRefs: Array.isArray(professionalHandsOn.entry.evidenceRefs) ? professionalHandsOn.entry.evidenceRefs.slice() : [],
            strength: requirement.strength,
            strengthFactor: strengthFactor
          };
        }
      }
      if (index.documentedYears >= requirement.yearsRequired) {
        return {
          id: requirement.id,
          term: requirement.term,
          original: requirement.original,
          label: "Strong match (documented professional tenure)",
          category: requirement.category,
          classification: "strong",
          evidenceType: "professional",
          evidence: index.tenureEvidence.slice(),
          evidenceRefs: [],
          strength: requirement.strength,
          strengthFactor: strengthFactor
        };
      }
      return {
        id: requirement.id,
        term: requirement.term,
        original: requirement.original,
        label: "Gap (documented professional tenure is below this stated threshold)",
        category: requirement.category,
        classification: "gap",
        evidenceType: "professional",
        evidence: index.tenureEvidence.slice(),
        evidenceRefs: [],
        strength: requirement.strength,
        strengthFactor: strengthFactor
      };
    }

    var aliasEntry = requirement.aliasEntry || resolveAlias(requirement.term, index);
    if (aliasEntry) {
      if (aliasEntry.hasProfessional) {
        return {
          id: requirement.id,
          term: aliasEntry.canonical,
          original: requirement.original,
          label: "Strong match (professional evidence)",
          category: aliasEntry.category || requirement.category,
          classification: "strong",
          evidenceType: "professional",
          evidence: aliasEntry.evidence.slice(),
          evidenceRefs: Array.isArray(aliasEntry.evidenceRefs) ? aliasEntry.evidenceRefs.slice() : [],
          strength: requirement.strength,
          strengthFactor: strengthFactor
        };
      }
      if (aliasEntry.hasAcademic) {
        return {
          id: requirement.id,
          term: aliasEntry.canonical,
          original: requirement.original,
          label: "Partial match (academic exposure)",
          category: aliasEntry.category || requirement.category,
          classification: "partial",
          evidenceType: "academic",
          evidence: aliasEntry.evidence.slice(),
          evidenceRefs: Array.isArray(aliasEntry.evidenceRefs) ? aliasEntry.evidenceRefs.slice() : [],
          strength: requirement.strength,
          strengthFactor: strengthFactor
        };
      }
      if (aliasEntry.hasUserProvided || aliasEntry.evidenceType === "user-provided") {
        return {
          id: requirement.id,
          term: aliasEntry.canonical,
          original: requirement.original,
          label: "Partial match (user-provided context)",
          category: aliasEntry.category || requirement.category,
          classification: "partial",
          evidenceType: "user-provided",
          evidence: aliasEntry.evidence.slice(),
          evidenceRefs: Array.isArray(aliasEntry.evidenceRefs) ? aliasEntry.evidenceRefs.slice() : [],
          strength: requirement.strength,
          strengthFactor: strengthFactor
        };
      }
    }

    var requiredQualificationLevel = inferQualificationLevel(requirement.term);
    if (requiredQualificationLevel > 0 && requirement.category === "educationCoursework") {
      if (index.highestQualificationLevel >= requiredQualificationLevel) {
        return {
          id: requirement.id,
          term: requirement.term,
          original: requirement.original,
          label: "Strong match (academic exposure: published qualification evidence)",
          category: requirement.category,
          classification: "strong",
          evidenceType: "academic",
          evidence: [index.highestQualificationLabel],
          evidenceRefs: [],
          strength: requirement.strength,
          strengthFactor: strengthFactor
        };
      }
      if (index.highestQualificationLevel > 0) {
        return {
          id: requirement.id,
          term: requirement.term,
          original: requirement.original,
          label: "Gap (published qualification evidence does not reach this stated level)",
          category: requirement.category,
          classification: "gap",
          evidenceType: "academic",
          evidence: [index.highestQualificationLabel],
          evidenceRefs: [],
          strength: requirement.strength,
          strengthFactor: strengthFactor
        };
      }
    }

    if (requirement.category === "educationCoursework" && index.hasRelevantDegree) {
      return {
        id: requirement.id,
        term: requirement.term,
        original: requirement.original,
        label: "Partial match (academic exposure: relevant computing degree)",
        category: requirement.category,
        classification: "partial",
        evidenceType: "academic",
        evidence: index.academicEvidence.slice(0, 2),
        evidenceRefs: [],
        strength: requirement.strength,
        strengthFactor: strengthFactor
      };
    }

    return {
      id: requirement.id,
      term: requirement.term,
      original: requirement.original,
      label: "Unverified (no direct evidence in the recruiter profile)",
      category: requirement.category,
      classification: "unverified",
      evidenceType: "unverified",
      evidence: [],
      evidenceRefs: [],
      strength: requirement.strength,
      strengthFactor: strengthFactor
    };
  }

  function mergeMatches(target, items) {
    var map = Object.create(null);
    for (var index = 0; index < items.length; index += 1) {
      var item = items[index];
      var key = [item.category, normalizeKey(item.term)].join("|");
      var existing = map[key];
      if (!existing || item.strengthFactor > existing.strengthFactor) {
        map[key] = item;
      }
    }
    return Object.keys(map).map(function (key) { return map[key]; }).sort(function (left, right) {
      return right.strengthFactor - left.strengthFactor || left.term.localeCompare(right.term);
    });
  }

  function scoreCategory(requirements, classifications, categoryKey) {
    var meta = CATEGORY_META[categoryKey];
    var categoryRequirements = requirements.filter(function (item) { return item.category === categoryKey; });
    var categoryClassifications = classifications.filter(function (item) { return item.category === categoryKey; });
    var matchedWeight = 0;
    var totalWeight = 0;
    for (var index = 0; index < categoryRequirements.length; index += 1) {
      totalWeight += STRENGTH_FACTOR[categoryRequirements[index].strength] || STRENGTH_FACTOR.neutral;
    }
    for (var classIndex = 0; classIndex < categoryClassifications.length; classIndex += 1) {
      matchedWeight += (MATCH_FACTOR[categoryClassifications[classIndex].classification] || 0) * categoryClassifications[classIndex].strengthFactor;
    }
    var score = totalWeight ? meta.weight * (matchedWeight / totalWeight) : 0;
    return {
      key: categoryKey,
      label: meta.label,
      weight: meta.weight,
      active: categoryRequirements.length > 0,
      score: roundScore(score),
      matchedRequirements: categoryClassifications.length,
      totalRequirements: categoryRequirements.length,
      matchedTerms: categoryClassifications.map(function (item) { return item.term; })
    };
  }

  function buildConfidence(score, requirements, classifications) {
    var total = requirements.length;
    var strongCount = classifications.filter(function (item) { return item.classification === "strong"; }).length;
    var partialCount = classifications.filter(function (item) { return item.classification === "partial"; }).length;
    var gapCount = classifications.filter(function (item) { return item.classification === "gap"; }).length;
    var unverifiedCount = classifications.filter(function (item) { return item.classification === "unverified"; }).length;
    var reasons = [];

    if (!strongCount) reasons.push("No direct evidence matched the requested stack.");
    if (partialCount) reasons.push(partialCount + " requirement(s) rely on transferable or academic exposure.");
    if (gapCount) reasons.push(gapCount + " requirement(s) conflict with published profile evidence.");
    if (unverifiedCount) reasons.push(unverifiedCount + " requirement(s) remain unverified in the profile.");
    if (!reasons.length) reasons.push("Most requested requirements have direct supporting evidence.");

    var label = "high";
    if (!total || score < 25 || strongCount / total < 0.34 || gapCount / total >= 0.34) label = "low";
    else if (score < 65 || strongCount / total < 0.67) label = "medium";

    return { label: label, reasons: reasons };
  }

  function buildInterviewTopics(partials, unverified) {
    var topics = [];
    var seen = Object.create(null);

    function pushTopic(item, prompt) {
      var key = normalizeKey(item.term);
      if (!key || seen[key]) return;
      seen[key] = true;
      topics.push({
        term: item.term,
        category: item.category,
        prompt: prompt
      });
    }

    for (var partialIndex = 0; partialIndex < partials.length; partialIndex += 1) {
      pushTopic(partials[partialIndex], "Clarify hands-on depth with " + partials[partialIndex].term + " beyond the current " + partials[partialIndex].evidenceType + " evidence.");
    }
    for (var unverifiedIndex = 0; unverifiedIndex < unverified.length; unverifiedIndex += 1) {
      pushTopic(unverified[unverifiedIndex], "Ask for concrete delivery examples or production exposure covering " + unverified[unverifiedIndex].term + ".");
    }
    return topics.slice(0, 5);
  }

  function scoreJobDescription(normalizedJd, profile) {
    var index = buildProfileIndex(profile || {});
    var requirements = extractRequirements(normalizedJd || {}, index);
    var classifications = [];
    var detailedRequirements = [];
    for (var reqIndex = 0; reqIndex < requirements.length; reqIndex += 1) {
      var classification = classifyRequirement(requirements[reqIndex], index);
      classifications.push(classification);
      detailedRequirements.push(buildRequirementResult(requirements[reqIndex], classification));
    }

    var categoryScores = {};
    for (var catIndex = 0; catIndex < CATEGORY_ORDER.length; catIndex += 1) {
      var key = CATEGORY_ORDER[catIndex];
      categoryScores[key] = scoreCategory(requirements, classifications, key);
    }

    var strongMatches = mergeMatches([], classifications.filter(function (item) { return item.classification === "strong"; }));
    var partialMatches = mergeMatches([], classifications.filter(function (item) { return item.classification === "partial"; }));
    var gaps = mergeMatches([], classifications.filter(function (item) { return item.classification === "gap"; }));
    var unverified = mergeMatches([], classifications.filter(function (item) { return item.classification === "unverified"; }));

    var totalScore = 0;
    var activeWeight = 0;
    for (var scoreIndex = 0; scoreIndex < CATEGORY_ORDER.length; scoreIndex += 1) {
      var category = categoryScores[CATEGORY_ORDER[scoreIndex]];
      if (!category.active) continue;
      totalScore += category.score;
      activeWeight += category.weight;
    }
    totalScore = activeWeight ? Math.round(clampScore((totalScore / activeWeight) * 100)) : 0;

    var professionalEvidence = [];
    var academicEvidence = [];
    var userProvidedEvidence = [];
    var professionalSeen = Object.create(null);
    var academicSeen = Object.create(null);
    var userSeen = Object.create(null);

    for (var classIndex = 0; classIndex < classifications.length; classIndex += 1) {
      var item = classifications[classIndex];
      if (item.evidenceType === "professional") {
        for (var proIndex = 0; proIndex < item.evidence.length; proIndex += 1) uniquePush(professionalEvidence, professionalSeen, item.evidence[proIndex]);
      } else if (item.evidenceType === "academic") {
        for (var acadIndex = 0; acadIndex < item.evidence.length; acadIndex += 1) uniquePush(academicEvidence, academicSeen, item.evidence[acadIndex]);
      } else if (item.evidenceType === "user-provided") {
        for (var userIndex = 0; userIndex < item.evidence.length; userIndex += 1) uniquePush(userProvidedEvidence, userSeen, item.evidence[userIndex]);
      }
    }

    var confidence = buildConfidence(totalScore, requirements, classifications);

    return {
      score: totalScore,
      deterministicScore: totalScore,
      requirements: detailedRequirements,
      categories: categoryScores,
      strongMatches: strongMatches,
      partialMatches: partialMatches,
      gaps: gaps,
      unverified: unverified,
      evidence: {
        professional: professionalEvidence,
        academic: academicEvidence,
        userProvided: userProvidedEvidence,
        privacyExclusions: index.privacyExclusions.slice()
      },
      interviewTopics: buildInterviewTopics(partialMatches, unverified),
      confidence: confidence
    };
  }

  global.JDMatcher = {
    scoreJobDescription: scoreJobDescription
  };
}(typeof window !== "undefined" ? window : globalThis));
