import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui';
import { resumo_admin_mensal, type ResumoAdminMes } from '../lib/financeService';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../utils/formatters';
import { buscarCotacaoDolar, calcularMes, COTACAO_PADRAO } from '../lib/dashboardAdmin';

const usd = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);

const rotuloMes = (mes: string) =>
  new Date(`${mes}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');

/** Dashboard do admin: entradas (vendas Hotmart) x custos (fixos + uso de serviços), últimos 6 meses. */
export default function AdminDashboard() {
  const [meses, setMeses] = useState<ResumoAdminMes[] | null>(null);
  const [ativas, setAtivas] = useState(0);
  const [canceladas, setCanceladas] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [cotacao, setCotacao] = useState<{ valor: number; em: Date | null; falhou: boolean }>({ valor: COTACAO_PADRAO, em: null, falhou: false });

  useEffect(() => {
    let ativo = true;
    Promise.all([
      resumo_admin_mensal(6),
      supabase.from('assinaturas').select('id', { count: 'exact', head: true }).eq('status', 'Ativo'),
      supabase.from('assinaturas').select('id', { count: 'exact', head: true }).eq('status', 'Cancelado'),
    ])
      .then(([resumo, ok, canc]) => {
        if (!ativo) return;
        if (ok.error) throw ok.error;
        if (canc.error) throw canc.error;
        setMeses(resumo);
        setAtivas(ok.count ?? 0);
        setCanceladas(canc.count ?? 0);
      })
      .catch((e) => ativo && setErro(e instanceof Error ? e.message : 'Falha ao carregar o dashboard.'));
    buscarCotacaoDolar()
      .then((c) => ativo && setCotacao({ valor: c.valor, em: c.em, falhou: false }))
      .catch(() => ativo && setCotacao({ valor: COTACAO_PADRAO, em: null, falhou: true }));
    return () => { ativo = false; };
  }, []);

  if (erro) {
    return <div role="alert" className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400 text-sm">{erro}</div>;
  }
  if (!meses) return <p className="text-sm text-slate-500">Carregando...</p>;

  const dados = meses.map((m) => ({ ...m, ...calcularMes(m, cotacao.valor), nome: rotuloMes(m.mes) }));
  const atual = dados[dados.length - 1];
  const custoMedio = ativas > 0 ? atual.despesas / ativas : 0;
  // shortcut: previsão = ativas x ticket médio (mês atual; senão 6 meses); plano anual não renova todo mês. Trocar por preço por plano se importar.
  const totalVendas = dados.reduce((t, m) => t + m.qtd_entradas, 0);
  const ticket = atual.qtd_entradas > 0
    ? atual.entradas / atual.qtd_entradas
    : totalVendas > 0 ? dados.reduce((t, m) => t + m.entradas, 0) / totalVendas : 0;
  const previsao = ativas * ticket;
  const cards = [
    { titulo: 'Receita bruta do mês', valor: formatCurrency(atual.entradas), dica: `${atual.qtd_entradas} venda(s) aprovada(s) na Hotmart (BRL)` },
    { titulo: 'Taxas da Hotmart', valor: formatCurrency(atual.taxas_hotmart), dica: 'Descontadas da receita bruta' },
    { titulo: 'Custos fixos', valor: formatCurrency(atual.custos_fixos), dica: 'Servidor, ferramentas, marketing... (não cancelados)' },
    { titulo: 'Serviços (OpenAI etc.)', valor: usd(atual.custo_servicos_usd), dica: `${formatCurrency(atual.servicosBrl)} em reais${atual.custo_servicos_brl ? ` (inclui ${formatCurrency(atual.custo_servicos_brl)} já em R$)` : ''}` },
    { titulo: 'Total de despesas', valor: formatCurrency(atual.despesas), dica: 'Taxas + custos fixos + serviços' },
    { titulo: 'Lucro líquido do mês', valor: formatCurrency(atual.lucro), dica: 'Receita bruta − total de despesas', cor: atual.lucro >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400' },
    { titulo: 'Custo médio por assinante', valor: formatCurrency(custoMedio), dica: 'Despesas do mês ÷ assinantes ativos' },
    { titulo: 'Assinantes ativos', valor: String(ativas), dica: 'Status Ativo agora' },
    { titulo: 'Assinantes cancelados', valor: String(canceladas), dica: 'Status Cancelado' },
    { titulo: 'Previsão próximo mês', valor: formatCurrency(previsao), dica: `${ativas} ativos × ticket médio ${formatCurrency(ticket)}` },
  ];

  return (
    <>
      <p className={`text-xs ${cotacao.falhou ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}`}>
        {cotacao.falhou
          ? `Cotação do dólar indisponível agora: usando US$ 1 = ${formatCurrency(cotacao.valor)} (valor padrão).`
          : `Cotação do dólar: US$ 1 = ${formatCurrency(cotacao.valor)}${cotacao.em ? ` (${cotacao.em.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })})` : ''}`}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card key={c.titulo}>
            <CardContent className="p-6">
              <p className="text-sm text-slate-500 mb-1">{c.titulo}</p>
              <p className={`text-2xl font-bold text-slate-900 dark:text-white ${c.cor ?? ''}`}>{c.valor}</p>
              <p className="text-xs text-slate-400 mt-1">{c.dica}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>Receita x despesas (últimos 6 meses)</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dados} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
              <XAxis dataKey="nome" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
              <Tooltip
                formatter={(v) => formatCurrency(Number(v))}
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Legend />
              <Bar dataKey="entradas" name="Entradas" fill="#10A36A" radius={[4, 4, 0, 0]} />
              <Bar dataKey="despesas" name="Despesas" fill="#EF4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-slate-400 mt-3">
            Despesas = taxas da Hotmart + custos fixos não cancelados (por vencimento) + serviços registrados (USD convertido pela cotação de hoje, também nos meses anteriores). O gasto real da OpenAI/Meta fica na aba Tokens / Uso.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
