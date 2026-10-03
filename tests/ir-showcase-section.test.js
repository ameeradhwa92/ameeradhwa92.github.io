const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets', 'css', 'style.css'), 'utf8');
const motion = fs.readFileSync(path.join(root, 'assets', 'js', 'motion.js'), 'utf8');
const i18nSource = fs.readFileSync(path.join(root, 'assets', 'js', 'i18n.js'), 'utf8');
const I18N_MS = new Function('window', i18nSource + '; return window.I18N_MS;')({});

const sectionMatch = html.match(/<section class="section ir" id="work"[\s\S]*?\n  <\/section>/);
const section = sectionMatch ? sectionMatch[0] : '';

test('the newest-work section sits after the stats strip and before the journey', () => {
  assert.ok(section, 'the #work section is present');
  const stats = html.indexOf('<section class="stats"');
  const work = html.indexOf('id="work"');
  const route = html.indexOf('id="route"');
  assert.ok(stats > -1 && stats < work && work < route);
  assert.match(html, /<a href="#work" data-i18n="nav\.work">/);
});

test('every keyed string in the showcase has a Bahasa Melayu translation', () => {
  const keys = [...section.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 30, `expected the three chapters to be keyed, found ${keys.length}`);
  for (const key of keys) {
    assert.equal(typeof I18N_MS[key], 'string', `missing MS entry for ${key}`);
    assert.ok(I18N_MS[key].trim().length > 0, `empty MS entry for ${key}`);
  }
});

test('the four chapters are present, in order, each with real screens for both themes', () => {
  const order = ['id="ir-overview"', 'id="ir-plan"', 'id="ir-track"', 'id="ir-survey"'].map((id) => section.indexOf(id));
  assert.ok(order.every((i) => i > -1) && order.every((v, i) => i === 0 || order[i - 1] < v));
  const shots = [...section.matchAll(/<img class="ir-img ir-img-(dark|light)" src="([^"]+)" alt="([^"]+)" loading="lazy" width="1280" height="800">/g)];
  assert.equal(shots.length, 10, 'five screens, each in dark and light');
  for (const [, theme, src, alt] of shots) {
    assert.match(src, new RegExp(`^assets/img/projects/ir-workforce/[a-z]+-${theme}\\.jpg$`));
    assert.ok(fs.existsSync(path.join(root, src)), `${src} exists`);
    assert.ok(alt.length > 20, `${src} has a real alt text`);
  }
  const phones = [...section.matchAll(/<img class="ir-img ir-img-(dark|light)" src="([^"]+)" alt="([^"]+)" loading="lazy" width="360" height="780">/g)];
  assert.equal(phones.length, 8, 'four IR Ops phone screens, each in dark and light');
  for (const [, theme, src] of phones) {
    assert.match(src, new RegExp(`^assets/img/projects/ir-ops/[a-z]+-${theme}\\.jpg$`));
    assert.ok(fs.existsSync(path.join(root, src)), `${src} exists`);
  }
  assert.match(css, /:root\[data-theme="light"\] \.ir-img-dark \{ display: none; \}/, 'the explicit light theme swaps the screens');
  assert.match(css, /:root:not\(\[data-theme="dark"\]\) \.ir-img-light \{ display: block; \}/, 'so does the OS light preference');
});

test('the survey pack lives on a measuring bench in the Survey chapter, not floating over the screens', () => {
  const survey = section.slice(section.indexOf('id="ir-survey"'));
  for (const id of ['ir-pack', 'cap-stage', 'cap-canvas', 'cap-box', 'cap-dims', 'cap-next', 'cap-w', 'cap-h']) {
    assert.match(survey, new RegExp(`id="${id}"`), `#${id} is in the Survey chapter`);
  }
  assert.doesNotMatch(section, /ir-pack-rail|ir-pack-slot|is-floating/, 'the floating rail is gone');
  for (const id of ['cap-w', 'cap-h']) {
    assert.match(survey, new RegExp(`<label class="ir-field" for="${id}">`), `#${id} has a label`);
    assert.match(survey, new RegExp(`<input id="${id}" type="text" inputmode="decimal"`), `#${id} opens a decimal keypad`);
  }
});

test('the showcase stays honest: demo data, labelled, no link to the private app', () => {
  assert.match(section, /data-i18n="ir\.note">Screens from IR Workforce in demo mode, with sample projects and people, and from IR Ops with product details blurred\./);
  assert.doesNotMatch(html, /azurewebsites\.net/, 'the private app is not linked or named by host');
  assert.match(section, /badge badge-private/, 'status is Live · Private');
  const card = html.match(/<div class="card card-feature">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);
  assert.ok(card, 'the IR card leads the RetailAIM era');
  assert.match(card[0], /alt="RetailAIM IR Workforce dashboard in demo mode, with sample data"/);
  assert.match(card[0], /href="#work"/);
  assert.ok(fs.existsSync(path.join(root, 'assets', 'img', 'projects', 'retailaim-ir.jpg')));
});

test('GSAP is vendored, pinned and loaded after the globe, before the showcase scripts', () => {
  for (const f of ['gsap.min.js', 'ScrollTrigger.min.js', 'SplitText.min.js']) {
    const file = path.join(root, 'assets', 'vendor', 'gsap', f);
    assert.ok(fs.existsSync(file), `${f} is vendored`);
    assert.match(fs.readFileSync(file, 'utf8').slice(0, 200), /3\.15\.0/);
  }
  const readme = fs.readFileSync(path.join(root, 'assets', 'vendor', 'README.md'), 'utf8');
  assert.match(readme, /GSAP `3\.15\.0`/);
  assert.match(
    html,
    /<script src="assets\/js\/route-globe\.js\?v=([^"]+)" defer><\/script>[\s\S]*?<script src="assets\/vendor\/gsap\/gsap\.min\.js" defer><\/script>\s*<script src="assets\/vendor\/gsap\/ScrollTrigger\.min\.js" defer><\/script>\s*<script src="assets\/vendor\/gsap\/SplitText\.min\.js" defer><\/script>\s*<script src="assets\/js\/ir-core\.js\?v=\1" defer><\/script>\s*<script src="assets\/js\/ir-showcase\.js\?v=\1" defer><\/script>\s*<script src="assets\/js\/motion\.js\?v=\1" defer><\/script>/
  );
});

test('the stacking query is one query in CSS and in motion.js', () => {
  const query = '(min-width: 1101px) and (min-height: 820px)';
  assert.ok(css.includes(`@media ${query} {`), 'style.css makes the chapters sticky under the query');
  assert.ok(motion.includes(`mm.add("${query}"`), 'motion.js scrubs the stack under the same query');
  assert.match(css, /\.ir-chapter::after \{[^}]*opacity: var\(--dim, 0\)/, 'covered chapters dim by overlay, not opacity');
});

test('reduced motion freezes the new motion, and motion.js bails out before hiding anything', () => {
  const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
  assert.ok(block);
  for (const sel of ['.marquee-track', '.contact-big-track', '.cap-box', '.cursor']) {
    assert.ok(block[1].includes(sel), `${sel} is frozen or hidden under reduced motion`);
  }
  const bail = motion.indexOf('if (!gsap || !ScrollTrigger || reduced) return;');
  assert.ok(bail > -1, 'the early return exists');
  assert.ok(bail < motion.indexOf('autoAlpha: 0'), 'nothing is hidden before the bail-out');
});
