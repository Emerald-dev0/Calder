import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Server Component → Client Component boundary guard.
 *
 * React serialises props across the RSC boundary. A function cannot be
 * serialised (unless it is a Server Action), so passing one throws at render
 * time:
 *
 *   Functions cannot be passed directly to Client Components unless you
 *   explicitly expose it by marking it with "use server".
 *
 * In production the user sees only "Application error: a server-side exception
 * has occurred" plus a digest — which is how /control went down. TypeScript
 * cannot catch it either, because the client component's prop type accepts any
 * matching function; the mistake is legal at compile time and fatal at runtime.
 *
 * So this test reads every Server Component under apps/dashboard and fails if
 * it hands a function to a child:
 *
 *   1. a function literal (arrow or `function`) anywhere in a JSX attribute,
 *      including nested in an object or array (`columns={[{ render: () => … }]}`);
 *   2. an identifier that resolves to a function declared in the same file
 *      (`footer={formatRow}`).
 *
 * Both are safe to place in a *Server* Component's child, which the type system
 * cannot distinguish, so a legitimate case can opt out on the line itself or the
 * line above with `// rsc-boundary-allow: <reason>`.
 *
 * The proven fix for the Control charts is in components/charts/footer.ts: the
 * footer is described as data and computed inside the Client Component.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, "..");
const SCANNED_DIRS = ["app", "components"];
const ALLOW_MARKER = "rsc-boundary-allow";

interface Violation {
  file: string;
  line: number;
  prop: string;
  detail: string;
}

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkTsx(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** The module-level directive on a file, if it has one. */
function directiveOf(source: ts.SourceFile): string | null {
  const [first] = source.statements;
  if (!first || !ts.isExpressionStatement(first)) return null;
  const expression = first.expression;
  return ts.isStringLiteral(expression) ? expression.text : null;
}

/**
 * An inline `async (formData) => { "use server"; … }` is a Server Action, not a
 * value crossing the boundary: the compiler replaces it with a reference the
 * client can call. Every `<form action={…}>` in the Control Plane uses this.
 */
function isServerAction(node: ts.Node): boolean {
  if (!isFunctionLike(node)) return false;
  const body = (node as ts.FunctionLikeDeclaration).body;
  if (!body || !ts.isBlock(body)) return false;
  const [first] = body.statements;
  return (
    !!first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use server"
  );
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)
  );
}

/** Names bound to functions at the top level of the file. */
function fileFunctionNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const remember = (name: ts.BindingName | undefined): void => {
    if (name && ts.isIdentifier(name)) names.add(name.text);
  };
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      remember(statement.name);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer && isFunctionLike(declaration.initializer)) {
          remember(declaration.name);
        }
      }
    }
  }
  return names;
}

/**
 * Is the *value* of this expression a function?
 *
 * Only structural wrappers are followed — parentheses, assertions, arrays,
 * object literals, conditionals and `??`/`||`/`&&` — because they pass their
 * operand through untouched. Anything else is recomputed into data on the
 * server before it crosses: `projects.map((p) => p.id)` yields an array of
 * ids, and the callback never leaves the process. Stopping at call expressions
 * is what keeps this rule about the boundary instead of about arrow functions
 * in general.
 */
function findFunctionValue(node: ts.Node): ts.Node | null {
  if (isFunctionLike(node)) return isServerAction(node) ? null : node;
  const descend = (child: ts.Node | undefined): ts.Node | null =>
    child ? findFunctionValue(child) : null;

  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return descend(node.expression);
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      const found = descend(element);
      if (found) return found;
    }
    return null;
  }
  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        const found = descend(property.initializer);
        if (found) return found;
      } else if (ts.isSpreadAssignment(property)) {
        const found = descend(property.expression);
        if (found) return found;
      }
    }
    return null;
  }
  if (ts.isConditionalExpression(node)) {
    return descend(node.whenTrue) ?? descend(node.whenFalse);
  }
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    const passthrough =
      operator === ts.SyntaxKind.QuestionQuestionToken ||
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.AmpersandAmpersandToken;
    return passthrough ? (descend(node.left) ?? descend(node.right)) : null;
  }
  return null;
}

function lineIsAllowed(lines: string[], line: number): boolean {
  // `line` is 1-based. Check the attribute's line and the one above it, which
  // is where a multi-line JSX attribute would naturally carry the note.
  const current = lines[line - 1] ?? "";
  const previous = lines[line - 2] ?? "";
  return current.includes(ALLOW_MARKER) || previous.includes(ALLOW_MARKER);
}

