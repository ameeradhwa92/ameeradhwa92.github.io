import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const repoRoot = path.resolve(import.meta.dirname, "..");
const extractorPath = path.join(repoRoot, "assets", "js", "jd-extractor.js");
const matcherPath = path.join(repoRoot, "assets", "js", "jd-matcher.js");
const profilePath = path.join(repoRoot, "assets", "data", "aimeer-profile.json");

function loadScript(filePath, context) {
  const source = fs.readFileSync(filePath, "utf8");
  vm.runInNewContext(source, context, { filename: filePath });
}

function createContext() {
  const context = {
    console,
    setTimeout,
    clearTimeout,
    URL,
    Promise
  };
  context.window = {
    location: { href: "https://ameer.example.test/" },
    document: {
      currentScript: { src: "https://ameer.example.test/assets/js/jd-matcher.js" }
    }
  };
  context.document = context.window.document;
  context.globalThis = context;
  return context;
}

function loadMatcherSuite() {
  const context = createContext();
  loadScript(extractorPath, context);
  loadScript(matcherPath, context);
  return {
    extractor: context.window.JDExtractor,
    matcher: context.window.JDMatcher,
    profile: JSON.parse(fs.readFileSync(profilePath, "utf8"))
  };
}

function scoreText(text) {
  const { extractor, matcher, profile } = loadMatcherSuite();
  const normalized = extractor.normalize(text);
  return matcher.scoreJobDescription(normalized, profile);
}

function categoryScore(result, key) {
  return result.categories[key] ? result.categories[key].score : undefined;
}

test("scores required modern .NET stack deterministically with explicit category weights", () => {
  const result = scoreText(`
    Required Skills
    ASP.NET Core
    React
    SQL Server
    Azure
  `);

  assert.equal(result.score, 80);
  assert.equal(categoryScore(result, "coreTechnologies"), 35);
  assert.equal(categoryScore(result, "professionalExperience"), 20);
  assert.equal(categoryScore(result, "architectureDeliveryCloud"), 15);
  assert.equal(categoryScore(result, "educationCoursework"), 10);
  assert.equal(categoryScore(result, "domainIntegrations"), 0);
  assert.ok(result.strongMatches.some((match) => match.term === "ASP.NET Core"));
  assert.ok(result.strongMatches.some((match) => match.term === "React"));
  assert.ok(result.strongMatches.some((match) => match.term === "SQL Server"));
  assert.ok(result.strongMatches.some((match) => match.term === "Azure"));
  assert.equal(result.partialMatches.length, 0);
});

test("required requirements outweigh preferred requirements", () => {
  const requiredFirst = scoreText(`
    Required Skills
    ASP.NET Core
    Preferred Skills
    COBOL
  `);
  const preferredFirst = scoreText(`
    Required Skills
    COBOL
    Preferred Skills
    ASP.NET Core
  `);

  assert.ok(requiredFirst.score > preferredFirst.score);
  assert.ok(requiredFirst.strongMatches.some((match) => match.term === "ASP.NET Core"));
  assert.ok(preferredFirst.strongMatches.some((match) => match.term === "ASP.NET Core"));
});

test("collapses aliases into one canonical skill match", () => {
  const result = scoreText(`
    Required Skills
    ASP.NET
    .NET
    ASP.NET Core
  `);
  const aspNetMatches = result.strongMatches.filter((match) => match.term === "ASP.NET Core");

  assert.equal(aspNetMatches.length, 1);
  assert.equal(categoryScore(result, "coreTechnologies"), 35);
});

test("labels academic-only evidence as partial instead of professional certainty", () => {
  const result = scoreText(`
    Required Skills
    Tesseract OCR
  `);

  assert.equal(result.strongMatches.some((match) => match.term === "Tesseract OCR"), false);
  assert.ok(result.partialMatches.some((match) => match.term === "Tesseract OCR"));
  assert.ok(result.partialMatches.some((match) => /academic/i.test(match.label)));
  assert.ok(result.partialMatches.every((match) => match.evidenceType === "academic"));
});

test("returns an explainable low-confidence result for mostly unknown job descriptions", () => {
  const result = scoreText(`
    Required Skills
    COBOL
    Mainframe
    Hadoop
    Kubernetes
  `);

  assert.ok(result.score <= 10);
  assert.equal(result.confidence.label, "low");
  assert.ok(result.confidence.reasons.some((reason) => /direct evidence/i.test(reason)));
  assert.ok(result.unverified.length >= 3);
  assert.ok(result.interviewTopics.length >= 2);
});

test("does not surface salary details from recruiter prompts", () => {
  const result = scoreText(`
    Required Skills
    ASP.NET Core

    Responsibilities
    Please include your salary expectations and current compensation.
  `);
  const gapLabels = result.gaps.map((item) => item.label).join(" | ");
  const strongTerms = result.strongMatches.map((item) => item.term).join(" | ");
  const partialTerms = result.partialMatches.map((item) => item.term).join(" | ");
  const unverifiedTerms = result.unverified.map((item) => item.term).join(" | ");

  assert.match(strongTerms, /ASP\.NET Core/);
  assert.equal(/salary/i.test(gapLabels), false);
  assert.equal(/salary/i.test(partialTerms), false);
  assert.equal(/salary/i.test(unverifiedTerms), false);
  assert.equal(/salary/i.test(JSON.stringify(result.evidence.professional || [])), false);
  assert.ok((result.evidence.privacyExclusions || []).includes("salary"));
});
