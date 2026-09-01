// Catches the class of bug that just crashed the app: a module imports a name
// that the target file does not export.
//
// Neither Babel nor the undefined-identifier check sees this. The import
// succeeds, the name is simply `undefined`, and the failure appears only at
// runtime -- as "Couldn't find a 'component' prop for the screen 'Support'",
// on the one screen that happens to use it. That is exactly what happened when
// an edit to PatientHome silently swallowed PatientSupport further down the
// same file.
const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");

const ROOT = __dirname;
const SKIP_DIRS = new Set(["node_modules", "ios", "android", "archived", "_proposed", "_unused"]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (e.name.endsWith(".js")) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

function parse(file) {
  return parser.parse(fs.readFileSync(file, "utf8"), {
    sourceType: "module",
    plugins: ["jsx", "classProperties", "optionalChaining", "nullishCoalescingOperator", "objectRestSpread"],
  });
}

// Every name a file exports, including `export { a as b }` and re-exports.
function exportsOf(file) {
  const names = new Set();
  let ast;
  try { ast = parse(file); } catch { return names; }
  for (const node of ast.program.body) {
    if (node.type === "ExportDefaultDeclaration") names.add("default");
    if (node.type !== "ExportNamedDeclaration") continue;
    const d = node.declaration;
    if (d) {
      if (d.id?.name) names.add(d.id.name);
      for (const decl of d.declarations || []) {
        if (decl.id?.name) names.add(decl.id.name);
      }
    }
    for (const spec of node.specifiers || []) {
      names.add(spec.exported?.name || spec.local?.name);
    }
  }
  return names;
}

function resolve(fromFile, spec) {
  if (!spec.startsWith(".")) return null;          // package, not ours
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, `${base}.js`, path.join(base, "index.js")]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return undefined;                                 // local file that is missing
}

const files = walk(path.join(ROOT, "src")).concat(
  fs.existsSync(path.join(ROOT, "App.js")) ? [path.join(ROOT, "App.js")] : []
);

const cache = new Map();
const cachedExports = (f) => {
  if (!cache.has(f)) cache.set(f, exportsOf(f));
  return cache.get(f);
};

let problems = 0;
for (const file of files) {
  let ast;
  try { ast = parse(file); } catch { continue; }    // parse errors are the other check's job
  for (const node of ast.program.body) {
    if (node.type !== "ImportDeclaration") continue;
    const target = resolve(file, node.source.value);
    if (target === null) continue;                  // external package
    const rel = path.relative(ROOT, file);
    if (target === undefined) {
      console.log(`MISSING FILE   ${rel}  ->  ${node.source.value}`);
      problems++;
      continue;
    }
    const available = cachedExports(target);
    for (const spec of node.specifiers) {
      if (spec.type !== "ImportSpecifier") continue; // default/namespace: skip
      const wanted = spec.imported.name;
      if (!available.has(wanted)) {
        console.log(
          `NOT EXPORTED   ${wanted}\n` +
          `               imported by ${rel}\n` +
          `               from        ${path.relative(ROOT, target)}`
        );
        problems++;
      }
    }
  }
}

console.log(problems ? `\n${problems} broken import(s)` : "\nEvery named import resolves to a real export");
process.exit(problems ? 1 : 0);
