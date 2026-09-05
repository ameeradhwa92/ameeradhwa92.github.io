const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets', 'css', 'style.css'), 'utf8');

function rule(selector, source = css) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp('(?:^|\\n)' + escaped + '\\s*\\{([^}]*)\\}'));
  assert.ok(match, `no rule for ${selector}`);
  return match[1];
}

function mediaBlock(query) {
  const start = css.indexOf(`@media (${query})`);
  assert.ok(start >= 0, `no @media (${query}) block`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') { depth -= 1; if (depth === 0) return css.slice(start, i + 1); }
  }
  assert.fail(`unterminated @media (${query}) block`);
}

/* The hero thread <svg> has a viewBox, so it is a replaced element whose used width is
   the viewBox ratio × its height (~1.6–2× the hero's width). That wide, shallow curve is
   the approved shape, but a phone or tablet sizes its layout viewport to the widest
   scrollable content and zooms the whole page out to fit it. The overspill must be
   clipped at the hero, and the stacked (≤900px) hero hides the thread altogether, as the
   approved mockups did. */
test('the hero thread keeps its ratio-driven width but never widens the page', () => {
  assert.match(html, /<svg class="hero-thread"[^>]*viewBox="0 0 1100 520"[^>]*preserveAspectRatio="none"/);
  const thread = rule('.hero-thread');
  assert.match(thread, /position:\s*absolute/);
  assert.match(thread, /(?:^|[\s;])left:\s*0/);
  assert.match(thread, /(?:^|[\s;])right:\s*0/);
  assert.match(thread, /(?:^|[\s;])height:\s*100%/);
  assert.doesNotMatch(thread, /(?:^|[\s;])width:/, 'the width is meant to come from the viewBox ratio');
});

test('the hero clips horizontal overflow without becoming a scroll container', () => {
  const hero = rule('.hero');
  assert.match(hero, /position:\s*relative/);
  assert.match(hero, /overflow-x:\s*clip/, '.hero needs overflow-x: clip so the thread cannot widen the layout viewport');
  assert.doesNotMatch(hero, /overflow(?:-x)?:\s*hidden/, 'hidden would make the hero a scroll container');
});

test('the stacked hero hides the thread, as the approved mockups did', () => {
  const block = mediaBlock('max-width: 900px');
  assert.match(block, /\.hero-grid\s*\{[^}]*grid-template-columns:\s*1fr/, 'the 900px block is where the hero stacks');
  assert.match(block, /\.hero-thread\s*\{\s*display:\s*none/);
});