export function findBoundaryViolations(file: string, text: string): Violation[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // Client modules receive props; Server Action modules export callables. The
  // rule applies to the file in between: a Server Component.
  if (directiveOf(source) !== null) return [];

  const lines = text.split("\n");
  const functions = fileFunctionNames(source);
  const violations: Violation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer)) {
      const expression = node.initializer.expression;
      if (expression) {
        const literal = findFunctionValue(expression);
        const identifier =
          ts.isIdentifier(expression) && functions.has(expression.text) ? expression : null;
        const offending = literal ?? identifier;
        if (offending) {
          const { line } = source.getLineAndCharacterOfPosition(offending.getStart(source));
          const prop = node.name.getText(source);
          if (!lineIsAllowed(lines, line + 1)) {
            violations.push({
              file,
              line: line + 1,
              prop,
              detail: literal
                ? "passes a function literal"
                : `passes \`${expression.getText(source)}\`, a function declared in this file`,
            });
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  return violations;
}

describe("server → client component boundary", () => {
  const files = SCANNED_DIRS.flatMap((dir) => walkTsx(join(PACKAGE_ROOT, dir)));

  it("scans the dashboard's components", () => {
    // Guards the guard: a broken path or filter would otherwise report a
    // clean bill of health while scanning nothing.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith("control/page.tsx"))).toBe(true);
  });

  it("no Server Component passes a function to a child component", () => {
    const violations = files.flatMap((file) =>
      findBoundaryViolations(relative(PACKAGE_ROOT, file), readFileSync(file, "utf8"))
    );

    const report = violations
      .map((v) => `  ${v.file}:${v.line}  prop \`${v.prop}\` ${v.detail}`)
      .join("\n");

    expect(
      violations,
      violations.length === 0
        ? ""
        : `These Server Components pass a function across the RSC boundary and will crash\n` +
            `at render with "Functions cannot be passed directly to Client Components".\n` +
            `Pass plain data instead (see components/charts/footer.ts), or mark the prop\n` +
            `"use server" if it really is a Server Action.\n\n${report}\n`
    ).toEqual([]);
  });
});

describe("the boundary rule itself", () => {
  const check = (source: string) => findBoundaryViolations("sample.tsx", source);

  it("flags a function literal handed straight to a child", () => {
    const found = check(`
      export default function Page() {
        return <TrendChart footer={(row) => String(row.x)} />;
      }
    `);
    expect(found).toHaveLength(1);
    expect(found[0]!.prop).toBe("footer");
  });

  it("flags a function nested in an array or object literal", () => {
    const found = check(`
      export default function Page() {
        return <Table columns={[{ key: "a", render: () => "x" }]} />;
      }
    `);
    expect(found).toHaveLength(1);
    expect(found[0]!.prop).toBe("columns");
  });

  it("flags an identifier that resolves to a function in the same file", () => {
    const found = check(`
      const formatRow = (row) => row.id;
      export default function Page() {
        return <Chart footer={formatRow} />;
      }
    `);
    expect(found).toHaveLength(1);
    expect(found[0]!.detail).toContain("formatRow");
  });

  it("allows values computed on the server with a callback", () => {
    // The callback runs in the Server Component; the child receives an array.
    expect(
      check(`
        export default function Page({ projects }) {
          return <Picker items={projects.map((p) => ({ id: p.id }))} total={projects.reduce((n) => n + 1, 0)} />;
        }
      `)
    ).toEqual([]);
  });

  it("allows inline Server Actions", () => {
    expect(
      check(`
        export default function Page() {
          return (
            <form action={async (formData) => {
              "use server";
              return formData;
            }} />
          );
        }
      `)
    ).toEqual([]);
  });

  it("ignores client modules and server action modules", () => {
    const body = `
      export function Chart() {
        return <Thing footer={(row) => String(row.x)} />;
      }`;
    expect(
      check(`"use client";
${body}`)
    ).toEqual([]);
    expect(
      check(`"use server";
${body}`)
    ).toEqual([]);
  });

  it("lets a reviewed exception opt out on the line", () => {
    expect(
      check(`
        export default function Page() {
          return <ServerOnlyThing render={(row) => row.id} />; // rsc-boundary-allow: server component child
        }
      `)
    ).toEqual([]);
  });
});
