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

test("scores required modern .NET stack against active JD categories", () => {
  const result = scoreText(`
    Required Skills
    ASP.NET Core
    React
    SQL Server
    Azure
  `);

  assert.equal(result.score, 100);
  assert.equal(categoryScore(result, "coreTechnologies"), 35);
  assert.equal(categoryScore(result, "professionalExperience"), 0);
  assert.equal(categoryScore(result, "architectureDeliveryCloud"), 15);
  assert.equal(categoryScore(result, "educationCoursework"), 0);
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

test("keeps Azure SQL as the only strong match when Azure is just a nested alias inside the same requirement", () => {
  const result = scoreText(`
    Required Skills
    Azure SQL
  `);
  const strongTerms = Array.from(result.strongMatches, (match) => match.term);

  assert.deepEqual(strongTerms, ["Azure SQL"]);
  assert.equal(result.strongMatches.some((match) => match.term === "Azure"), false);
  assert.equal(categoryScore(result, "architectureDeliveryCloud"), 15);
});

test("keeps React Query as the only strong match when React is just a nested alias inside the same requirement", () => {
  const result = scoreText(`
    Required Skills
    React Query
  `);
  const strongTerms = Array.from(result.strongMatches, (match) => match.term);

  assert.deepEqual(strongTerms, ["React Query"]);
  assert.equal(result.strongMatches.some((match) => match.term === "React"), false);
  assert.equal(categoryScore(result, "coreTechnologies"), 35);
});

test("preserves separate strong matches for unrelated technologies while dropping nested umbrella aliases", () => {
  const result = scoreText(`
    Required Skills
    Azure SQL and React Query
  `);
  const strongTerms = Array.from(result.strongMatches, (match) => match.term);

  assert.deepEqual(strongTerms, ["Azure SQL", "React Query"]);
  assert.equal(result.strongMatches.some((match) => match.term === "Azure"), false);
  assert.equal(result.strongMatches.some((match) => match.term === "React"), false);
  assert.equal(categoryScore(result, "coreTechnologies"), 35);
  assert.equal(categoryScore(result, "architectureDeliveryCloud"), 15);
});

test("labels academic-only evidence as partial instead of professional certainty", () => {
  const result = scoreText(`
    Required Skills
    Tesseract OCR
  `);

  assert.equal(result.strongMatches.some((match) => match.term === "Tesseract OCR"), false);
  assert.ok(result.partialMatches.some((match) => match.term === "Tesseract OCR"));
  assert.ok(result.partialMatches.some((match) => /academic exposure/i.test(match.label)));
  assert.ok(result.partialMatches.every((match) => match.evidenceType === "academic"));
});

test("uses a real gaps bucket for explicitly unmet profile-addressable requirements while preserving unverified unknowns", () => {
  const result = scoreText(`
    Required Skills
    5+ years building APIs
    COBOL
  `);

  assert.ok(result.strongMatches.some((match) => match.term === "5+ years"));
  assert.equal(result.gaps.some((match) => match.term === "5+ years"), false);
  assert.ok(result.unverified.some((match) => /cobol/i.test(match.term)));
  assert.equal(result.gaps.some((match) => match.term === "Cobol"), false);
});

test("prefers professional evidence for mixed-source skills such as PHP and Android", () => {
  const phpResult = scoreText(`
    Required Skills
    PHP
  `);
  const androidResult = scoreText(`
    Required Skills
    Android
  `);

  const phpMatch = phpResult.strongMatches.find((match) => match.term === "PHP");
  const androidMatch = androidResult.strongMatches.find((match) => match.term === "Android");

  assert.ok(phpMatch);
  assert.equal(phpMatch.evidenceType, "professional");
  assert.ok(/professional evidence/i.test(phpMatch.label));
  assert.equal(phpResult.partialMatches.some((match) => match.term === "PHP"), false);

  assert.ok(androidMatch);
  assert.equal(androidMatch.evidenceType, "professional");
  assert.ok(/professional evidence/i.test(androidMatch.label));
  assert.equal(androidResult.partialMatches.some((match) => match.term === "Android"), false);
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

test("does not treat prose suffixes as ambiguous short technology aliases", () => {
  const result = scoreText(`
    Required Skills
    Requirements gathering and stakeholder workshops
  `);

  assert.equal(result.strongMatches.some((match) => match.term === "TypeScript"), false);
  assert.equal(result.partialMatches.some((match) => match.term === "TypeScript"), false);
});

test("does not match Java inside JavaScript", () => {
  const result = scoreText(`
    Required Skills
    JavaScript
  `);

  assert.equal(result.strongMatches.some((match) => match.term === "Java"), false);
  assert.equal(result.partialMatches.some((match) => match.term === "Java"), false);
});

test("retains technology and tenure requirements from the same prose line", () => {
  const result = scoreText(`
    Required Skills
    5+ years of React production experience
  `);

  assert.ok(result.strongMatches.some((match) => match.term === "React"));
  assert.ok(result.strongMatches.some((match) => match.term === "5+ years"));
});

test("finds every technology in multi-technology prose", () => {
  const result = scoreText(`
    Required Skills
    Production delivery using ASP.NET Core, React, TypeScript, SQL Server and Azure.
  `);
  const strongTerms = result.strongMatches.map((match) => match.term);

  for (const term of ["ASP.NET Core", "React", "TypeScript", "SQL Server", "Azure"]) {
    assert.ok(strongTerms.includes(term), `Expected a strong ${term} match`);
  }
});

test("verified public career tenure satisfies 5-, 10-, and 12-year requirements", () => {
  for (const years of [5, 10, 12]) {
    const result = scoreText(`
      Required Skills
      ${years}+ years of professional software delivery experience
    `);

    assert.ok(
      result.strongMatches.some((match) => match.term === `${years}+ years`),
      `Expected ${years}+ years to be backed by verified tenure`
    );
    assert.equal(result.gaps.some((match) => match.term === `${years}+ years`), false);
  }
});

test("does not award seniority or education points when the JD omits those categories", () => {
  const result = scoreText(`
    Required Skills
    ASP.NET Core, React and SQL Server
  `);

  assert.equal(categoryScore(result, "professionalExperience"), 0);
  assert.equal(categoryScore(result, "educationCoursework"), 0);
  assert.equal(result.categories.professionalExperience.totalRequirements, 0);
  assert.equal(result.categories.educationCoursework.totalRequirements, 0);
});

test("calibrates a Laravel enterprise JD without counting employer questions or generic prose as technology gaps", () => {
  const result = scoreText(`
    Responsibilities
    Develop, maintain, and enhance enterprise web applications using the Laravel Framework and modern software development tools.
    Integrate applications through APIs, web services, webhooks, and database integrations.
    Design and implement AI-powered solutions, including GenAI-assisted applications, chatbots, and workflow automation.
    Ensure quality through testing, code reviews, performance optimisation, troubleshooting, secure coding, deployments, production support, and technical documentation.
    Collaborate with business users, vendors, product owners, and cross-functional teams using Agile methodologies.

    Requirements
    Bachelor's Degree in Computer Science, Software Engineering, Information Technology, or a related field.
    Minimum five (5) years of experience in software application development, including at least two (2) years of hands-on experience with the Laravel Framework.
    Experience in enterprise web application development, RESTful API integration, CI/CD, Git, SQL databases, and Agile methodologies.
    Experience with GenAI-assisted coding tools such as Claude Code and AI application development is preferred.

    Work location: Setia Alam
    Employer questions
    What's your expected monthly basic salary?
    How many years' experience do you have as a Laravel Developer?
  `);

  const allMatches = [...result.strongMatches, ...result.partialMatches];
  const allTerms = allMatches.map((match) => match.term);
  const unverifiedTerms = result.unverified.map((match) => match.term);

  assert.ok(result.score >= 65, `Expected calibrated score >= 65, got ${result.score}`);
  assert.notEqual(result.confidence.label, "low");
  assert.ok(allTerms.includes("Laravel"));
  assert.ok(allTerms.includes("5 years"));
  assert.ok(allTerms.includes("2 years"));
  const laravelDuration = [...result.strongMatches, ...result.partialMatches].find((match) => match.term === "2 years");
  assert.ok(laravelDuration);
  assert.equal(laravelDuration.classification, "partial");
  assert.match(laravelDuration.label, /duration is not published/i);
  assert.ok(allTerms.includes("Agile"));
  assert.ok(allTerms.includes("AI-assisted development"));
  assert.equal(unverifiedTerms.some((term) => /salary|employer questions|work location/i.test(term)), false);
  assert.equal(result.categories.mobile.active, false);
  assert.equal(result.categories.languagesCommunication.active, true);
  assert.ok(result.categories.languagesCommunication.score > 0);
});
