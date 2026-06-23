const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, html, raw } = require('./safe-html.js');

test('escapeHtml neutralizes the seed XSS payload', () => {
  assert.equal(
    escapeHtml('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;',
  );
});

test('escapeHtml encodes quotes and ampersands', () => {
  assert.equal(escapeHtml(`"&'`), '&quot;&amp;&#39;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('escapeHtml escapes & before producing entities (no double-encoding bug)', () => {
  // The single source `<` must yield exactly one entity, not `&amp;lt;`.
  assert.equal(escapeHtml('<'), '&lt;');
});

test('escapeHtml coerces non-string values', () => {
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml(null), 'null');
  assert.equal(escapeHtml(undefined), 'undefined');
});

test('html escapes interpolated values by default', () => {
  const out = html`<div>${'<script>alert(1)</script>'}</div>`;
  assert.equal(out, '<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>');
});

test('html escapes attribute-breaking input inside quoted attributes', () => {
  const evil = '" onmouseover="alert(1)';
  const out = html`<a title="${evil}">x</a>`;
  assert.equal(out, '<a title="&quot; onmouseover=&quot;alert(1)">x</a>');
});

test('raw() composes trusted HTML without escaping', () => {
  const out = html`<div>${raw('<button>ok</button>')}</div>`;
  assert.equal(out, '<div><button>ok</button></div>');
});

test('raw() is required — a plain trusted-looking string is still escaped', () => {
  const out = html`<div>${'<button>ok</button>'}</div>`;
  assert.equal(out, '<div>&lt;button&gt;ok&lt;/button&gt;</div>');
});

test('html preserves static chunks and handles multiple interpolations', () => {
  assert.equal(html`a${1}b${2}c`, 'a1b2c');
});

test('html with no interpolations returns the literal', () => {
  assert.equal(html`<p>hello</p>`, '<p>hello</p>');
});
