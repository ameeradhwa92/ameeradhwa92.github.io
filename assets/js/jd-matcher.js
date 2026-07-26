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
    languagesCommunication: { label: "Languages and communication", weight: 5 }
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

  var UMBRELLA_ALIASES = [
    {
      canonical: "Azure",
      aliases: ["azure", "cloud", "microsoft azure"],
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
      evidence: [],
      evidenceType: null,
      hasProfessional: false,
      hasAcademic: false,
      hasUserProvided: false
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
    if (/\b(degree|diploma|bachelor|coursework|subject|cgpa|algorithm|computer science|information technology)\b/.test(key)) return "educationCoursework";
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
    var professionalEvidence = [];
    var academicEvidence = [];
    var userProvidedEvidence = [];
    var professionalSeen = Object.create(null);
    var academicSeen = Object.create(null);
    var userProvidedSeen = Object.create(null);

    function registerAlias(alias, entry) {
      var key = normalizeKey(alias);
      if (!key) return;
      aliasMap[key] = entry;
    }

    function registerSkill(entry, aliases) {
      skillMap[entry.canonical] = entry;
      registerAlias(entry.canonical, entry);
      for (var aliasIndex = 0; aliasIndex < aliases.length; aliasIndex += 1) {
        registerAlias(aliases[aliasIndex], entry);
      }
    }

    var skills = Array.isArray(profile && profile.skills) ? profile.skills : [];
    for (var skillIndex = 0; skillIndex < skills.length; skillIndex += 1) {
      var skill = skills[skillIndex];
      var entry = createSkillEntry(skill.name, inferCategory(skill.name));
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
    for (var educationIndex = 0; educationIndex < education.length; educationIndex += 1) {
      var item = education[educationIndex];
      if (/\b(computer science|information technology|intelligent systems)\b/i.test(item.qualification || "")) {
        hasRelevantDegree = true;
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

    var roles = Array.isArray(profile && profile.roles) ? profile.roles : [];
    var documentedMonths = 0;
    for (var roleIndex = 0; roleIndex < roles.length; roleIndex += 1) {
      documentedMonths += monthsBetween(roles[roleIndex].from, roles[roleIndex].to || (profile.profileVersion || "2026-07-26"));
    }

    return {
      aliasMap: aliasMap,
      skillMap: skillMap,
      hasRelevantDegree: hasRelevantDegree,
      educationTerms: educationTerms,
      privacyExclusions: Array.isArray(profile && profile.privacyExclusions) ? profile.privacyExclusions.slice() : [],
      professionalEvidence: professionalEvidence,
      academicEvidence: academicEvidence,
      userProvidedEvidence: userProvidedEvidence,
      documentedYears: roundScore(documentedMonths / 12)
    };
  }

  function splitLine(line) {
    return String(line || "")
      .replace(/^\s*[-*•]\s*/g, "")
      .split(/[;,]\s*/g)
      .map(function (part) { return part.trim(); })
      .filter(Boolean);
  }

  function createRequirement(source, strength, heading, index) {
    var text = String(source || "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    if (hasPrivacyTerm(text, index.privacyExclusions)) return { ignored: true };
    var yearsMatch = text.match(/\b(\d+)\s*(\+|plus)?\s+years?\b/i);
    var normalized = normalizeKey(text);
    var resolved = resolveAlias(text, index);
    var category = resolved ? resolved.category : inferCategory(text);
    if (yearsMatch) category = "professionalExperience";
    return {
      term: yearsMatch ? yearsMatch[1] + (yearsMatch[2] ? "+ years" : " years") : (resolved ? resolved.canonical : toTitleCase(text)),
      original: text,
      strength: strength || "neutral",
      heading: heading || null,
      category: category,
      aliasEntry: resolved,
      yearsRequired: yearsMatch ? Number(yearsMatch[1]) : null,
      normalizedText: normalized
    };
  }

  function resolveAlias(text, index) {
    var normalized = normalizeKey(text);
    if (!normalized) return null;
    if (index.aliasMap[normalized]) return index.aliasMap[normalized];
    var keys = Object.keys(index.aliasMap).sort(function (left, right) { return right.length - left.length; });
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      var key = keys[keyIndex];
      if (normalized === key || normalized.indexOf(key) !== -1) return index.aliasMap[key];
    }
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
    var sections = Array.isArray(normalizedJd && normalizedJd.sections) ? normalizedJd.sections : [];
    var sourceSections = sections.length ? sections : [{ heading: null, strength: "neutral", lines: String(normalizedJd && normalizedJd.normalizedText || "").split("\n") }];
    for (var sectionIndex = 0; sectionIndex < sourceSections.length; sectionIndex += 1) {
      var section = sourceSections[sectionIndex];
      var lines = Array.isArray(section.lines) ? section.lines : [];
      for (var lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        var parts = splitLine(lines[lineIndex]);
        if (!parts.length) parts = [String(lines[lineIndex] || "").trim()];
        for (var partIndex = 0; partIndex < parts.length; partIndex += 1) {
          var requirement = createRequirement(parts[partIndex], section.strength || "neutral", section.heading, index);
          if (!requirement || requirement.ignored) continue;
          var dedupeKey = [requirement.category, normalizeKey(requirement.term)].join("|");
          if (seen[dedupeKey]) continue;
          seen[dedupeKey] = true;
          requirements.push(requirement);
        }
      }
    }
    return requirements;
  }

  function classifyRequirement(requirement, index) {
    var strengthFactor = STRENGTH_FACTOR[requirement.strength] || STRENGTH_FACTOR.neutral;
    if (requirement.yearsRequired !== null) {
      if (index.documentedYears >= requirement.yearsRequired) {
        return {
          term: requirement.term,
          label: "Strong match (documented professional tenure)",
          category: requirement.category,
          classification: "strong",
          evidenceType: "professional",
          evidence: ["Documented roles establish approximately " + index.documentedYears + " years of professional tenure."],
          strength: requirement.strength,
          strengthFactor: strengthFactor
        };
      }
      return {
        term: requirement.term,
        label: "Unverified (documented timeline does not fully establish this tenure threshold)",
        category: requirement.category,
        classification: "unverified",
        evidenceType: "unverified",
        evidence: ["Documented roles establish approximately " + index.documentedYears + " years of professional tenure."],
        strength: requirement.strength,
        strengthFactor: strengthFactor
      };
    }

    var aliasEntry = requirement.aliasEntry || resolveAlias(requirement.term, index);
    if (aliasEntry) {
      if (aliasEntry.hasProfessional) {
        return {
          term: aliasEntry.canonical,
          label: "Strong match (professional evidence)",
          category: aliasEntry.category || requirement.category,
          classification: "strong",
          evidenceType: "professional",
          evidence: aliasEntry.evidence.slice(),
          strength: requirement.strength,
          strengthFactor: strengthFactor
        };
      }
      if (aliasEntry.hasAcademic) {
        return {
          term: aliasEntry.canonical,
          label: "Partial match (academic evidence)",
          category: aliasEntry.category || requirement.category,
          classification: "partial",
          evidenceType: "academic",
          evidence: aliasEntry.evidence.slice(),
          strength: requirement.strength,
          strengthFactor: strengthFactor
        };
      }
      if (aliasEntry.hasUserProvided || aliasEntry.evidenceType === "user-provided") {
        return {
          term: aliasEntry.canonical,
          label: "Partial match (user-provided context)",
          category: aliasEntry.category || requirement.category,
          classification: "partial",
          evidenceType: "user-provided",
          evidence: aliasEntry.evidence.slice(),
          strength: requirement.strength,
          strengthFactor: strengthFactor
        };
      }
    }

    if (requirement.category === "educationCoursework" && index.hasRelevantDegree) {
      return {
        term: requirement.term,
        label: "Strong match (relevant computing degree)",
        category: requirement.category,
        classification: "strong",
        evidenceType: "academic",
        evidence: index.academicEvidence.slice(0, 2),
        strength: requirement.strength,
        strengthFactor: strengthFactor
      };
    }

    return {
      term: requirement.term,
      label: "Unverified (no direct evidence in the recruiter profile)",
      category: requirement.category,
      classification: "unverified",
      evidenceType: "unverified",
      evidence: [],
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
      score: roundScore(score),
      matchedRequirements: categoryClassifications.length,
      totalRequirements: categoryRequirements.length,
      matchedTerms: categoryClassifications.map(function (item) { return item.term; })
    };
  }

  function scoreSupportCategory(key, weight, technicalRequirements, classifications, index) {
    var totalWeight = 0;
    var matchedWeight = 0;
    for (var reqIndex = 0; reqIndex < technicalRequirements.length; reqIndex += 1) {
      totalWeight += STRENGTH_FACTOR[technicalRequirements[reqIndex].strength] || STRENGTH_FACTOR.neutral;
    }
    for (var classIndex = 0; classIndex < classifications.length; classIndex += 1) {
      var classification = classifications[classIndex];
      if (technicalRequirements.map(function (item) { return normalizeKey(item.term); }).indexOf(normalizeKey(classification.term)) === -1) continue;
      if (key === "professionalExperience" && classification.evidenceType === "professional" && classification.classification === "strong") {
        matchedWeight += classification.strengthFactor;
      }
      if (key === "educationCoursework" && index.hasRelevantDegree && (classification.classification === "strong" || classification.classification === "partial")) {
        matchedWeight += classification.strengthFactor;
      }
    }
    var score = totalWeight ? weight * (matchedWeight / totalWeight) : 0;
    return {
      key: key,
      label: CATEGORY_META[key].label,
      weight: weight,
      score: roundScore(score),
      matchedRequirements: totalWeight ? technicalRequirements.length : 0,
      totalRequirements: technicalRequirements.length,
      matchedTerms: technicalRequirements.map(function (item) { return item.term; })
    };
  }

  function buildConfidence(score, requirements, classifications) {
    var total = requirements.length;
    var strongCount = classifications.filter(function (item) { return item.classification === "strong"; }).length;
    var partialCount = classifications.filter(function (item) { return item.classification === "partial"; }).length;
    var unverifiedCount = classifications.filter(function (item) { return item.classification === "unverified"; }).length;
    var reasons = [];

    if (!strongCount) reasons.push("No direct evidence matched the requested stack.");
    if (partialCount) reasons.push(partialCount + " requirement(s) rely on transferable or academic evidence.");
    if (unverifiedCount) reasons.push(unverifiedCount + " requirement(s) remain unverified in the profile.");
    if (!reasons.length) reasons.push("Most requested requirements have direct supporting evidence.");

    var label = "high";
    if (!total || score < 25 || strongCount / total < 0.34) label = "low";
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
    for (var reqIndex = 0; reqIndex < requirements.length; reqIndex += 1) {
      classifications.push(classifyRequirement(requirements[reqIndex], index));
    }

    var technicalRequirements = requirements.filter(function (item) {
      return ["coreTechnologies", "architectureDeliveryCloud", "domainIntegrations", "mobile"].indexOf(item.category) !== -1;
    });

    var categoryScores = {};
    for (var catIndex = 0; catIndex < CATEGORY_ORDER.length; catIndex += 1) {
      var key = CATEGORY_ORDER[catIndex];
      if (key === "professionalExperience" && !requirements.some(function (item) { return item.category === key; })) {
        categoryScores[key] = scoreSupportCategory(key, CATEGORY_META[key].weight, technicalRequirements, classifications, index);
        continue;
      }
      if (key === "educationCoursework" && !requirements.some(function (item) { return item.category === key; })) {
        categoryScores[key] = scoreSupportCategory(key, CATEGORY_META[key].weight, technicalRequirements, classifications, index);
        continue;
      }
      categoryScores[key] = scoreCategory(requirements, classifications, key);
    }

    var strongMatches = mergeMatches([], classifications.filter(function (item) { return item.classification === "strong"; }));
    var partialMatches = mergeMatches([], classifications.filter(function (item) { return item.classification === "partial"; }));
    var gaps = mergeMatches([], classifications.filter(function (item) { return item.classification === "gap"; }));
    var unverified = mergeMatches([], classifications.filter(function (item) { return item.classification === "unverified"; }));

    var totalScore = 0;
    for (var scoreIndex = 0; scoreIndex < CATEGORY_ORDER.length; scoreIndex += 1) {
      totalScore += categoryScores[CATEGORY_ORDER[scoreIndex]].score;
    }
    totalScore = Math.round(clampScore(totalScore));

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
