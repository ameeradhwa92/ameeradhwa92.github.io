import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "..");
const extractorPath = path.join(repoRoot, "assets", "js", "jd-extractor.js");
const pdfjsPath = path.join(repoRoot, "assets", "vendor", "pdfjs", "pdf.min.mjs");
const jszipPath = path.join(repoRoot, "assets", "vendor", "jszip", "jszip.min.js");
const fixtureDir = path.join(repoRoot, "tools", "fixtures");

async function loadExtractor() {
  const source = fs.readFileSync(extractorPath, "utf8");
  const pdfjsLib = await import(pathToFileURL(pdfjsPath).href);
  const JSZip = require(jszipPath);
  const context = {
    console,
    setTimeout,
    clearTimeout,
    TextDecoder,
    URL,
    DOMParser: undefined,
    Blob,
    File,
    Uint8Array,
    ArrayBuffer,
    Promise
  };
  context.window = {
    location: { href: pathToFileURL(path.join(repoRoot, "index.html")).href },
    __JDExtractorDeps: { pdfjsLib, JSZip }
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: extractorPath });
  return context.window.JDExtractor;
}

async function makeFile(name, type) {
  const fullPath = path.join(fixtureDir, name);
  const bytes = fs.readFileSync(fullPath);
  return new File([bytes], name, { type });
}

test("extracts required and preferred terms from a text PDF", async () => {
  const extractor = await loadExtractor();
  const result = await extractor.extract(await makeFile("jd-text.pdf", "application/pdf"));
  const normalized = extractor.normalize(result.text);

  assert.equal(result.source, "pdf");
  assert.equal(result.warnings.length, 0);
  assert.match(result.text, /Required Skills/i);
  assert.match(result.text, /ASP\.NET Core/i);
  assert.match(result.text, /Responsibilities/i);
  assert.match(result.text, /Preferred Skills/i);
  assert.match(normalized.terms.map((term) => term.term).join("\n"), /ASP\.NET Core/);
  assert.match(normalized.terms.map((term) => term.term).join("\n"), /SQL Server/);
});

test("extracts DOCX paragraphs and table cells with heading boundaries", async () => {
  const extractor = await loadExtractor();
  const result = await extractor.extract(await makeFile("jd-sample.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
  const normalized = extractor.normalize(result.text);

  assert.equal(result.source, "docx");
  assert.equal(result.warnings.length, 0);
  assert.match(result.text, /Required Skills/i);
  assert.match(result.text, /Responsibilities/i);
  assert.match(result.text, /Own delivery & stakeholder communication\./i);
  assert.ok(normalized.sections.some((section) => section.heading === "Responsibilities"));
  assert.ok(normalized.terms.some((term) => term.term === "C#"));
  assert.ok(normalized.terms.some((term) => term.term === "React"));
});

test("warns when a PDF yields no meaningful text", async () => {
  const extractor = await loadExtractor();
  const result = await extractor.extract(await makeFile("jd-image-only.pdf", "application/pdf"));

  assert.equal(result.source, "pdf");
  assert.ok(result.warnings.some((warning) => /paste .*text/i.test(warning)));
  assert.equal(result.text, "");
});

test("rejects malformed DOCX input with a user-safe fallback error", async () => {
  const extractor = await loadExtractor();

  await assert.rejects(
    async () => extractor.extract(await makeFile("jd-malformed.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")),
    /paste .*text/i
  );
});

test("normalization preserves headings and requirement strength for pasted text", async () => {
  const extractor = await loadExtractor();
  const normalized = extractor.normalize(`
    Required Skills
    ASP.NET Core
    C Sharp
    MS SQL

    Responsibilities
    Must have 5+ years building APIs.

    Preferred Skills
    React.js
    Nice to have Azure experience.
  `);

  assert.equal(normalized.sections[0].heading, "Required Skills");
  assert.ok(normalized.sections.some((section) => section.heading === "Responsibilities"));
  assert.ok(normalized.sections.some((section) => section.heading === "Preferred Skills"));
  assert.ok(normalized.terms.some((term) => term.term === "ASP.NET Core" && term.strength === "required"));
  assert.ok(normalized.terms.some((term) => term.term === "C#" && term.strength === "required"));
  assert.ok(normalized.terms.some((term) => term.term === "SQL Server" && term.strength === "required"));
  assert.ok(normalized.terms.some((term) => term.term === "React" && term.strength === "preferred"));
  assert.match(normalized.normalizedText, /Responsibilities/);
});
