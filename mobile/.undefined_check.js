// Static check for the class of bug that just crashed the app: an identifier
// USED in a module but never imported, declared, or otherwise in scope.
// Babel parses these files fine (it's valid syntax) -- the failure only
// appears at runtime, on the screen that happens to use it. This walks every
// scope and reports references that resolve to nothing.
const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const ROOT = "/Users/tatiana/tatainaamazonchat-3/mobile";

// Globals available at runtime in React Native that aren't imported.
const GLOBALS = new Set([
  "console", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "Promise", "JSON", "Math", "Date", "Object", "Array", "String", "Number",
  "Boolean", "Error", "RegExp", "Map", "Set", "WeakMap", "WeakSet", "Symbol",
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent",
  "decodeURIComponent", "fetch", "require", "module", "exports", "process",
  "global", "globalThis", "__DEV__", "Intl", "URL", "URLSearchParams",
  "AbortController", "TextEncoder", "TextDecoder", "structuredClone",
  "requestAnimationFrame", "cancelAnimationFrame", "queueMicrotask",
  "FormData", "Blob", "File", "FileReader", "XMLHttpRequest", "WebSocket",
  "undefined", "NaN", "Infinity", "arguments", "React", "JSX",
  "atob", "btoa", "Headers", "Request", "Response", "performance",
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", "archived", "ios", "android", "_unused", "_proposed"].includes(e.name)) continue;
      walk(p, out);
    } else if (e.name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

const files = [...walk(path.join(ROOT, "src")), path.join(ROOT, "App.js")];
let problems = 0;

for (const file of files) {
  const code = fs.readFileSync(file, "utf8");
  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: "module",
      plugins: ["jsx", "classProperties", "optionalChaining", "nullishCoalescingOperator", "objectRestSpread"],
    });
  } catch (e) {
    console.log(`PARSE FAIL ${path.relative(ROOT, file)}: ${e.message}`);
    problems++;
    continue;
  }

  traverse(ast, {
    ReferencedIdentifier(p) {
      const name = p.node.name;
      if (GLOBALS.has(name)) return;
      // JSX member expressions like <Foo.Bar /> reference Foo only
      if (p.scope.hasBinding(name, true)) return;
      if (p.scope.getBinding(name)) return;
      console.log(`UNDEFINED  ${path.relative(ROOT, file)}:${p.node.loc.start.line}  '${name}'`);
      problems++;
    },
  });
}

console.log(problems ? `\n${problems} problem(s) found` : "\nNo undefined identifiers found");
process.exit(problems ? 1 : 0);
