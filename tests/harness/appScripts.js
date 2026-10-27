'use strict';
/**
 * FA-P1 (2026-10-27): a page's own scripts used to be inline <script> blocks, and a few harnesses cut them out of the
 * HTML by regex. Under the strict Content-Security-Policy every script is a file (public/js/<page>-NN-*.js), loaded by
 * <script src="/js/…"> at the same place. inlineScriptBlocks(page) returns those files' code in page order, wrapped as
 * the "<script>…</script>" strings the harnesses expected, so a harness still finds the block it drives by its content.
 */
const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', '..', 'public');

function inlineScriptBlocks(page = 'index.html') {
  const html = fs.readFileSync(path.join(PUB, page), 'utf8');
  return [...html.matchAll(/<script\b[^>]*\bsrc="\/js\/([^"]+)"[^>]*><\/script>/g)]
    .map(m => '<script>' + fs.readFileSync(path.join(PUB, 'js', m[1]), 'utf8') + '</script>');
}

// The page as it read before the move: every <script src="/js/…"> put back inline with its file's code, and the
// policy's handler runtime + registry (/ff-csp.js, /_gen/ff-handlers.js) inline too — for a harness that reads the
// page's own code from the HTML text, or runs the page in a jsdom that loads no <script src>.
function pageSource(page = 'index.html') {
  const html = fs.readFileSync(path.join(PUB, page), 'utf8');
  return html.replace(/<script\b[^>]*\bsrc="\/(js\/[^"]+|ff-csp\.js|_gen\/ff-handlers\.js)"[^>]*><\/script>/g,
    (m, f) => fs.existsSync(path.join(PUB, f)) ? '<script>\n' + fs.readFileSync(path.join(PUB, f), 'utf8') + '</script>' : m);
}

module.exports = { inlineScriptBlocks, pageSource };
