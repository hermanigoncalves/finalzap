#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const modo = process.argv[2];

let entrada = {};
try {
  const bruto = readFileSync(0, "utf8").trim();
  if (bruto) entrada = JSON.parse(bruto);
} catch {
  entrada = {};
}

const citarWin = (valor) => (process.platform === "win32" && /\s/.test(valor) ? `"${valor}"` : valor);

function rodar(comando, args, cwd = process.cwd()) {
  const r = spawnSync(citarWin(comando), args.map(citarWin), {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const texto = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? `\n${r.error.message}` : ""}`.trim();
  return { ok: r.status === 0, saida: texto.split(/\r?\n/).slice(-40).join("\n") };
}

function encontrarEslint(arquivo) {
  const raiz = resolve(process.cwd());
  const binNome = process.platform === "win32" ? "eslint.cmd" : "eslint";
  let atual = dirname(resolve(raiz, arquivo));

  while (true) {
    const candidato = join(atual, "node_modules", ".bin", binNome);
    if (existsSync(candidato)) return { bin: candidato, dirPkg: atual };
    if (atual === raiz) break;
    const pai = dirname(atual);
    if (pai === atual) break;
    atual = pai;
  }

  const fallback = join(raiz, "node_modules", ".bin", binNome);
  return existsSync(fallback) ? { bin: fallback, dirPkg: raiz } : null;
}

if (modo === "apos-editar") {
  const arquivo = entrada.tool_input?.file_path ?? "";
  if (!/\.(tsx?|m?js|cjs|jsx)$/.test(arquivo)) process.exit(0);

  const local = encontrarEslint(arquivo);
  if (!local) {
    console.warn(`ESLint local não encontrado para ${arquivo}; pulando checagem pós-edição.`);
    process.exit(0);
  }

  const alvo = relative(local.dirPkg, resolve(process.cwd(), arquivo)) || arquivo;
  const { ok, saida } = rodar(local.bin, ["--max-warnings=0", alvo], local.dirPkg);
  if (!ok) {
    console.error(`ESLint reprovou ${arquivo}. Corrija agora:\n${saida}`);
    process.exit(2);
  }
  process.exit(0);
}

if (modo === "ao-parar") {
  if (entrada.stop_hook_active) process.exit(0);
  const { ok, saida } = rodar("npm", ["run", "verificar", "--silent"]);
  if (!ok) {
    console.error(`Ainda não está pronto: npm run verificar falhou.\n${saida}`);
    process.exit(2);
  }
  process.exit(0);
}

console.error(`Modo desconhecido: ${modo ?? "(vazio)"}`);
process.exit(1);
