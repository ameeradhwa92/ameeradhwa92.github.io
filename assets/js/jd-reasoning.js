(function (global) {
  "use strict";

  var JD_TEXT_MAX = 12000;
  var RESULT_CHARS_MAX = 12000;
  /* Stands in for the JD prose when the screen below refuses it.  Must stay non-empty (the
     Worker rejects a blank jdText) and must not itself trip the screen. */
  var JD_TEXT_WITHHELD_NOTICE = "Job description prose withheld: it carried personal identifiers. Score from the structured requirements only.";
  var DEFAULT_PRIVACY_EXCLUSIONS = [
    "salary",
    "nric",
    "home address",
    "date of birth",
    "benefits",
    "leave",
    "medical",
    "signatures",
    "confidential contract language"
  ];
  /* Terms from the exclusion list that describe the EMPLOYER's offer when they appear in a
     job description, not private data about anyone.  A bare substring match on them would
     reject nearly every real posting ("competitive salary", "medical insurance", "annual
     leave"), so this screen skips them.  jd-matcher.js still drops requirement lines that
     contain them, so they never become scored requirements. */
  var EMPLOYER_BOILERPLATE_TERMS = {
    salary: true,
    benefits: true,
    leave: true,
    medical: true
  };
  /* A pasted document can carry a THIRD PARTY's personal identifiers — someone else's
     NRIC, home address or date of birth.  Forwarding those to the cloud model would leak
     data that is not ours to share, so this group still blocks.  Keep it identical to
     cloud/aimeer-worker.js: the browser and the Worker are separate deployment targets
     that cannot share code, and the same JD must be accepted or refused by both. */
  var PERSONAL_IDENTIFIER_PATTERNS = [
    /\bnric\b/i,
    /\bmy[- ]?kad\b/i,
    /\b(?:ic|i\/c)\s*(?:no\.?|number)\b/i,
    /\b\d{6}-\d{2}-\d{4}\b/,
    /\bhome\s+address\b/i,
    /\bdate\s+of\s+birth\b/i,
    /\bpassport\s*(?:no\.?|number)\b/i,
    /\bbank\s+account\s*(?:no\.?|number)\b/i,
    /\bsignatures?\b/i
  ];
  var ROOT_KEYS = ["narrative", "requirements", "overall"];
  var REQUIREMENT_KEYS = [
    "requirementId",
    "recruiterIntent",
    "expectedOutcome",
    "matchLevel",
    "evidenceRefs",
    "transferableCapabilities",
    "limitation",
    "recruiterFraming",
    "verificationQuestion",
    "confidence"
  ];
  var FIELD_LIMITS = {
    narrative: 900,
    recruiterIntent: 320,
    expectedOutcome: 320,
    limitation: 320,
    recruiterFraming: 320,
    verificationQuestion: 320
  };
  var MAX_EVIDENCE_REFS = 4;
  var MAX_CAPABILITIES = 4;
  var MATCH_LEVEL_FACTORS = {
    "direct-professional": 1,
    "adjacent-professional": 0.75,
    "transferable-professional": 0.55,
    "academic-foundation": 0.3,
    "learning-bridge": 0.15,
    "explicit-gap": 0,
    "unverified": 0
  };
  var EVIDENCE_BASED_MATCH_LEVELS = {
    "direct-professional": true,
    "adjacent-professional": true,
    "transferable-professional": true,
    "academic-foundation": true
  };
  var MATCH_LEVEL_EVIDENCE_TYPES = {
    "direct-professional": { professional: true },
    "adjacent-professional": { professional: true },
    "transferable-professional": { professional: true },
    "academic-foundation": { academic: true },
    "learning-bridge": { professional: true, academic: true }
  };
  var CONFIDENCE_LEVELS = {
    low: true,
    medium: true,
    high: true
  };
  var STRENGTH_FACTORS = {
    required: 1,
    neutral: 0.75,
    preferred: 0.5
  };
  var DETERMINISTIC_FACTORS = {
    strong: 1,
    partial: 0.5,
    gap: 0,
    unverified: 0
  };
  var HTML_MARKUP_PATTERN = /<\s*\/?\s*[a-z][^>]*>|<!--[\s\S]*?-->|<!--|-->/i;

  function clipText(value, maxChars) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
  }

  function roundScore(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function clampScore(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  var FIT_BANDS = ["strong", "good", "partial", "limited"];

  function computeFitBand(score) {
    var value = clampScore(score);
    if (value >= 75) return "strong";
    if (value >= 60) return "good";
    if (value >= 40) return "partial";
    return "limited";
  }

  function isPlainObject(value) {
    return !!value && Object.prototype.toString.call(value) === "[object Object]";
  }

  function uniqueStrings(values, maxItems, maxChars) {
    var list = Array.isArray(values) ? values : [];
    var seen = Object.create(null);
    var output = [];
    for (var index = 0; index < list.length; index += 1) {
      var value = clipText(list[index], maxChars);
      if (!value || seen[value]) continue;
      seen[value] = true;
      output.push(value);
      if (output.length >= maxItems) break;
    }
    return output;
  }

  function containsPrivacyTerms(text, privacyTerms) {
    var haystack = String(text || "").toLowerCase();
    for (var index = 0; index < privacyTerms.length; index += 1) {
      var term = String(privacyTerms[index] || "").toLowerCase().trim();
      if (!term || EMPLOYER_BOILERPLATE_TERMS[term]) continue;
      var escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp("(^|[^a-z0-9])" + escapedTerm + "(?=$|[^a-z0-9])", "i").test(haystack)) {
        return true;
      }
    }
    return PERSONAL_IDENTIFIER_PATTERNS.some(function (pattern) {
      return pattern.test(haystack);
    });
  }

  function getPrivacyTerms(profile) {
    var terms = uniqueStrings(
      profile && profile.privacyExclusions,
      DEFAULT_PRIVACY_EXCLUSIONS.length,
      64
    ).map(function (term) {
      return String(term || "").toLowerCase();
    });
    return terms.length ? terms : DEFAULT_PRIVACY_EXCLUSIONS.slice();
  }

  function compactRequirement(requirement) {
    return {
      id: clipText(requirement && requirement.id, 96),
      term: clipText(requirement && requirement.term, 120),
      original: clipText(requirement && requirement.original, 240),
      strength: clipText(requirement && requirement.strength, 16),
      category: clipText(requirement && requirement.category, 48),
      yearsRequired: Number.isFinite(requirement && requirement.yearsRequired) ? requirement.yearsRequired : null,
      specificHandsOn: !!(requirement && requirement.specificHandsOn),
      classification: clipText(requirement && requirement.classification, 24),
      evidenceType: clipText(requirement && requirement.evidenceType, 24),
      evidenceRefs: uniqueStrings(requirement && requirement.evidenceRefs, MAX_EVIDENCE_REFS, 96)
    };
  }

  function compactCategory(category) {
    if (!isPlainObject(category)) return null;
    return {
      score: clampScore(category.score),
      weight: clampScore(category.weight),
      active: !!category.active,
      key: clipText(category.key, 48),
      label: clipText(category.label, 120),
      matchedRequirements: Math.max(0, Number(category.matchedRequirements) || 0),
      totalRequirements: Math.max(0, Number(category.totalRequirements) || 0)
    };
  }

  function compactMatchList(items) {
    return (Array.isArray(items) ? items : []).slice(0, 8).map(function (item) {
      return {
        term: clipText(item && item.term, 120),
        label: clipText(item && item.label, 220),
        evidenceType: clipText(item && item.evidenceType, 24),
        evidenceRefs: uniqueStrings(item && item.evidenceRefs, MAX_EVIDENCE_REFS, 96)
      };
    });
  }

  function compactDeterministicResult(result) {
    var sourceCategories = result && result.categories && typeof result.categories === "object"
      ? result.categories
      : {};
    var categories = {};
    Object.keys(sourceCategories).forEach(function (key) {
      var compact = compactCategory(sourceCategories[key]);
      if (compact) categories[key] = compact;
    });

    var compact = {
      score: clampScore(result && result.score),
      deterministicScore: clampScore(result && (result.deterministicScore !== undefined ? result.deterministicScore : result.score)),
      confidence: {
        label: clipText(result && result.confidence && result.confidence.label, 16),
        reasons: uniqueStrings(result && result.confidence && result.confidence.reasons, 3, 180)
      },
      categories: categories,
      strongMatches: compactMatchList(result && result.strongMatches),
      partialMatches: compactMatchList(result && result.partialMatches),
      gaps: compactMatchList(result && result.gaps),
      unverified: compactMatchList(result && result.unverified)
    };

    while (JSON.stringify(compact).length > RESULT_CHARS_MAX) {
      if (compact.unverified.length) compact.unverified.pop();
      else if (compact.gaps.length) compact.gaps.pop();
      else if (compact.partialMatches.length) compact.partialMatches.pop();
      else if (compact.strongMatches.length) compact.strongMatches.pop();
      else if (compact.confidence.reasons.length) compact.confidence.reasons.pop();
      else break;
    }
    return compact;
  }

  function compactEvidenceRecord(record) {
    if (!isPlainObject(record)) return null;
    return {
      id: clipText(record.id, 96),
      evidenceType: clipText(record.evidenceType, 24),
      claim: clipText(record.claim, 260),
      technologies: uniqueStrings(record.technologies, 8, 120),
      capabilities: uniqueStrings(record.capabilities, 8, 120),
      scope: uniqueStrings(record.scope, 6, 120),
      sourceLabel: clipText(record.sourceLabel, 80)
    };
  }

  function buildCapabilityVocabulary(evidenceRegistry) {
    var seen = Object.create(null);
    var vocabulary = [];
    for (var index = 0; index < evidenceRegistry.length; index += 1) {
      var record = evidenceRegistry[index];
      var capabilities = Array.isArray(record && record.capabilities) ? record.capabilities : [];
      for (var capabilityIndex = 0; capabilityIndex < capabilities.length; capabilityIndex += 1) {
        var capability = clipText(capabilities[capabilityIndex], 120);
        if (!capability || seen[capability]) continue;
        seen[capability] = true;
        vocabulary.push(capability);
      }
    }
    return vocabulary.sort();
  }

  function areEvidenceTypesCompatible(matchLevel, evidenceRecords) {
    var allowedTypes = MATCH_LEVEL_EVIDENCE_TYPES[matchLevel];
    if (!allowedTypes || !evidenceRecords.length) return true;
    for (var index = 0; index < evidenceRecords.length; index += 1) {
      if (!evidenceRecords[index] || !allowedTypes[evidenceRecords[index].evidenceType]) return false;
    }
    return true;
  }

  /* The model reads the recruiter's own prose, not a keyword digest — judging whether
     adjacent experience actually covers a role needs the posting's wording, seniority
     framing and responsibilities.  Employer boilerplate about pay, benefits and leave is
     expected here and no longer withheld.  A document carrying a third party's personal
     identifiers is different: that prose is withheld outright rather than forwarded, and
     the Worker screens the same text again server-side. */
  function buildScreenedJdText(normalizedJd, privacyTerms) {
    var source = normalizedJd && typeof normalizedJd === "object"
      ? (normalizedJd.normalizedText || normalizedJd.rawText)
      : normalizedJd;
    var text = clipText(source, JD_TEXT_MAX);
    if (!text || containsPrivacyTerms(text, privacyTerms)) {
      return JD_TEXT_WITHHELD_NOTICE;
    }
    return text;
  }

  function buildInput(normalizedJd, deterministicResult, profile, language) {
    var requirements = (Array.isArray(deterministicResult && deterministicResult.requirements)
      ? deterministicResult.requirements : []).map(compactRequirement);
    var privacyTerms = getPrivacyTerms(profile);
    var referencedIds = Object.create(null);
    for (var requirementIndex = 0; requirementIndex < requirements.length; requirementIndex += 1) {
      var refs = requirements[requirementIndex].evidenceRefs;
      for (var refIndex = 0; refIndex < refs.length; refIndex += 1) {
        referencedIds[refs[refIndex]] = true;
      }
    }

    var registryById = Object.create(null);
    var recruiterEvidence = Array.isArray(profile && profile.recruiterEvidence) ? profile.recruiterEvidence : [];
    for (var recordIndex = 0; recordIndex < recruiterEvidence.length; recordIndex += 1) {
      var record = compactEvidenceRecord(recruiterEvidence[recordIndex]);
      if (record && record.id) registryById[record.id] = record;
    }

    var evidenceRegistry = Object.keys(referencedIds).sort().map(function (id) {
      return registryById[id];
    }).filter(Boolean);

    return {
      mode: "jd-reasoning",
      language: language === "ms" ? "ms" : "en",
      jdText: buildScreenedJdText(normalizedJd, privacyTerms),
      requirements: requirements,
      deterministicResult: compactDeterministicResult(deterministicResult || {}),
      evidenceRegistry: evidenceRegistry,
      capabilityVocabulary: buildCapabilityVocabulary(evidenceRegistry)
    };
  }

  function stripJsonFence(rawOutput) {
    var text = String(rawOutput || "").trim();
    var fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1].trim() : text;
  }

  function reject(error) {
    return { ok: false, error: error };
  }

  function ensureOnlyKeys(target, allowedKeys, contextLabel) {
    var keys = Object.keys(target || {});
    for (var index = 0; index < keys.length; index += 1) {
      var key = keys[index];
      if (allowedKeys.indexOf(key) === -1) {
        if (/score/i.test(key)) {
          return "Model-supplied score fields are not allowed in " + contextLabel + ".";
        }
        return "Unknown key " + key + " in " + contextLabel + ".";
      }
    }
    return "";
  }

  function validateTextField(value, key) {
    var maxChars = FIELD_LIMITS[key] || 320;
    if (typeof value !== "string") return key + " must be a string.";
    if (HTML_MARKUP_PATTERN.test(value)) return key + " must not contain HTML or markup.";
    var clipped = clipText(value, maxChars);
    if (!clipped) return key + " must be present.";
    if (String(value).replace(/\s+/g, " ").trim().length > maxChars) {
      return key + " exceeds the allowed length.";
    }
    return "";
  }

  function validateModelOutput(rawOutput, input) {
    var parsed;
    try {
      parsed = JSON.parse(stripJsonFence(rawOutput));
    } catch (error) {
      return reject("Invalid reasoning JSON: " + error.message);
    }

    if (!isPlainObject(parsed)) return reject("Reasoning output must be a JSON object.");
    var rootKeyError = ensureOnlyKeys(parsed, ROOT_KEYS, "reasoning root");
    if (rootKeyError) return reject(rootKeyError);

    var narrativeError = validateTextField(parsed.narrative, "narrative");
    if (narrativeError) return reject(narrativeError);
    if (!Array.isArray(parsed.requirements)) return reject("requirements must be an array.");
    if (parsed.requirements.length !== (Array.isArray(input && input.requirements) ? input.requirements.length : 0)) {
      return reject("Every deterministic requirement must be included exactly once.");
    }

    var overall = parsed.overall;
    if (!isPlainObject(overall)) return reject("overall-missing");
    var overallKeyError = ensureOnlyKeys(overall, ["score", "fitBand", "narrative"], "overall");
    if (overallKeyError) return reject(overallKeyError);
    if (typeof overall.score !== "number" || !Number.isFinite(overall.score) ||
        overall.score < 0 || overall.score > 100) return reject("overall-score-invalid");
    if (FIT_BANDS.indexOf(overall.fitBand) === -1) return reject("overall-fitband-invalid");
    if (typeof overall.narrative !== "string" || !overall.narrative.trim() ||
        overall.narrative.length > FIELD_LIMITS.narrative) return reject("overall-narrative-invalid");

    var inputRequirements = Array.isArray(input && input.requirements) ? input.requirements : [];
    var requirementIndex = Object.create(null);
    for (var index = 0; index < inputRequirements.length; index += 1) {
      requirementIndex[inputRequirements[index].id] = inputRequirements[index];
    }

    var evidenceIndex = Object.create(null);
    var evidenceRegistry = Array.isArray(input && input.evidenceRegistry) ? input.evidenceRegistry : [];
    for (var evidenceRecordIndex = 0; evidenceRecordIndex < evidenceRegistry.length; evidenceRecordIndex += 1) {
      evidenceIndex[evidenceRegistry[evidenceRecordIndex].id] = evidenceRegistry[evidenceRecordIndex];
    }

    var capabilitySet = Object.create(null);
    var capabilityVocabulary = Array.isArray(input && input.capabilityVocabulary) ? input.capabilityVocabulary : [];
    for (var capabilityIndex = 0; capabilityIndex < capabilityVocabulary.length; capabilityIndex += 1) {
      capabilitySet[capabilityVocabulary[capabilityIndex]] = true;
    }

    var seenRequirementIds = Object.create(null);
    var sanitizedRequirements = [];
    for (var requirementOutputIndex = 0; requirementOutputIndex < parsed.requirements.length; requirementOutputIndex += 1) {
      var item = parsed.requirements[requirementOutputIndex];
      if (!isPlainObject(item)) return reject("Each reasoning requirement must be an object.");
      var requirementKeyError = ensureOnlyKeys(item, REQUIREMENT_KEYS, "reasoning requirement");
      if (requirementKeyError) return reject(requirementKeyError);

      var requirementId = clipText(item.requirementId, 96);
      if (!requirementIndex[requirementId]) {
        return reject("Unknown requirement id: " + requirementId + ".");
      }
      if (seenRequirementIds[requirementId]) {
        return reject("Duplicate requirement id: " + requirementId + ".");
      }
      seenRequirementIds[requirementId] = true;

      var matchLevel = clipText(item.matchLevel, 32);
      if (!MATCH_LEVEL_FACTORS.hasOwnProperty(matchLevel)) {
        return reject("Invalid match level: " + matchLevel + ".");
      }

      var confidence = clipText(item.confidence, 16);
      if (!CONFIDENCE_LEVELS[confidence]) {
        return reject("Invalid confidence level: " + confidence + ".");
      }

      var recruiterIntentError = validateTextField(item.recruiterIntent, "recruiterIntent");
      if (recruiterIntentError) return reject(recruiterIntentError);
      var expectedOutcomeError = validateTextField(item.expectedOutcome, "expectedOutcome");
      if (expectedOutcomeError) return reject(expectedOutcomeError);
      var limitationError = validateTextField(item.limitation, "limitation");
      if (limitationError) return reject(limitationError);
      var recruiterFramingError = validateTextField(item.recruiterFraming, "recruiterFraming");
      if (recruiterFramingError) return reject(recruiterFramingError);
      var verificationQuestionError = validateTextField(item.verificationQuestion, "verificationQuestion");
      if (verificationQuestionError) return reject(verificationQuestionError);

      if (!Array.isArray(item.evidenceRefs)) return reject("evidenceRefs must be an array.");
      var evidenceRefs = uniqueStrings(item.evidenceRefs, MAX_EVIDENCE_REFS, 96);
      if (item.evidenceRefs.length > MAX_EVIDENCE_REFS || evidenceRefs.length !== item.evidenceRefs.length) {
        return reject("evidenceRefs must be unique and within the allowed size.");
      }
      for (var refIndex = 0; refIndex < evidenceRefs.length; refIndex += 1) {
        if (!evidenceIndex[evidenceRefs[refIndex]]) {
          return reject("Unknown evidence ref: " + evidenceRefs[refIndex] + ".");
        }
      }
      if (EVIDENCE_BASED_MATCH_LEVELS[matchLevel] && !evidenceRefs.length) {
        return reject("Evidence-based conclusions must include evidence refs.");
      }
      var evidenceRecords = evidenceRefs.map(function (evidenceRef) {
        return evidenceIndex[evidenceRef];
      });
      if (!areEvidenceTypesCompatible(matchLevel, evidenceRecords)) {
        return reject("Evidence refs are not compatible with the match level.");
      }

      if (!Array.isArray(item.transferableCapabilities)) return reject("transferableCapabilities must be an array.");
      var transferableCapabilities = uniqueStrings(item.transferableCapabilities, MAX_CAPABILITIES, 120);
      if (item.transferableCapabilities.length > MAX_CAPABILITIES || transferableCapabilities.length !== item.transferableCapabilities.length) {
        return reject("transferableCapabilities must be unique and within the allowed size.");
      }
      for (var transferableIndex = 0; transferableIndex < transferableCapabilities.length; transferableIndex += 1) {
        if (HTML_MARKUP_PATTERN.test(transferableCapabilities[transferableIndex])) {
          return reject("transferableCapabilities must not contain HTML or markup.");
        }
        if (!capabilitySet[transferableCapabilities[transferableIndex]]) {
          return reject("Unsupported capability name: " + transferableCapabilities[transferableIndex] + ".");
        }
      }

      sanitizedRequirements.push({
        requirementId: requirementId,
        recruiterIntent: clipText(item.recruiterIntent, FIELD_LIMITS.recruiterIntent),
        expectedOutcome: clipText(item.expectedOutcome, FIELD_LIMITS.expectedOutcome),
        matchLevel: matchLevel,
        evidenceRefs: evidenceRefs,
        transferableCapabilities: transferableCapabilities,
        limitation: clipText(item.limitation, FIELD_LIMITS.limitation),
        recruiterFraming: clipText(item.recruiterFraming, FIELD_LIMITS.recruiterFraming),
        verificationQuestion: clipText(item.verificationQuestion, FIELD_LIMITS.verificationQuestion),
        confidence: confidence
      });
    }

    return {
      ok: true,
      reasoning: {
        narrative: clipText(parsed.narrative, FIELD_LIMITS.narrative),
        requirements: sanitizedRequirements,
        overall: {
          score: clampScore(overall.score),
          fitBand: overall.fitBand,
          narrative: clipText(overall.narrative, FIELD_LIMITS.narrative)
        }
      }
    };
  }

  function baseFactorForRequirement(requirement) {
    return DETERMINISTIC_FACTORS[requirement && requirement.classification] || 0;
  }

  function verifiedFactorForRequirement(requirement) {
    if (!requirement) return 0;
    if (requirement.classification !== "strong") return 0;
    if (requirement.evidenceType === "professional") return 1;
    if (requirement.category === "educationCoursework" && requirement.evidenceType === "academic") return 1;
    return 0;
  }

  function effectiveFactorForRequirement(requirement, reasoningItem, evidenceRecords) {
    var baseFactor = baseFactorForRequirement(requirement);
    if (!reasoningItem) return baseFactor;
    if (requirement.classification === "strong" || requirement.classification === "gap") return baseFactor;
    if (requirement.specificHandsOn && requirement.yearsRequired !== null) return baseFactor;

    var factor = MATCH_LEVEL_FACTORS[reasoningItem.matchLevel];
    if (!Number.isFinite(factor)) return baseFactor;
    if (!reasoningItem.evidenceRefs.length) return baseFactor;
    if (!evidenceRecords || evidenceRecords.length !== reasoningItem.evidenceRefs.length) return baseFactor;
    if (!areEvidenceTypesCompatible(reasoningItem.matchLevel, evidenceRecords || [])) return baseFactor;
    return Math.max(baseFactor, factor);
  }

  function resolveEvidenceRecords(evidenceRefs, evidenceIndex) {
    var records = [];
    for (var index = 0; index < evidenceRefs.length; index += 1) {
      var record = evidenceIndex[evidenceRefs[index]];
      if (record) records.push(record);
    }
    return records;
  }

  function scoreByFactor(requirements, categories, factorResolver) {
    var categoryTotals = Object.create(null);
    var categoryMatched = Object.create(null);
    var categoryWeights = Object.create(null);
    var activeWeight = 0;
    var weightedScore = 0;

    Object.keys(categories || {}).forEach(function (key) {
      categoryWeights[key] = clampScore(categories[key] && categories[key].weight);
    });

    for (var index = 0; index < requirements.length; index += 1) {
      var requirement = requirements[index];
      var category = requirement.category;
      var strengthFactor = STRENGTH_FACTORS[requirement.strength] || STRENGTH_FACTORS.neutral;
      categoryTotals[category] = (categoryTotals[category] || 0) + strengthFactor;
      categoryMatched[category] = (categoryMatched[category] || 0) + (factorResolver(requirement) * strengthFactor);
    }

    Object.keys(categoryTotals).forEach(function (category) {
      var total = categoryTotals[category];
      if (!total) return;
      var weight = categoryWeights[category] || 0;
      var score = weight * ((categoryMatched[category] || 0) / total);
      weightedScore += score;
      activeWeight += weight;
    });

    return activeWeight ? Math.round(clampScore((weightedScore / activeWeight) * 100)) : 0;
  }

  function buildSections(entries) {
    return {
      verifiedStrengths: entries.filter(function (entry) { return entry.verified; }),
      transferableAdvantages: entries.filter(function (entry) { return entry.lifted; }),
      learningBridges: entries.filter(function (entry) { return entry.matchLevel === "learning-bridge"; }),
      explicitGaps: entries.filter(function (entry) {
        return entry.matchLevel === "explicit-gap" || entry.classification === "gap";
      }),
      unverifiedRequirements: entries.filter(function (entry) {
        return entry.matchLevel === "unverified" || entry.classification === "unverified";
      }),
      limitations: entries.filter(function (entry) { return !!entry.limitation; }).map(function (entry) {
        return {
          requirementId: entry.requirementId,
          term: entry.term,
          limitation: entry.limitation
        };
      }),
      interviewQuestions: entries.map(function (entry) {
        return {
          requirementId: entry.requirementId,
          term: entry.term,
          question: entry.verificationQuestion
        };
      })
    };
  }

  function mergeResult(deterministicResult, reasoning, input) {
    var result = isPlainObject(deterministicResult) ? JSON.parse(JSON.stringify(deterministicResult)) : {};
    var inputRequirements = Array.isArray(input && input.requirements) ? input.requirements : [];
    var reasoningMap = Object.create(null);
    for (var index = 0; index < reasoning.requirements.length; index += 1) {
      reasoningMap[reasoning.requirements[index].requirementId] = reasoning.requirements[index];
    }

    var evidenceIndex = Object.create(null);
    var evidenceRegistry = Array.isArray(input && input.evidenceRegistry) ? input.evidenceRegistry : [];
    for (var evidenceIndexPosition = 0; evidenceIndexPosition < evidenceRegistry.length; evidenceIndexPosition += 1) {
      evidenceIndex[evidenceRegistry[evidenceIndexPosition].id] = evidenceRegistry[evidenceIndexPosition];
    }

    var requirementReasoning = [];
    for (var requirementIndex = 0; requirementIndex < inputRequirements.length; requirementIndex += 1) {
      var requirement = inputRequirements[requirementIndex];
      var reasoningItem = reasoningMap[requirement.id];
      var evidenceRecords = reasoningItem ? resolveEvidenceRecords(reasoningItem.evidenceRefs, evidenceIndex) : [];
      var baseFactor = baseFactorForRequirement(requirement);
      var effectiveFactor = effectiveFactorForRequirement(requirement, reasoningItem, evidenceRecords);
      requirementReasoning.push({
        requirementId: requirement.id,
        term: requirement.term,
        strength: requirement.strength,
        category: requirement.category,
        classification: requirement.classification,
        yearsRequired: requirement.yearsRequired,
        specificHandsOn: requirement.specificHandsOn,
        matchLevel: reasoningItem ? reasoningItem.matchLevel : (requirement.classification === "strong" ? "direct-professional" : requirement.classification === "gap" ? "explicit-gap" : "unverified"),
        recruiterIntent: reasoningItem ? reasoningItem.recruiterIntent : "",
        expectedOutcome: reasoningItem ? reasoningItem.expectedOutcome : "",
        evidenceRefs: reasoningItem ? reasoningItem.evidenceRefs.slice() : [],
        evidenceRecords: evidenceRecords,
        transferableCapabilities: reasoningItem ? reasoningItem.transferableCapabilities.slice() : [],
        limitation: reasoningItem ? reasoningItem.limitation : "",
        recruiterFraming: reasoningItem ? reasoningItem.recruiterFraming : "",
        verificationQuestion: reasoningItem ? reasoningItem.verificationQuestion : "",
        confidence: reasoningItem ? reasoningItem.confidence : "medium",
        verified: verifiedFactorForRequirement(requirement) > 0,
        baseFactor: baseFactor,
        effectiveFactor: effectiveFactor,
        lifted: effectiveFactor > baseFactor
      });
    }

    var categories = result.categories && typeof result.categories === "object" ? result.categories : {};
    var verifiedScore = scoreByFactor(inputRequirements, categories, verifiedFactorForRequirement);
    var transferableScore = scoreByFactor(inputRequirements, categories, function (requirement) {
      var entry = requirementReasoning.find(function (item) { return item.requirementId === requirement.id; });
      return entry ? entry.effectiveFactor : baseFactorForRequirement(requirement);
    });
    var deterministicScore = clampScore(result.deterministicScore !== undefined ? result.deterministicScore : result.score);
    var aiScore = clampScore(reasoning && reasoning.overall ? reasoning.overall.score : deterministicScore);
    var bandMin = Math.max(0, deterministicScore - 10);
    var bandMax = Math.min(100, deterministicScore + 35);
    var finalScore = Math.round(Math.min(bandMax, Math.max(bandMin, aiScore)));

    result.deterministicScore = deterministicScore;
    result.aiScore = Math.round(aiScore);
    result.finalScore = finalScore;
    result.adjusted = Math.round(aiScore) !== finalScore;
    result.fitBand = computeFitBand(finalScore);
    /* keep legacy fields so the existing renderer and Worker explanation contract stay valid */
    result.verifiedScore = verifiedScore;
    result.transferableScore = transferableScore;
    result.compositeScore = finalScore;
    result.requirementReasoning = requirementReasoning;
    result.reasoningNarrative = reasoning && reasoning.overall && reasoning.overall.narrative
      ? clipText(reasoning.overall.narrative, FIELD_LIMITS.narrative)
      : clipText(reasoning && reasoning.narrative, FIELD_LIMITS.narrative);
    result.sections = buildSections(requirementReasoning);
    return result;
  }

  function fallback(deterministicResult, input, language) {
    var lang = language === "ms" ? "ms" : "en";
    var result = isPlainObject(deterministicResult) ? deterministicResult : {};
    var strengths = (Array.isArray(result.strongMatches) ? result.strongMatches : []).slice(0, 6).map(function (item) {
      return {
        term: clipText(item && item.term, 120),
        note: clipText(item && item.label, 220)
      };
    });
    var gaps = (Array.isArray(result.gaps) ? result.gaps : []).slice(0, 6).map(function (item) {
      return {
        term: clipText(item && item.term, 120),
        note: clipText(item && item.label, 220)
      };
    });
    var limitations = []
      .concat((Array.isArray(result.partialMatches) ? result.partialMatches : []).slice(0, 6).map(function (item) {
        return {
          term: clipText(item && item.term, 120),
          note: lang === "ms"
            ? "Padanan ini kekal separa dan perlu disahkan semasa saringan."
            : "This remains a partial match and should be validated during screening."
        };
      }))
      .concat((Array.isArray(result.unverified) ? result.unverified : []).slice(0, 6).map(function (item) {
        return {
          term: clipText(item && item.term, 120),
          note: lang === "ms"
            ? "Tiada bukti terbitan yang mengesahkan keperluan ini setakat ini."
            : "No published evidence verifies this requirement yet."
        };
      }));
    var interviewQuestions = (Array.isArray(result.interviewTopics) ? result.interviewTopics : []).slice(0, 6).map(function (item) {
      return {
        term: clipText(item && item.term, 120),
        question: clipText(item && item.prompt, 220)
      };
    });

    return {
      mode: "deterministic-fallback",
      language: lang,
      deterministicScore: clampScore(result.deterministicScore !== undefined ? result.deterministicScore : result.score),
      narrative: lang === "ms"
        ? "Ringkasan deterministik digunakan. Kekuatan yang disahkan, jurang yang nyata, dan soalan saringan kekal dipaparkan tanpa penaakulan AI."
        : "Deterministic fallback is active. Verified strengths, explicit gaps, and recruiter screening questions remain available without AI reasoning.",
      sections: {
        strengths: strengths,
        gaps: gaps,
        limitations: limitations,
        interviewQuestions: interviewQuestions
      },
      inputLanguage: input && input.language ? input.language : lang
    };
  }

  global.JDReasoning = {
    buildInput: buildInput,
    validateModelOutput: validateModelOutput,
    mergeResult: mergeResult,
    fallback: fallback,
    computeFitBand: computeFitBand
  };
}(typeof window !== "undefined" ? window : globalThis));
