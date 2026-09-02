// Loads an app source module in plain Node for testing.
//
// The app's modules are written for React Native, so their imports (Expo,
// react-native, JSON assets) cannot resolve under Node. This rewrites the
// import statements to read from a caller-supplied stub table and evaluates
// the REAL source, so the tests exercise shipped code rather than a copy.
import fs from "node:fs";
import path from "node:path";

let seq = 0;

export async function load(relPath, stubs = {}) {
  const abs = path.resolve(process.cwd(), relPath);
  const key = `__stubs_${seq++}`;
  globalThis[key] = stubs;
  let src = fs.readFileSync(abs, "utf8");

  // ESM hoists imports above all other statements; a module may use an
  // imported value in a top-level const declared before the import line.
  // The rewritten declarations are therefore collected and prepended.
  const decls = [];
  const declare = (clause, spec) => {
    const g = `globalThis[${JSON.stringify(key)}][${JSON.stringify(spec)}]`;
    clause = clause.trim();
    if (clause.startsWith("*")) {
      decls.push(`const ${clause.replace(/^\*\s*as\s+/, "").trim()} = ${g};`);
      return;
    }
    if (clause.startsWith("{")) {
      decls.push(`const ${clause.replace(/\s+as\s+/g, ": ")} = ${g};`);
      return;
    }
    const [def, ...rest] = clause.split(",");
    decls.push(`const ${def.trim()} = (${g} && ${g}.default !== undefined) ? ${g}.default : ${g};`);
    if (rest.length) {
      decls.push(`const ${rest.join(",").trim().replace(/\s+as\s+/g, ": ")} = ${g};`);
    }
  };

  src = src.replace(
    /^[ \t]*import\s+([^;]+?)\s+from\s+["']([^"']+)["'][ \t]*;?[ \t]*$/gm,
    (_m, clause, spec) => { declare(clause, spec); return ""; },
  );
  src = src.replace(/^[ \t]*import\s+["'][^"']+["'][ \t]*;?[ \t]*$/gm, "");
  src = decls.join("\n") + "\n" + src;

  const url = "data:text/javascript;base64," + Buffer.from(src).toString("base64");
  return import(url);
}

// Runs fn with Date.now() advanced by msAhead, then restores the real clock.
export function atTimeOffset(msAhead, fn) {
  const real = Date.now;
  Date.now = () => real.call(Date) + msAhead;
  try { return fn(); } finally { Date.now = real; }
}
