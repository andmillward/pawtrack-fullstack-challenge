// Safe HTML rendering helpers (XSS prevention).
//
// Loaded as a plain <script> in the browser (where it exposes escapeHtml / raw
// / html as globals) and require()'d in Node for unit tests. Keeping the
// security-critical escaping in one small module gives it a single, tested home
// instead of scattering it across render functions.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api; // Node / tests (CommonJS)
  } else {
    root.escapeHtml = api.escapeHtml; // browser globals
    root.raw = api.raw;
    root.html = api.html;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // Escapes a value for safe interpolation into HTML text or quoted attributes.
  // `&` is replaced first so the entities produced below are not re-encoded.
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Marks an already-safe HTML string so `html` won't re-escape it. Use ONLY for
  // markup we built ourselves — never for user- or server-supplied data.
  function raw(value) {
    return { __safeHtml: String(value) };
  }

  // Tagged template that escapes EVERY interpolation by default, so rendered
  // data (pet names, notes, etc.) can never inject markup. Trusted fragments
  // must be wrapped with raw().
  function html(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const safe = v && typeof v === 'object' && '__safeHtml' in v ? v.__safeHtml : escapeHtml(v);
      out += safe + strings[i + 1];
    }
    return out;
  }

  return { escapeHtml, raw, html };
});
