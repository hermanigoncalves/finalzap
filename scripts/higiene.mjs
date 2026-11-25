#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, posix, relative } from "node:path";

const RAIZ = process.cwd();
const ARQUIVO_BASELINE = ".higiene-baseline.json";
const normalizar = (caminho) => caminho.replaceAll("\\", "/");

const PADRAO = {
  pastasDeCodigo: ["src", "frontend/src", "api", "lib", "server", "bot-server/src"],
  pastaMigrations: "supabase/migrations",
  mdPermitidosNaRaiz: ["README.md", "AGENTS.md", "CLAUDE.md", "CHANGELOG.md", "MIGRAR.md"],
  orcamentoProsaAgente: 400,
  orcamentoComentariosPorArquivo: 3,
  tamanhoMaximoBinarioKb: 1024,
  pastasDeBinarioPermitidas: ["public", "src/assets"],
};

const config = { ...PADRAO, ...(lerJson("package.json")?.higiene ?? {}) };

function lerJson(caminho) {
  const absoluto = join(RAIZ, caminho);
  return existsSync(absoluto) ? JSON.parse(readFileSync(absoluto, "utf8")) : null;
}

function listarArquivos() {
  try {
    const saida = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      cwd: RAIZ,
      encoding: "utf8",
    });
    return saida
      .split(/\r?\n/)
      .map(normalizar)
      .filter((arquivo) => arquivo && existsSync(join(RAIZ, arquivo)));
  } catch {
    return caminhar(RAIZ);
  }
}

function caminhar(pasta) {
  const ignorar = new Set(["node_modules", ".git", "dist", "playwright-report", "test-results", "coverage"]);
  return readdirSync(pasta, { withFileTypes: true }).flatMap((entrada) => {
    if (ignorar.has(entrada.name)) return [];
    const caminho = join(pasta, entrada.name);
    return entrada.isDirectory() ? caminhar(caminho) : [normalizar(relative(RAIZ, caminho))];
  });
}

const ehCodigo = (arquivo) => [".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"].includes(extname(arquivo));
const ehTeste = (arquivo) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(arquivo) || arquivo.startsWith("e2e/");
const naPastaDeCodigo = (arquivo) => config.pastasDeCodigo.some((pasta) => arquivo.startsWith(`${pasta}/`));

const checagens = [
  {
    id: "H01",
    descricao: "SQL só dentro de supabase/migrations (ou supabase/seed.sql)",
    verificar: (arquivos) =>
      arquivos
        .filter((a) => a.endsWith(".sql"))
        .filter((a) => posix.dirname(a) !== config.pastaMigrations && a !== "supabase/seed.sql")
        .map((a) => `${a}: mova para ${config.pastaMigrations}/ com nome datado ou apague`),
  },
  {
    id: "H02",
    descricao: "Migrations nomeadas AAAAMMDDHHMMSS_descricao.sql",
    verificar: (arquivos) =>
      arquivos
        .filter((a) => posix.dirname(a) === config.pastaMigrations && a.endsWith(".sql"))
        .filter((a) => !/^\d{14}_[a-z0-9_-]+\.sql$/.test(basename(a)))
        .map((a) => `${a}: nome fora do padrão`),
  },
  {
    id: "H03",
    descricao: "Markdown solto na raiz vai para docs/",
    verificar: (arquivos) =>
      arquivos
        .filter((a) => !a.includes("/") && a.endsWith(".md") && !config.mdPermitidosNaRaiz.includes(a))
        .map((a) => `${a}: mova para docs/ ou apague`),
  },
  {
    id: "H04",
    descricao: `Prosa para agentes cabe em ${config.orcamentoProsaAgente} linhas (vire regra em lint/teste)`,
    verificar: (arquivos) => {
      const prosa = arquivos.filter(
        (a) =>
          ["AGENTS.md", "CLAUDE.md", "GEMINI.md"].includes(a) ||
          /^\.(agent|agents|claude|codex|cursor|gemini)\/.*\.(md|mdc)$/.test(a),
      );
      const total = prosa.reduce((soma, a) => soma + contarLinhas(a), 0);
      return total > config.orcamentoProsaAgente
        ? [`${total} linhas de prosa em ${prosa.length} arquivos (orçamento ${config.orcamentoProsaAgente})`]
        : [];
    },
  },
  {
    id: "H05",
    descricao: "Sem scripts de teste/gambiarra soltos na raiz",
    verificar: (arquivos) =>
      arquivos
        .filter((a) => !a.includes("/") && ehCodigo(a))
        .filter((a) => /^(test|teste|fix|tmp|temp|debug|verify|run)[-_]/i.test(a))
        .map((a) => `${a}: vire teste em src/ ou script em scripts/`),
  },
  {
    id: "H06",
    descricao: `No máximo ${config.orcamentoComentariosPorArquivo} linhas de comentário por arquivo de código`,
    verificar: (arquivos) =>
      arquivos
        .filter((a) => ehCodigo(a) && naPastaDeCodigo(a) && !ehTeste(a))
        .map((a) => [a, contarComentarios(a)])
        .filter(([, total]) => total > config.orcamentoComentariosPorArquivo)
        .map(([a, total]) => `${a}: ${total} linhas de comentário. Código claro dispensa explicação`),
  },
  {
    id: "H07",
    descricao: "Todo eslint-disable precisa de motivo (-- porque ...)",
    verificar: (arquivos) =>
      arquivos
        .filter((a) => ehCodigo(a) && naPastaDeCodigo(a))
        .flatMap((a) =>
          lerLinhas(a)
            .map((linha, i) => [linha, i + 1])
            .filter(([linha]) => /eslint-disable/.test(linha) && !/eslint-disable[^\n]*--\s*\S/.test(linha))
            .map(([, n]) => `${a}:${n}: eslint-disable sem motivo`),
        ),
  },
  {
    id: "H08",
    descricao: "Nenhum .env real versionado",
    verificar: (arquivos) =>
      arquivos
        .filter((a) => /(^|\/)\.env(\.|$)/.test(a) && !a.endsWith(".env.example"))
        .map((a) => `${a}: segredo no repositório`),
  },
  {
    id: "H09",
    descricao: `Binários acima de ${config.tamanhoMaximoBinarioKb} KB só em public/ ou src/assets/`,
    verificar: (arquivos) =>
      arquivos
        .filter((a) => !config.pastasDeBinarioPermitidas.some((p) => a.startsWith(`${p}/`)))
        .filter((a) => !a.endsWith("package-lock.json") && !a.endsWith(".lockb"))
        .filter((a) => statSync(join(RAIZ, a)).size > config.tamanhoMaximoBinarioKb * 1024)
        .map((a) => `${a}: ${Math.round(statSync(join(RAIZ, a)).size / 1024)} KB`),
  },
];

