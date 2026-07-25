const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'main.js'), 'utf8');

test('navigation resume control exposes an icon-only PDF download with translated accessible copy', () => {
  assert.match(
    html,
    /<a class="nav-cta nav-resume" href="assets\/resume\/Ameer_Adhwa_Resume_2026\.pdf" download[^>]*aria-label="Download résumé \(PDF\)"[^>]*aria-describedby="nav-resume-tooltip"/,
    'the nav resume link should remain a labelled PDF download'
  );
  assert.match(html, /<svg[^>]*class="nav-resume-icon"/, 'the nav resume link should include a download icon');
  assert.match(html, /id="nav-resume-label"[^>]*data-i18n="nav\.resume\.label"/, 'the accessible label hook should be translatable');
  assert.match(html, /id="nav-resume-tooltip"[^>]*data-i18n="nav\.resume\.tooltip"/, 'the tooltip copy should be translatable');
});

test('dismissal before the resume tooltip delay prevents its introduction', () => {
  assert.match(
    main,
    /window\.setTimeout\(function \(\) \{\s*if \(!resumeSeen\) resumeLink\.classList\.add\("resume-tooltip-intro"\);\s*\}, 500\)/,
    'the delayed callback should recheck whether the tooltip was dismissed'
  );
});
