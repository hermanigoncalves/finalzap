#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const RAIZ = process.cwd();
const PADRAO_ID = /\bR-(?:[A-Z]+-)?\d{2,3}\b/g;
const IGNORAR = new Set(["node_modules", "dist", ".git", "playwright-report", "test-results", "coverage"]);
const normalizar = (caminho) => caminho.replaceAll("\\", "/");

const PADRAO = {
  arquivoRegras: "docs/regras.md",
  ondeProcurar: [
    "src",
    "tests",
    "e2e",
    "frontend",
    "scripts",
    "api",
    "lib",
    "server",
    "bot-server",
    "eslint.config.js",
  ],
};

function lerJson(caminho) {
  const absoluto = join(RAIZ, caminho);
  return existsSync(absoluto) ? JSON.parse(readFileSync(absoluto, "utf8")) : null;
}

const config = { ...PADRAO, ...(lerJson("package.json")?.regras ?? {}) };

const ehVerificacao = (arquivo) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/i.test(arquivo) ||
  /(^|\/)(e2e|tests?|__tests__)\//.test(arquivo) ||
  /(^|\/)eslint\.config\.[cm]?[jt]s$/.test(arquivo) ||
  arquivo === "scripts/higiene.mjs";

function caminhar(caminho) {
  const absoluto = join(RAIZ, caminho);
  if (!existsSync(absoluto)) return [];
  if (!statSync(absoluto).isDirectory()) return [normalizar(caminho)];
  return readdirSync(absoluto, { withFileTypes: true }).flatMap((e) =>
    IGNORAR.has(e.name) ? [] : caminhar(normalizar(relative(RAIZ, join(absoluto, e.name)))),
  );
}

function regrasDeclaradas() {
  if (!existsSync(join(RAIZ, config.arquivoRegras))) {
    console.error(`Não achei ${config.arquivoRegras}.`);
    process.exit(1);
  }
  const ids = new Set();
  for (const linha of readFileSync(join(RAIZ, config.arquivoRegras), "utf8").split(/\r?\n/)) {
    const cabecalho = /^\s*(?:#{2,4}\s+|[-*]\s+\*\*)(R-(?:[A-Z]+-)?\d{2,3})\b/.exec(linha);
    if (cabecalho?.[1]) ids.add(cabecalho[1]);
  }
  return ids;
}

function referenciasNoCodigo() {
  const refs = new Map();
  const arquivos = [
    ...new Set(config.ondeProcurar.flatMap(caminhar).filter((a) => /\.(m?[jt]sx?|cjs)$/.test(a) && ehVerificacao(a))),
  ];
  for (const arquivo of arquivos) {
    if (arquivo === "scripts/regras-cobertas.mjs") continue;
    for (const id of readFileSync(join(RAIZ, arquivo), "utf8").match(PADRAO_ID) ?? []) {
      refs.set(id, [...new Set([...(refs.get(id) ?? []), arquivo])]);
    }
  }
  return refs;
}

const declaradas = regrasDeclaradas();
const refs = referenciasNoCodigo();
const semCobertura = [...declaradas].filter((id) => !refs.has(id));
const fantasmas = [...refs.keys()].filter((id) => !declaradas.has(id));

for (const id of declaradas) {
  const onde = refs.get(id);
  console.warn(
    `${onde ? "✓" : "✗"} ${id}${onde ? ` → ${onde.join(", ")}` : " → nenhum teste ou lint verifica esta regra"}`,
  );
}
for (const id of fantasmas) {
  console.warn(`✗ ${id} citado em ${(refs.get(id) ?? []).join(", ")} mas não existe em ${config.arquivoRegras}`);
}

if (semCobertura.length || fantasmas.length) {
  console.error(
    `\nRegras sem verificação: ${semCobertura.length}. Referências a regras inexistentes: ${fantasmas.length}.`,
  );
  console.error("Regra sem checagem é só prosa: o agente pode ignorar. Escreva o teste com o ID no nome.");
  process.exit(1);
}
console.warn(`\n${declaradas.size} regra(s), todas verificadas.`);