function lerLinhas(arquivo) {
  return readFileSync(join(RAIZ, arquivo), "utf8").split(/\r?\n/);
}

function contarLinhas(arquivo) {
  return lerLinhas(arquivo).length;
}

function contarComentarios(arquivo) {
  let dentroDeBloco = false;
  let total = 0;
  for (const bruta of lerLinhas(arquivo)) {
    const linha = bruta.trim();
    const diretiva = /^(\/\/|\/\*)\s*(@ts-expect-error|eslint-disable|@vitest-environment)/.test(linha);
    if (dentroDeBloco) {
      total += 1;
      if (linha.includes("*/")) dentroDeBloco = false;
    } else if (linha.startsWith("/*") && !diretiva) {
      total += 1;
      dentroDeBloco = !linha.includes("*/");
    } else if (linha.startsWith("//") && !diretiva) {
      total += 1;
    }
  }
  return total;
}

function executar() {
  const arquivos = listarArquivos();
  const gerarBaseline = process.argv.includes("--gerar-baseline");
  const baseline = new Set(gerarBaseline ? [] : (lerJson(ARQUIVO_BASELINE) ?? []));
  const todas = [];
  let novas = 0;

  for (const checagem of checagens) {
    const violacoes = checagem.verificar(arquivos).map((msg) => `${checagem.id} ${msg}`);
    todas.push(...violacoes);
    const novasDaChecagem = violacoes.filter((v) => !baseline.has(v));
    const herdadas = violacoes.length - novasDaChecagem.length;
    novas += novasDaChecagem.length;
    const status = novasDaChecagem.length ? "✗" : "✓";
    const sufixo = herdadas ? ` (${herdadas} herdada(s) na baseline)` : "";
    console.warn(`${status} ${checagem.id} ${checagem.descricao}${sufixo}`);
    for (const v of novasDaChecagem) console.warn(`    ${v}`);
  }

  if (gerarBaseline) {
    writeFileSync(join(RAIZ, ARQUIVO_BASELINE), `${JSON.stringify(todas.sort(), null, 2)}\n`);
    console.warn(`\nBaseline gravada com ${todas.length} violação(ões). Ela só pode diminuir.`);
    return;
  }

  const resolvidas = [...baseline].filter((v) => !todas.includes(v));
  if (resolvidas.length) {
    console.warn(
      `\n${resolvidas.length} violação(ões) da baseline foram resolvidas. Rode: npm run higiene -- --gerar-baseline`,
    );
  }
  if (novas) {
    console.error(`\nHigiene falhou: ${novas} violação(ões) nova(s).`);
    process.exit(1);
  }
  console.warn("\nHigiene ok.");
}

executar();
