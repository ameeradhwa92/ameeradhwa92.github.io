(function (global) {
  "use strict";

  var MAX_FILE_BYTES = 10 * 1024 * 1024;
  var MAX_EXTRACTED_CHARS = 60000;
  var deps = { pdfjsLib: null, JSZip: null };
  var loadPromises = { pdfjsLib: null, JSZip: null };
  var HEADING_ALIASES = {
    "required skills": "Required Skills",
    "required qualifications": "Required Skills",
    "requirements": "Required Skills",
    "must have": "Required Skills",
    "preferred skills": "Preferred Skills",
    "preferred qualifications": "Preferred Skills",
    "nice to have": "Preferred Skills",
    "responsibilities": "Responsibilities",
    "responsibility": "Responsibilities",
    "years of experience": "Years of Experience",
    "experience": "Years of Experience"
  };
  var ALIAS_RULES = [
    { canonical: "ASP.NET Core", patterns: [/\basp\.?\s*net(?:\s*core)?\b/i, /\b\.net\b/i] },
    { canonical: "C#", patterns: [/\bc\s*sharp\b/i, /\bc#\b/i] },
    { canonical: "SQL Server", patterns: [/\bms\s*sql\b/i, /\bmicrosoft\s*sql\b/i, /\bsql\s*server\b/i] },
    { canonical: "React", patterns: [/\breact(?:\.js)?\b/i] },
    { canonical: "Azure", patterns: [/\bazure\b/i] }
  ];

  function createUserSafeError(message) {
    var error = new Error(message || "Could not read this document locally. Please paste the job description text instead.");
    error.userSafe = true;
    return error;
  }

  function getDeps() {
    return global.__JDExtractorDeps || {};
  }

  function getScriptBaseUrl() {
    var UrlCtor = global.URL || (typeof URL !== "undefined" ? URL : null);
    var currentScript = global.document && global.document.currentScript;
    var scriptUrl = currentScript && currentScript.src;
    if (!scriptUrl && global.location && global.location.href && UrlCtor) {
      scriptUrl = new UrlCtor("assets/js/jd-extractor.js", global.location.href).href;
    }
    return scriptUrl && UrlCtor ? new UrlCtor(".", scriptUrl).href : "";
  }

  function vendorUrl(relativePath) {
    var UrlCtor = global.URL || (typeof URL !== "undefined" ? URL : null);
    var baseUrl = getScriptBaseUrl();
    return UrlCtor && baseUrl ? new UrlCtor(relativePath, baseUrl).href : relativePath;
  }

  function configurePdfJs(module) {
    if (module && module.GlobalWorkerOptions) {
      module.GlobalWorkerOptions.workerSrc = vendorUrl("../vendor/pdfjs/pdf.worker.min.mjs");
    }
    return module;
  }

  function loadPdfJs() {
    var injected = getDeps().pdfjsLib;
    if (injected) return Promise.resolve(configurePdfJs(injected));
    if (deps.pdfjsLib) return Promise.resolve(deps.pdfjsLib);
    if (loadPromises.pdfjsLib) return loadPromises.pdfjsLib;
    loadPromises.pdfjsLib = import(vendorUrl("../vendor/pdfjs/pdf.min.mjs")).then(function (module) {
      deps.pdfjsLib = configurePdfJs(module);
      return deps.pdfjsLib;
    });
    return loadPromises.pdfjsLib;
  }

  function loadScript(url, globalKey) {
    return new Promise(function (resolve, reject) {
      if (!global.document || !global.document.createElement || !global.document.head) {
        reject(createUserSafeError());
        return;
      }
      var script = global.document.createElement("script");
      script.src = url;
      script.async = true;
      script.onload = function () { resolve(global[globalKey]); };
      script.onerror = function () { reject(createUserSafeError()); };
      global.document.head.appendChild(script);
    });
  }

  function loadJSZip() {
    var injected = getDeps().JSZip;
    if (injected) return Promise.resolve(injected);
    if (global.JSZip) return Promise.resolve(global.JSZip);
    if (deps.JSZip) return Promise.resolve(deps.JSZip);
    if (loadPromises.JSZip) return loadPromises.JSZip;
    loadPromises.JSZip = loadScript(vendorUrl("../vendor/jszip/jszip.min.js"), "JSZip").then(function (JSZip) {
      deps.JSZip = JSZip;
      return deps.JSZip;
    });
    return loadPromises.JSZip;
  }

  function readArrayBuffer(file) {
    if (!file || typeof file.arrayBuffer !== "function") {
      return Promise.reject(createUserSafeError());
    }
    return file.arrayBuffer();
  }

  function getExtension(file) {
    var name = (file && file.name ? file.name : "").toLowerCase();
    if (name.slice(-4) === "docx" || name.slice(-5) === ".docx") return "docx";
    if (name.slice(-3) === "pdf" || name.slice(-4) === ".pdf") return "pdf";
    return "";
  }

  function sanitizeText(text, warnings) {
    var output = String(text || "").replace(/\u0000/g, "");
    if (output.length > MAX_EXTRACTED_CHARS) {
      output = output.slice(0, MAX_EXTRACTED_CHARS);
      warnings.push("Only the first 60,000 characters were analyzed locally.");
    }
    return output;
  }

  function hasMeaningfulText(text) {
    return /[A-Za-z0-9]/.test(text || "");
  }

  function extract(file) {
    if (!file) {
      return Promise.reject(createUserSafeError());
    }
    if (typeof file.size === "number" && file.size > MAX_FILE_BYTES) {
      return Promise.reject(createUserSafeError("This document is larger than 10 MB. Please paste the job description text instead."));
    }
    if (getExtension(file) === "pdf") return extractPdf(file);
    if (getExtension(file) === "docx") return extractDocx(file);
    return Promise.reject(createUserSafeError("Only PDF and DOCX files are supported. Please paste the job description text instead."));
  }

  function sortPdfItems(items) {
    return items.slice().sort(function (left, right) {
      var leftY = left.transform && typeof left.transform[5] === "number" ? left.transform[5] : 0;
      var rightY = right.transform && typeof right.transform[5] === "number" ? right.transform[5] : 0;
      var deltaY = Math.abs(rightY - leftY);
      if (deltaY > 4) return rightY - leftY;
      var leftX = left.transform && typeof left.transform[4] === "number" ? left.transform[4] : 0;
      var rightX = right.transform && typeof right.transform[4] === "number" ? right.transform[4] : 0;
      return leftX - rightX;
    });
  }

  function joinPdfItems(items) {
    var sorted = sortPdfItems(items);
    var lines = [];
    var current = [];
    var lastY = null;
    var lastX = null;
    for (var index = 0; index < sorted.length; index += 1) {
      var item = sorted[index];
      var value = item && typeof item.str === "string" ? item.str.trim() : "";
      if (!value) continue;
      var y = item.transform && typeof item.transform[5] === "number" ? item.transform[5] : 0;
      var x = item.transform && typeof item.transform[4] === "number" ? item.transform[4] : 0;
      if (lastY !== null && Math.abs(lastY - y) > 4) {
        lines.push(current.join(" ").trim());
        current = [value];
      } else if (current.length && lastX !== null && x - lastX > 18) {
        current.push(value);
      } else if (current.length) {
        current.push(value);
      } else {
        current = [value];
      }
      lastY = y;
      lastX = x;
    }
    if (current.length) lines.push(current.join(" ").trim());
    return lines.filter(Boolean).join("\n");
  }

  function extractPdf(file) {
    var warnings = [];
    return Promise.all([loadPdfJs(), readArrayBuffer(file)]).then(function (values) {
      var pdfjsLib = values[0];
      var buffer = values[1];
      var loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        disableWorker: typeof Worker === "undefined",
        isEvalSupported: false,
        useSystemFonts: true
      });
      return loadingTask.promise.then(function (pdf) {
        var chain = Promise.resolve([]);
        for (var pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          (function (pageIndex) {
            chain = chain.then(function (pages) {
              return pdf.getPage(pageIndex).then(function (page) {
                return page.getTextContent().then(function (textContent) {
                  pages.push(joinPdfItems(textContent.items || []));
                  return pages;
                });
              });
            });
          }(pageNumber));
        }
        return chain;
      }).then(function (pages) {
        var text = sanitizeText(pages.filter(Boolean).join("\n\n"), warnings);
        if (!hasMeaningfulText(text)) {
          warnings.push("No readable text was found in this PDF. Please paste the job description text instead.");
          text = "";
        }
        return { text: text, source: "pdf", warnings: warnings };
      });
    }).catch(function (error) {
      if (error && error.userSafe) throw error;
      throw createUserSafeError("Could not read this PDF locally. Please paste the job description text instead.");
    });
  }

  function decodeEntities(text) {
    return String(text || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&apos;/gi, "'")
      .replace(/&#39;/gi, "'")
      .replace(/&#x2019;/gi, "'")
      .replace(/&#x2013;/gi, "-")
      .replace(/&#x2014;/gi, "-");
  }

  function extractDocxText(xml) {
    return decodeEntities(String(xml || "")
      .replace(/<w:tab[^>]*\/>/gi, "\t")
      .replace(/<w:br[^>]*\/>/gi, "\n")
      .replace(/<\/w:tc>/gi, "\n")
      .replace(/<\/w:tr>/gi, "\n")
      .replace(/<\/w:p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\r/g, ""));
  }

  function extractDocx(file) {
    var warnings = [];
    return Promise.all([loadJSZip(), readArrayBuffer(file)]).then(function (values) {
      var JSZip = values[0];
      var buffer = values[1];
      return JSZip.loadAsync(buffer).then(function (zip) {
        var doc = zip.file("word/document.xml");
        if (!doc) throw createUserSafeError("This DOCX file is unsupported, encrypted, or malformed. Please paste the job description text instead.");
        return doc.async("string");
      }).then(function (xml) {
        var text = sanitizeText(extractDocxText(xml), warnings);
        if (!hasMeaningfulText(text)) {
          warnings.push("No readable text was found in this DOCX file. Please paste the job description text instead.");
          text = "";
        }
        return { text: text, source: "docx", warnings: warnings };
      });
    }).catch(function (error) {
      if (error && error.userSafe) throw error;
      throw createUserSafeError("This DOCX file is unsupported, encrypted, or malformed. Please paste the job description text instead.");
    });
  }

  function normalizePunctuation(text) {
    return String(text || "")
      .replace(/\u00A0/g, " ")
      .replace(/[\u2018\u2019\u201A]/g, "'")
      .replace(/[\u201C\u201D]/g, "\"")
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2022/g, "\n- ")
      .replace(/\t+/g, "\n")
      .replace(/[ ]+\n/g, "\n")
      .replace(/\n[ ]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n");
  }

  function getHeadingKey(line) {
    return String(line || "").toLowerCase().replace(/[:\-\u2013\u2014]+$/g, "").replace(/\s+/g, " ").trim();
  }

  function getHeadingStrength(heading) {
    if (heading === "Required Skills") return "required";
    if (heading === "Preferred Skills") return "preferred";
    return "neutral";
  }

  function resolveHeading(line) {
    var trimmed = String(line || "").trim();
    if (!trimmed) return null;
    var direct = HEADING_ALIASES[getHeadingKey(trimmed)];
    if (direct) return { heading: direct, remainder: "" };
    var inline = trimmed.match(/^([A-Za-z][A-Za-z0-9\s+.#/&-]{1,40}?):\s*(.+)$/);
    if (inline) {
      var mapped = HEADING_ALIASES[getHeadingKey(inline[1])];
      if (mapped) return { heading: mapped, remainder: inline[2].trim() };
    }
    return null;
  }

  function detectStrength(line, fallbackStrength) {
    var value = String(line || "").toLowerCase();
    if (/\b(must have|required)\b/.test(value)) return "required";
    if (/\b(preferred|nice to have)\b/.test(value)) return "preferred";
    return fallbackStrength || "neutral";
  }

  function normalizeAlias(line, fallbackStrength, sectionHeading, terms, dedupe) {
    for (var ruleIndex = 0; ruleIndex < ALIAS_RULES.length; ruleIndex += 1) {
      var rule = ALIAS_RULES[ruleIndex];
      for (var patternIndex = 0; patternIndex < rule.patterns.length; patternIndex += 1) {
        if (rule.patterns[patternIndex].test(line)) {
          var strength = detectStrength(line, fallbackStrength);
          var key = [rule.canonical, sectionHeading || "", strength].join("|");
          if (!dedupe[key]) {
            dedupe[key] = true;
            terms.push({
              term: rule.canonical,
              sourceText: line,
              section: sectionHeading || null,
              strength: strength
            });
          }
          break;
        }
      }
    }
    var years = line.match(/\b(\d+)\s*(\+|plus)?\s+years?\b/i);
    if (years) {
      var yearTerm = years[1] + (years[2] ? "+ years" : " years");
      var yearStrength = detectStrength(line, fallbackStrength);
      var yearKey = ["years", yearTerm, sectionHeading || "", yearStrength].join("|");
      if (!dedupe[yearKey]) {
        dedupe[yearKey] = true;
        terms.push({
          term: yearTerm,
          sourceText: line,
          section: sectionHeading || null,
          strength: yearStrength
        });
      }
    }
  }

  function normalize(text) {
    var warnings = [];
    var rawText = String(text || "");
    var normalizedText = normalizePunctuation(decodeEntities(rawText)).replace(/\r\n?/g, "\n");
    var lines = normalizedText.split("\n");
    var sections = [];
    var current = null;
    var terms = [];
    var dedupe = Object.create(null);

    function pushCurrent() {
      if (!current) return;
      current.lines = current.lines.filter(Boolean);
      current.text = current.lines.join("\n").trim();
      sections.push(current);
    }

    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index].replace(/\s+/g, " ").trim();
      if (!line) continue;
      var heading = resolveHeading(line);
      if (heading) {
        pushCurrent();
        current = {
          heading: heading.heading,
          strength: getHeadingStrength(heading.heading),
          lines: []
        };
        if (heading.remainder) current.lines.push(heading.remainder);
        continue;
      }
      if (!current) {
        current = { heading: null, strength: "neutral", lines: [] };
      }
      current.lines.push(line);
      normalizeAlias(line, current.strength, current.heading, terms, dedupe);
    }

    pushCurrent();

    if (!sections.length && normalizedText.trim()) {
      warnings.push("No recognizable section headings were found; matching will use generic text only.");
    }

    return {
      rawText: rawText,
      normalizedText: normalizedText.trim(),
      sections: sections,
      terms: terms,
      warnings: warnings
    };
  }

  global.JDExtractor = {
    extract: extract,
    normalize: normalize
  };
}(typeof window !== "undefined" ? window : globalThis));
