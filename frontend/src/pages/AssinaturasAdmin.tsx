import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Modal } from '../components/ui';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useFinance } from '../hooks/useFinance';
import type { TipoAssinatura, CustoFixo, UsoServico } from '../lib/financeService';
import { cadastrar_custo_fixo_recorrente, listar_todas_assinaturas, listar_todo_uso_servico, listar_todos_custos_fixos } from '../lib/financeService';
import { Plus, Edit, Trash2, Save, Check, Mail } from 'lucide-react';
import { traduzirRespostaReenvio } from '../lib/reenvio';
import AdminDashboard from './AdminDashboard';
import FiltroPeriodo from '../components/FiltroPeriodo';
import { noPeriodo, periodoMesAtual, periodoValido, type Periodo } from '../lib/dashboardAdmin';
import { hojeISO } from '../lib/datas';

const STATUS_CORES: Record<string, string> = {
  Ativo: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800/50',
  Inativo: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700',
  Cancelado: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 border-red-200 dark:border-red-800/40',
  Inadimplente: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border-amber-200 dark:border-amber-800/40',
};

type Tab = 'dashboard' | 'assinaturas' | 'tokens' | 'custos' | 'whatsapp';

const STATUS_WAHA: Record<string, string> = {
  WORKING: 'Conectado',
  SCAN_QR_CODE: 'Aguardando leitura do QR Code',
  STARTING: 'Iniciando...',
  STOPPED: 'Parado',
  FAILED: 'Falhou',
};

