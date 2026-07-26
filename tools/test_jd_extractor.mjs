import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "..");
const extractorPath = path.join(repoRoot, "assets", "js", "jd-extractor.js");
const pdfjsPath = path.join(repoRoot, "assets", "vendor", "pdfjs", "pdf.min.mjs");
const jszipPath = path.join(repoRoot, "assets", "vendor", "jszip", "jszip.min.js");
const fixtureDir = path.join(repoRoot, "tools", "fixtures");

async function loadExtractor(options = {}) {
  const source = fs.readFileSync(extractorPath, "utf8");
  const injectPdfjs = options.injectPdfjs !== false;
  const injectJSZip = options.injectJSZip !== false;
  const pdfjsLib = injectPdfjs ? await import(pathToFileURL(pdfjsPath).href) : null;
  const JSZip = injectJSZip ? require(jszipPath) : null;
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
  const document = {
    currentScript: { src: pathToFileURL(extractorPath).href },
    loadedScripts: [],
    head: {
      appendChild(node) {
        document.loadedScripts.push(node.src);
        const localPath = fileURLToPath(node.src);
        context.window.JSZip = require(localPath);
        if (typeof node.onload === "function") node.onload();
      }
    },
    createElement() {
      return {
        _src: "",
        async: false,
        set src(value) { this._src = value; },
        get src() { return this._src; },
        onload: null,
        onerror: null
      };
    }
  };
  context.window = {
    location: { href: pathToFileURL(path.join(repoRoot, "index.html")).href },
    URL,
    document
  };
  if (injectPdfjs || injectJSZip) {
    context.window.__JDExtractorDeps = {};
    if (injectPdfjs) context.window.__JDExtractorDeps.pdfjsLib = pdfjsLib;
    if (injectJSZip) context.window.__JDExtractorDeps.JSZip = JSZip;
  }
  context.document = document;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: extractorPath });
  return { extractor: context.window.JDExtractor, context };
}

async function makeFile(name, type) {
  const fullPath = path.join(fixtureDir, name);
  const bytes = fs.readFileSync(fullPath);
  return new File([bytes], name, { type });
}

test("extracts required and preferred terms from a text PDF", async () => {
  const { extractor } = await loadExtractor();
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
  const { extractor } = await loadExtractor();
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
  const { extractor } = await loadExtractor();
  const result = await extractor.extract(await makeFile("jd-image-only.pdf", "application/pdf"));

  assert.equal(result.source, "pdf");
  assert.ok(result.warnings.some((warning) => /paste .*text/i.test(warning)));
  assert.equal(result.text, "");
});

test("rejects malformed DOCX input with a user-safe fallback error", async () => {
  const { extractor } = await loadExtractor();

  await assert.rejects(async () => {
    try {
      await extractor.extract(await makeFile("jd-malformed.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    } catch (error) {
      assert.equal(error.userSafe, true);
      assert.match(error.message, /paste .*text/i);
      throw error;
    }
  });
});

test("normalization preserves headings and requirement strength for pasted text", async () => {
  const { extractor } = await loadExtractor();
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

test("normalization extracts terms from inline heading remainders", async () => {
  const { extractor } = await loadExtractor();
  const normalized = extractor.normalize("Required Skills: ASP.NET Core, C Sharp\nPreferred Skills: React.js");

  assert.ok(normalized.terms.some((term) => term.term === "ASP.NET Core" && term.strength === "required"));
  assert.ok(normalized.terms.some((term) => term.term === "C#" && term.strength === "required"));
  assert.ok(normalized.terms.some((term) => term.term === "React" && term.strength === "preferred"));
});

test("production self-hosted JSZip loader resolves the local vendor asset path", async () => {
  const { extractor, context } = await loadExtractor({ injectJSZip: false });
  const docxResult = await extractor.extract(await makeFile("jd-sample.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));

  assert.equal(docxResult.source, "docx");
  assert.match(context.window.document.currentScript.src, /assets\/js\/jd-extractor\.js$/i);
  assert.ok(context.document.loadedScripts.some((src) => /assets\/vendor\/jszip\/jszip\.min\.js$/i.test(src)));
  assert.equal(typeof context.window.JSZip, "function");
});

test("worker wiring configures the vendored PDF.js worker URL from the production script base", async () => {
  const { extractor, context } = await loadExtractor({ injectJSZip: false });
  const pdfjsLib = await import(pathToFileURL(pdfjsPath).href);

  assert.equal(typeof extractor.extract, "function");
  assert.match(pdfjsLib.GlobalWorkerOptions.workerSrc, /assets\/vendor\/pdfjs\/pdf\.worker\.min\.mjs$/i);
  assert.match(context.window.document.currentScript.src, /assets\/js\/jd-extractor\.js$/i);
});

test("rejects files larger than 10 MB with a user-safe error", async () => {
  const { extractor } = await loadExtractor();
  const largeFile = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "too-large.pdf", { type: "application/pdf" });

  await assert.rejects(async () => {
    try {
      await extractor.extract(largeFile);
    } catch (error) {
      assert.equal(error.userSafe, true);
      assert.match(error.message, /larger than 10 mb/i);
      throw error;
    }
  });
});

test("caps extracted text at 60,000 characters and warns", async () => {
  const { extractor } = await loadExtractor();
  const JSZip = require(jszipPath);
  const zip = new JSZip();
  var repeatedText = "ASP.NET Core ".repeat(6000);
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder("word").file("document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Required Skills</w:t></w:r></w:p>
    <w:p><w:r><w:t>${repeatedText}</w:t></w:r></w:p>
  </w:body>
</w:document>`);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const result = await extractor.extract(new File([bytes], "large.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));

  assert.equal(result.text.length, 60000);
  assert.ok(result.warnings.some((warning) => /60,000 characters/i.test(warning)));
});