export default function Administrador() {
  const {
    loading,
    error,
    cadastrar_assinatura,
    atualizar_assinatura,
    remover_assinatura,
    cadastrar_custo_fixo,
    atualizar_custo_fixo,
    remover_custo_fixo,
    formatar_moeda_brl,
  } = useFinance();

  const [assinaturas, setAssinaturas] = useState<TipoAssinatura[]>([]);
  const [custosFixos, setCustosFixos] = useState<CustoFixo[]>([]);
  const [params] = useSearchParams();
  const abaUrl = params.get('aba');
  const tab: Tab = abaUrl === 'tokens' || abaUrl === 'custos' || abaUrl === 'assinaturas' || abaUrl === 'whatsapp' ? abaUrl : 'dashboard';
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [custoModalOpen, setCustoModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [custoEditId, setCustoEditId] = useState<string | null>(null);
  const [usos, setUsos] = useState<UsoServico[]>([]);
  const [aoVivo, setAoVivo] = useState(false);
  const [credenciais, setCredenciais] = useState<{ chave: string; configurada: boolean; final: string | null }[]>([]);
  const [credValores, setCredValores] = useState<Record<string, string>>({});
  const [credMsg, setCredMsg] = useState<string | null>(null);
  const [openaiCusto, setOpenaiCusto] = useState<{ total: number; moeda: string } | null>(null);
  const [openaiErro, setOpenaiErro] = useState<string | null>(null);
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [waha, setWaha] = useState<{ session?: string; status: string; me: { id?: string; pushName?: string } | null; qr: string | null } | null>(null);
  const [wahaErro, setWahaErro] = useState<string | null>(null);
  const [wahaCarregando, setWahaCarregando] = useState(false);
  const wahaRef = useRef(waha);
  wahaRef.current = waha;
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoMesAtual(hojeISO()));
  const periodoRef = useRef(periodo);
  periodoRef.current = periodo;
  const formVazio = {
    telefone: '',
    nome: '',
    email: '',
    hotmart_id: '',
    plano: 'Mensal',
    status: 'Ativo' as TipoAssinatura['status'],
    data_inicio: '',
    data_vencimento: '',
    metodo_pagamento: '',
  };
  const [form, setForm] = useState(formVazio);
  const [custoForm, setCustoForm] = useState({
    descricao: '',
    valor: '',
    categoria: 'servidor' as CustoFixo['categoria'],
    vencimento: '',
    status: 'pendente' as CustoFixo['status'],
    recorrente: false,
    meses: '12',
  });

  const carregar = async () => {
    try {
      setErroLocal(null);
      setAssinaturas(await listar_todas_assinaturas());
      setCustosFixos(await listar_todos_custos_fixos());
      const { inicio, fim } = periodoRef.current;
      setUsos(periodoValido(periodoRef.current) ? await listar_todo_uso_servico(inicio, fim) : []);
    } catch {
      setErroLocal('Não foi possível carregar os dados administrativos.');
    }
  };

  const chamarApi = async (url: string, init: RequestInit = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Sessão expirada.');
    const res = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof json?.error === 'string' && json.error ? json.error : 'Falha na consulta.');
    return json;
  };

  const carregarOpenai = async () => {
    setOpenaiErro(null);
    try {
      const json = await chamarApi('/api/admin/openai-custos');
      if (typeof json?.total !== 'number') throw new Error('Resposta inválida');
      setOpenaiCusto(json);
    } catch (e) {
      setOpenaiCusto(null);
      setOpenaiErro(e instanceof Error && e.message === 'Sessão expirada.' ? 'Sessão expirada.' : 'Não foi possível consultar os custos da OpenAI.');
    }
  };

  const carregarCredenciais = async () => {
    try {
      setCredenciais((await chamarApi('/api/admin/credenciais')).credenciais ?? []);
    } catch (e) {
      setCredMsg(e instanceof Error && e.message === 'Sessão expirada.' ? 'Sessão expirada.' : 'Não foi possível carregar as credenciais.');
    }
  };

  const salvarCredencial = async (chave: string, valor: string) => {
    setCredMsg(null);
    try {
      const json = await chamarApi('/api/admin/credenciais', { method: 'PUT', body: JSON.stringify({ chave, valor }) });
      setCredenciais(json.credenciais ?? []);
      setCredValores((v) => ({ ...v, [chave]: '' }));
      setCredMsg(valor ? 'Credencial salva.' : 'Credencial removida.');
      void carregarOpenai();
    } catch (e) {
      setCredMsg(e instanceof Error && e.message === 'Sessão expirada.' ? 'Sessão expirada.' : 'Não foi possível salvar a credencial.');
    }
  };

  const consultarWaha = async (acao?: string, extra: Record<string, string> = {}) => {
    setWahaCarregando(true);
    setWahaErro(null);
    try {
      setWaha(await chamarApi('/api/admin/waha', acao ? { method: 'POST', body: JSON.stringify({ acao, ...extra }) } : {}));
    } catch (e) {
      setWaha(null);
      setWahaErro(e instanceof Error && e.message !== 'Falha na consulta.' ? e.message : 'Não foi possível consultar o WAHA.');
    } finally {
      setWahaCarregando(false);
    }
  };

  useEffect(() => {
    if (tab !== 'whatsapp') return;
    void consultarWaha();
    const t = setInterval(() => { if (wahaRef.current?.status === 'SCAN_QR_CODE') void consultarWaha(); }, 5000);
    return () => clearInterval(t);
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps -- recarregar só ao trocar de aba

  useEffect(() => {
    if (tab !== 'tokens') return;
    void carregarOpenai();
    void carregarCredenciais();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps -- recarregar só ao trocar de aba

  const executar = async (acao: () => Promise<unknown>): Promise<boolean> => {
    try {
      setErroLocal(null);
      await acao();
      return true;
    } catch {
      setErroLocal('Não foi possível concluir a operação.');
      return false;
    }
  };

  useEffect(() => {
    void carregar();
  }, [periodo]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const agendar = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = undefined; void carregar(); }, 30_000);
    };
    const canal = supabase
      .channel('admin-tempo-real')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'uso_servico' }, agendar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assinaturas' }, agendar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'custos_fixos' }, agendar)
      .subscribe((status) => setAoVivo(status === 'SUBSCRIBED'));

    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(canal);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-center">
          <h2 className="text-red-500 dark:text-red-400 text-xl font-bold mb-2">Erro</h2>
          <p className="text-slate-400">Não foi possível carregar os dados. Tente novamente.</p>
        </div>
      </div>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editId && (!form.hotmart_id || !form.data_inicio || !form.data_vencimento)) {
      alert('Preencha Hotmart ID, data da venda e data de vencimento/recebimento.');
      return;
    }

    const ok = await executar(() =>
      editId
        ? atualizar_assinatura(editId, {
            nome: form.nome,
            email: form.email,
            hotmart_id: form.hotmart_id,
            plano: form.plano,
            status: form.status,
            data_inicio: form.data_inicio,
            data_vencimento: form.data_vencimento,
            metodo_pagamento: form.metodo_pagamento,
          })
        : cadastrar_assinatura({ ...form })
    );
    if (!ok) return;

    setIsModalOpen(false);
    setEditId(null);
    setForm(formVazio);
    await carregar();
  };

  const handleEditar = (a: TipoAssinatura) => {
    setEditId(a.id);
    setForm({
      telefone: a.telefone ?? '',
      nome: a.nome ?? '',
      email: a.email ?? '',
      hotmart_id: a.hotmart_id ?? '',
      plano: a.plano ?? 'Mensal',
      status: a.status,
      data_inicio: a.data_inicio?.slice(0, 10) ?? '',
      data_vencimento: a.data_vencimento?.slice(0, 10) ?? '',
      metodo_pagamento: a.metodo_pagamento ?? '',
    });
    setIsModalOpen(true);
  };

  const handleReenviar = async (id: string) => {
    if (!window.confirm('Reenviar o convite de acesso para o e-mail desta assinatura?')) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Sessão expirada.');
      const res = await fetch('/api/admin/reenviar-convite', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ assinaturaId: id }),
      });
      const r = traduzirRespostaReenvio(res.status, await res.json().catch(() => ({})));
      alert(r.ok ? (r.tipo === 'convite' ? 'Convite reenviado.' : 'E-mail de redefinição de senha enviado.') : r.motivo);
    } catch (e) {
      alert(e instanceof Error && e.message === 'Sessão expirada.' ? 'Sessão expirada. Entre novamente.' : 'Não foi possível reenviar o convite agora.');
    }
  };

  const handleExcluir = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir esta assinatura?')) return;
    if (await executar(() => remover_assinatura(id))) await carregar();
  };

  const handleCustoSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!custoForm.descricao || !custoForm.valor || !custoForm.vencimento) {
      alert('Preencha descrição, valor e vencimento.');
      return;
    }

    const valor = parseFloat(custoForm.valor.replace(',', '.'));
    if (!isFinite(valor) || valor <= 0) {
      alert('Valor inválido.');
      return;
    }

    const meses = Number(custoForm.meses);
    if (!custoEditId && custoForm.recorrente && (!Number.isInteger(meses) || meses < 2 || meses > 60)) {
      alert('Informe de 2 a 60 meses.');
      return;
    }

    const ok = await executar(() =>
      custoEditId
        ? atualizar_custo_fixo(custoEditId, {
            descricao: custoForm.descricao,
            valor,
            categoria: custoForm.categoria,
            vencimento: custoForm.vencimento,
            status: custoForm.status,
          })
        : custoForm.recorrente
          ? cadastrar_custo_fixo_recorrente({
              descricao: custoForm.descricao,
              valor,
              categoria: custoForm.categoria,
              vencimento: custoForm.vencimento,
              status: custoForm.status === 'cancelado' ? 'pendente' : custoForm.status,
            }, meses)
          : cadastrar_custo_fixo({
              descricao: custoForm.descricao,
              valor,
              categoria: custoForm.categoria,
              vencimento: custoForm.vencimento,
              status: custoForm.status === 'cancelado' ? 'pendente' : custoForm.status,
            })
    );
    if (!ok) return;

    setCustoModalOpen(false);
    setCustoEditId(null);
    setCustoForm({
      descricao: '',
      valor: '',
      categoria: 'servidor',
      vencimento: '',
      status: 'pendente',
      recorrente: false,
      meses: '12',
    });
    await carregar();
  };

  const handleCustoEditar = (c: CustoFixo) => {
    setCustoEditId(c.id);
    setCustoForm({
      descricao: c.descricao,
      valor: String(c.valor),
      categoria: c.categoria,
      vencimento: c.vencimento,
      status: c.status,
      recorrente: false,
      meses: '12',
    });
    setCustoModalOpen(true);
  };

  const handleCustoExcluir = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este custo fixo?')) return;
    if (await executar(() => remover_custo_fixo(id))) await carregar();
  };

  const handleCustoPagar = async (id: string) => {
    if (await executar(() => atualizar_custo_fixo(id, { status: 'pago' }))) await carregar();
  };

  const assinaturasPeriodo = assinaturas.filter((a) => noPeriodo(a.data_inicio ?? a.created_at, periodo));
  const custosPeriodo = custosFixos.filter((c) => noPeriodo(c.vencimento, periodo));
  const resumoUso = usos
    .reduce<Record<string, { custo: number; tokens: number }>>((acc, u) => {
      const r = acc[u.servico] || { custo: 0, tokens: 0 };
      r.custo += Number(u.custo_brl || 0);
      r.tokens += Number(u.tokens_entrada || 0) + Number(u.tokens_saida || 0);
      acc[u.servico] = r;
      return acc;
    }, {});

  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">Administrador FinalZap</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">
          Controle de assinaturas (Hotmart), uso de tokens (OpenAI/WhatsApp) e custos fixos do negócio.
        </p>
      </div>

      <FiltroPeriodo valor={periodo} onChange={setPeriodo} />

      {erroLocal && (
        <div role="alert" className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400 text-sm">
          {erroLocal}
        </div>
      )}

      {tab === 'dashboard' && <AdminDashboard periodo={periodo} />}
      {tab === 'assinaturas' && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <Card>
                <CardContent className="p-6">
                  <p className="text-sm text-slate-500 mb-1">Assinaturas no período</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{assinaturasPeriodo.length}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Ativas: {assinaturasPeriodo.filter(a => a.status === 'Ativo').length}
                  </p>
                </CardContent>
              </Card>
            </div>
            <Button onClick={() => { setEditId(null); setIsModalOpen(true); }}>
              <Plus size={18} className="mr-2" />
              Nova Assinatura
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
                    <tr>
                      <th className="px-6 py-4 font-medium">Cliente</th>
                      <th className="px-6 py-4 font-medium">Hotmart ID</th>
                      <th className="px-6 py-4 font-medium">Plano</th>
                      <th className="px-6 py-4 font-medium">Status</th>
                      <th className="px-6 py-4 font-medium text-center">Venda (Início)</th>
                      <th className="px-6 py-4 font-medium text-center">Vencimento (Recebimento)</th>
                      <th className="px-6 py-4 font-medium text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {assinaturasPeriodo.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-8 text-center text-slate-400">
                          Nenhuma assinatura cadastrada.
                        </td>
                      </tr>
                    ) : (
                      assinaturasPeriodo.map((a) => (
                        <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 font-medium">
                                {(a.nome || a.email || '?').charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-medium text-slate-900 dark:text-white">{a.nome}</p>
                                <p className="text-xs text-slate-500">{a.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-slate-500 dark:text-slate-400 font-mono">{a.hotmart_id}</td>
                          <td className="px-6 py-4 text-slate-700 dark:text-slate-300">{a.plano}</td>
                          <td className="px-6 py-4">
                            <Badge variant="outline" className={STATUS_CORES[a.status]}>{a.status}</Badge>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <p className="text-sm text-slate-900 dark:text-white">{a.data_inicio?.slice(0, 10) ?? '—'}</p>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <p className="text-sm font-bold text-slate-900 dark:text-white">{a.data_vencimento?.slice(0, 10) ?? '—'}</p>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={() => handleEditar(a)} className="h-8 w-8 p-0 text-slate-400 hover:text-green-600">
                                <Edit size={16} />
                              </Button>
                              <Button variant="ghost" size="sm" title="Reenviar convite" onClick={() => handleReenviar(a.id)} className="h-8 w-8 p-0 text-slate-400 hover:text-blue-600">
                                <Mail size={16} />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => handleExcluir(a.id)} className="h-8 w-8 p-0 text-slate-400 hover:text-red-500">
                                <Trash2 size={16} />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editId ? 'Editar Assinatura' : 'Nova Assinatura'}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Telefone</label>
              <input required={!editId} type="tel" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Nome</label>
              <input required={!editId} type="text" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none" />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">E-mail</label>
            <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Hotmart ID</label>
              <input required={!editId} type="text" value={form.hotmart_id} onChange={(e) => setForm({ ...form, hotmart_id: e.target.value })} className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Plano</label>
              <select value={form.plano} onChange={(e) => setForm({ ...form, plano: e.target.value })} className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none">
                <option>Mensal</option>
                <option>Anual</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TipoAssinatura['status'] })} className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none">
                <option>Ativo</option>
                <option>Inativo</option>
                <option>Cancelado</option>
                <option>Inadimplente</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Método de pagamento</label>
              <input type="text" value={form.metodo_pagamento} onChange={(e) => setForm({ ...form, metodo_pagamento: e.target.value })} placeholder="Cartão, Pix, Boleto..." className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Data da Venda (Início)</label>
              <input required={!editId} type="date" value={form.data_inicio} onChange={(e) => setForm({ ...form, data_inicio: e.target.value })} className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none" />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Data de Vencimento / Recebimento</label>
              <input required={!editId} type="date" value={form.data_vencimento} onChange={(e) => setForm({ ...form, data_vencimento: e.target.value })} className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none" />
            </div>
          </div>
          <div className="flex gap-3 pt-4 border-t border-slate-100 dark:border-slate-800 mt-6">
            <Button type="button" variant="outline" className="w-full" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
            <Button type="submit" className="w-full">
              {editId ? (
                <>
                  <Save size={18} className="mr-2" />
                  Salvar Alterações
                </>
              ) : (
                <>
                  <Plus size={18} className="mr-2" />
                  Cadastrar Assinatura
                </>
              )}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={custoModalOpen}
        onClose={() => setCustoModalOpen(false)}
        title={custoEditId ? 'Editar Custo Fixo' : 'Novo Custo Fixo'}
      >
        <form onSubmit={handleCustoSave} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Descrição</label>
            <input
              required
              type="text"
              placeholder="Ex: Servidor VPS, Ferramenta de SEO, Marketing"
              value={custoForm.descricao}
              onChange={(e) => setCustoForm({ ...custoForm, descricao: e.target.value })}
              className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Valor (R$)</label>
              <input
                required
                type="number"
                step="0.01"
                placeholder="0.00"
                value={custoForm.valor}
                onChange={(e) => setCustoForm({ ...custoForm, valor: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Categoria</label>
              <select
                value={custoForm.categoria}
                onChange={(e) => setCustoForm({ ...custoForm, categoria: e.target.value as CustoFixo['categoria'] })}
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none"
              >
                <option value="servidor">Servidor</option>
                <option value="ferramenta">Ferramenta</option>
                <option value="marketing">Marketing</option>
                <option value="telefone">Telefone</option>
                <option value="outro">Outro</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Vencimento</label>
              <input
                required
                type="date"
                value={custoForm.vencimento}
                onChange={(e) => setCustoForm({ ...custoForm, vencimento: e.target.value })}
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Status</label>
              <select
                value={custoForm.status}
                onChange={(e) => setCustoForm({ ...custoForm, status: e.target.value as CustoFixo['status'] })}
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none"
              >
                <option value="pendente">Pendente</option>
                <option value="pago">Pago</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>
          </div>
          {!custoEditId && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={custoForm.recorrente}
                  onChange={(e) => setCustoForm({ ...custoForm, recorrente: e.target.checked })}
                  className="w-4 h-4 accent-green-600"
                />
                Custo recorrente (repete todo mês)
              </label>
              {custoForm.recorrente && (
                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Repetir por quantos meses (inclui o 1º)</label>
                  <input
                    type="number"
                    min={2}
                    max={60}
                    value={custoForm.meses}
                    onChange={(e) => setCustoForm({ ...custoForm, meses: e.target.value })}
                    className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">Cada mês vira um lançamento no mesmo dia do vencimento; só o 1º usa o status escolhido, os demais entram pendentes.</p>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-3 pt-4 border-t border-slate-100 dark:border-slate-800 mt-6">
            <Button type="button" variant="outline" className="w-full" onClick={() => setCustoModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" className="w-full">
              {custoEditId ? (
                <>
                  <Save size={18} className="mr-2" />
                  Salvar Alterações
                </>
              ) : (
                <>
                  <Plus size={18} className="mr-2" />
                  Cadastrar Custo
                </>
              )}
            </Button>
          </div>
        </form>
      </Modal>

      {tab === 'tokens' && (
        <>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className={`w-2 h-2 rounded-full ${aoVivo ? 'bg-green-500 animate-pulse' : 'bg-slate-400'}`} />
            {aoVivo ? 'Ao vivo: atualiza sozinho até 30 s após cada uso registrado' : 'Conectando ao tempo real...'}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Object.keys(resumoUso).length === 0 ? (
              <Card><CardContent className="p-6 text-sm text-slate-500">Sem uso registrado no período.</CardContent></Card>
            ) : (
              Object.entries(resumoUso).map(([servico, r]) => (
                <Card key={servico}>
                  <CardContent className="p-6">
                    <p className="text-sm text-slate-500 mb-1 capitalize">{servico} (período)</p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white">{formatar_moeda_brl(r.custo)}</p>
                    <p className="text-xs text-slate-400 mt-1">{r.tokens.toLocaleString('pt-BR')} tokens</p>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
          <Card>
            <CardHeader><CardTitle>Credenciais dos serviços</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-500">
                Cole aqui as chaves para o painel buscar os custos reais. Ficam guardadas só no servidor e nunca são exibidas de volta.
              </p>
              {([
                ['OPENAI_ADMIN_KEY', 'OpenAI: chave admin (sk-admin-...)'],
              ] as const).map(([chave, rotulo]) => {
                const atual = credenciais.find((c) => c.chave === chave);
                const valor = credValores[chave] || '';
                return (
                  <div key={chave} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-center">
                    <input
                      type="password"
                      autoComplete="off"
                      aria-label={rotulo}
                      placeholder={atual?.configurada ? `${rotulo} (configurada, termina em ${atual.final})` : rotulo}
                      value={valor}
                      onChange={(e) => setCredValores({ ...credValores, [chave]: e.target.value })}
                      className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:ring-2 focus:ring-green-500 outline-none"
                    />
                    <Button type="button" size="sm" disabled={!valor.trim()} onClick={() => void salvarCredencial(chave, valor)}>Salvar</Button>
                    <Button type="button" variant="outline" size="sm" disabled={!atual?.configurada} onClick={() => void salvarCredencial(chave, '')}>Remover</Button>
                  </div>
                );
              })}
              {credMsg && <p role="status" className="text-sm text-slate-600 dark:text-slate-300">{credMsg}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>OpenAI: gasto real do mês atual</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {openaiErro && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{openaiErro}</p>}
              {openaiCusto && (
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {openaiCusto.total.toFixed(2)} <span className="text-xs font-normal text-slate-400 uppercase">{openaiCusto.moeda}</span>
                </p>
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => void carregarOpenai()}>Atualizar da OpenAI</Button>
            </CardContent>
          </Card>
        </>
      )}
      {tab === 'whatsapp' && (
        <Card>
          <CardHeader><CardTitle>Conexão do WhatsApp</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-slate-500">
              As credenciais e a URL da instância WAHA são carregadas diretamente do banco de dados. Instância: <strong className="text-slate-700 dark:text-slate-300">{waha?.session ?? 'FinalZap'}</strong>.
            </p>
            {wahaCarregando && <p className="text-sm text-slate-500">Consultando o WAHA...</p>}
            {wahaErro && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{wahaErro}</p>}
            {waha && (
              <div className="space-y-2">
                <p className="text-lg font-bold text-slate-900 dark:text-white">{STATUS_WAHA[waha.status] ?? waha.status}</p>
                {waha.me && <p className="text-sm text-slate-500">{waha.me.pushName ?? 'Conta'} ({waha.me.id?.replace(/@.*/, '')})</p>}
                {waha.qr && (
                  <div>
                    <img src={waha.qr} alt="QR Code para conectar o WhatsApp" className="w-64 h-64 rounded-lg border border-slate-200 bg-white p-2" />
                    <p className="text-xs text-slate-500 mt-1">WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho.</p>
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={wahaCarregando} onClick={() => void consultarWaha('start')}>Conectar</Button>
              <Button type="button" variant="outline" size="sm" disabled={wahaCarregando} onClick={() => void consultarWaha()}>Atualizar</Button>
              <Button type="button" variant="outline" size="sm" disabled={wahaCarregando} onClick={() => void consultarWaha('stop')}>Parar</Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={wahaCarregando}
                onClick={() => { if (window.confirm('Desconectar o número do WhatsApp desta instância?')) void consultarWaha('logout'); }}
              >
                Desconectar número
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {tab === 'custos' && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <Card>
                <CardHeader>
                  <CardTitle>Custos Fixos do Sistema</CardTitle>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Controle de custos fixos do negócio (servidor, ferramentas, marketing, telefone).
                  </p>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card>
                      <CardContent className="p-6">
                        <p className="text-sm text-slate-500 mb-1">Total Pendente</p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                          {formatar_moeda_brl(
                            custosPeriodo
                              .filter(c => c.status === 'pendente')
                              .reduce((s, c) => s + Number(c.valor), 0)
                          )}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-6">
                        <p className="text-sm text-slate-500 mb-1">Total Pago</p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                          {formatar_moeda_brl(
                            custosPeriodo
                              .filter(c => c.status === 'pago')
                              .reduce((s, c) => s + Number(c.valor), 0)
                          )}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="p-6">
                        <p className="text-sm text-slate-500 mb-1">Total Geral</p>
                        <p className="text-2xl font-bold text-slate-900 dark:text-white">
                          {formatar_moeda_brl(
                            custosPeriodo.reduce((s, c) => s + Number(c.valor), 0)
                          )}
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                </CardContent>
              </Card>
            </div>
            <Button onClick={() => { setCustoEditId(null); setCustoModalOpen(true); }}>
              <Plus size={18} className="mr-2" />
              Novo Custo Fixo
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800">
                    <tr>
                      <th className="px-6 py-4 font-medium">Descrição</th>
                      <th className="px-6 py-4 font-medium">Categoria</th>
                      <th className="px-6 py-4 font-medium text-right">Valor</th>
                      <th className="px-6 py-4 font-medium text-center">Vencimento</th>
                      <th className="px-6 py-4 font-medium">Status</th>
                      <th className="px-6 py-4 font-medium text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {custosPeriodo.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                          Nenhum custo fixo cadastrado.
                        </td>
                      </tr>
                    ) : (
                      custosPeriodo.map((c) => {
                        const categoriaLabel: Record<string, string> = {
                          servidor: 'Servidor',
                          ferramenta: 'Ferramenta',
                          marketing: 'Marketing',
                          telefone: 'Telefone',
                          outro: 'Outro',
                        };
                        return (
                          <tr key={c.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                            <td className="px-6 py-4">
                              <p className="font-medium text-slate-900 dark:text-white">{c.descricao}</p>
                            </td>
                            <td className="px-6 py-4 text-slate-700 dark:text-slate-300 text-sm capitalize">
                              {categoriaLabel[c.categoria] || c.categoria}
                            </td>
                            <td className="px-6 py-4 text-right font-medium text-slate-900 dark:text-white">
                              {formatar_moeda_brl(Number(c.valor))}
                            </td>
                            <td className="px-6 py-4 text-center text-slate-700 dark:text-slate-300">
                              {c.vencimento}
                            </td>
                            <td className="px-6 py-4">
                              {c.status === 'pago' ? (
                                <Badge variant="outline" className="bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 border-blue-200 dark:border-blue-800/50">
                                  Pago
                                </Badge>
                              ) : c.status === 'cancelado' ? (
                                <Badge variant="outline" className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700">
                                  Cancelado
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 border-amber-200 dark:border-amber-800/40">
                                  Pendente
                                </Badge>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex justify-end gap-1">
                                {c.status === 'pendente' && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleCustoPagar(c.id)}
                                    className="h-8 w-8 p-0 text-green-600 hover:bg-green-50"
                                  >
                                    <Check size={16} />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleCustoEditar(c)}
                                  className="h-8 w-8 p-0 text-slate-400 hover:text-green-600"
                                >
                                  <Edit size={16} />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleCustoExcluir(c.id)}
                                  className="h-8 w-8 p-0 text-slate-400 hover:text-red-500"
                                >
                                  <Trash2 size={16} />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
