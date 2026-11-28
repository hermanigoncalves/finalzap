import { useState } from 'react';
import { CalendarClock, Check, MapPin, Pencil, Plus, XCircle } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '../../../components/ui';
import { hojeISO, somarDias } from '../../../lib/datas';
import { useStore } from '../../../store/useStore';
import { aplicarCompromissoLocal, useSincronizacaoDominios } from '../../../lib/sincronizacaoUsuario';
import { formatarDataHoraSP } from '../regras.ts';
import {
  atualizarStatusCompromisso,
  criarCompromisso,
  remarcarCompromisso,
} from '../servico.ts';
import type { Compromisso, FiltroAgenda, NovoCompromissoInput } from '../tipos.ts';
import { ModalCompromisso } from './ModalCompromisso.tsx';

const ABAS: ReadonlyArray<{ id: FiltroAgenda; label: string }> = [
  { id: 'proximos', label: 'Próximos' },
  { id: 'hoje', label: 'Hoje' },
  { id: 'concluidos', label: 'Concluídos' },
  { id: 'cancelados', label: 'Cancelados' },
];

function corStatus(status: Compromisso['status']): 'warning' | 'success' | 'danger' {
  if (status === 'concluido') return 'success';
  if (status === 'cancelado') return 'danger';
  return 'warning';
}

function rotuloStatus(status: Compromisso['status']): string {
  if (status === 'concluido') return 'Concluído';
  if (status === 'cancelado') return 'Cancelado';
  return 'Agendado';
}

export function PaginaAgenda() {
  const itens = useStore((s) => s.compromissos);
  const { loading: carregando, error: erroCarga } = useSincronizacaoDominios(['compromissos']);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroAgenda>('proximos');
  const [modalAberto, setModalAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Compromisso | null>(null);
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);
  const erro = erroAcao ?? erroCarga;

  async function aoSalvar(dados: NovoCompromissoInput, id?: string) {
    const salvo = id ? await remarcarCompromisso(id, dados) : await criarCompromisso(dados);
    aplicarCompromissoLocal(id ? 'UPDATE' : 'INSERT', salvo);
  }

  async function mudarStatus(id: string, status: 'concluido' | 'cancelado') {
    setOcupadoId(id);
    setErroAcao(null);
    try {
      const atualizado = await atualizarStatusCompromisso(id, status);
      aplicarCompromissoLocal('UPDATE', atualizado);
    } catch (err) {
      setErroAcao(err instanceof Error ? err.message : 'Não foi possível atualizar o compromisso.');
    } finally {
      setOcupadoId(null);
    }
  }

  const hoje = hojeISO();
  const limite7Dias = somarDias(hoje, 7);
  const agendados = itens.filter((c) => c.status === 'agendado');
  const qtdHoje = agendados.filter((c) => formatarDataHoraSP(c.inicio).dataISO === hoje).length;
  const qtdSemana = agendados.filter((c) => {
    const d = formatarDataHoraSP(c.inicio).dataISO;
    return d >= hoje && d <= limite7Dias;
  }).length;

  const filtrados = itens
    .filter((c) => {
      if (filtro === 'concluidos') return c.status === 'concluido';
      if (filtro === 'cancelados') return c.status === 'cancelado';
      if (c.status !== 'agendado') return false;
      const dataItem = formatarDataHoraSP(c.inicio).dataISO;
      return filtro === 'hoje' ? dataItem === hoje : dataItem >= hoje;
    })
    .sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio));

  if (carregando) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
      {erro && (
        <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-700 dark:text-red-400 text-sm">
          {erro}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">Agenda</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">
            Compromissos criados pelo WhatsApp ou diretamente pelo painel.
          </p>
        </div>
        <Button
          onClick={() => {
            setEmEdicao(null);
            setModalAberto(true);
          }}
        >
          <Plus size={18} className="mr-2" />
          Novo Compromisso
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Hoje</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{qtdHoje}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Próximos 7 dias</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{qtdSemana}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500 dark:text-slate-400">Total agendados</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{agendados.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {ABAS.map((aba) => (
          <Button
            key={aba.id}
            size="sm"
            variant={filtro === aba.id ? 'default' : 'outline'}
            onClick={() => setFiltro(aba.id)}
          >
            {aba.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0 divide-y divide-slate-200 dark:divide-slate-700/50">
          {filtrados.length === 0 ? (
            <div className="p-10 text-center text-slate-500 dark:text-slate-400 space-y-2">
              <CalendarClock size={32} className="mx-auto opacity-50" />
              <p className="text-sm">Nenhum compromisso nesta visualização.</p>
            </div>
          ) : (
            filtrados.map((item) => {
              const ini = formatarDataHoraSP(item.inicio);
              const fm = formatarDataHoraSP(item.fim);
              const ocupado = ocupadoId === item.id;
              return (
                <div
                  key={item.id}
                  className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white">{item.titulo}</span>
                      <Badge variant={corStatus(item.status)}>{rotuloStatus(item.status)}</Badge>
                      <Badge variant="outline">{item.fonte === 'whatsapp' ? 'WhatsApp' : 'Painel'}</Badge>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      {ini.data} • {ini.hora} às {fm.hora}
                    </p>
                    {item.local && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                        <MapPin size={14} />
                        {item.local}
                      </p>
                    )}
                    {item.descricao && <p className="text-xs text-slate-500 dark:text-slate-400">{item.descricao}</p>}
                  </div>

                  {item.status === 'agendado' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={ocupado}
                        onClick={() => {
                          setEmEdicao(item);
                          setModalAberto(true);
                        }}
                      >
                        <Pencil size={14} className="mr-1.5" />
                        Remarcar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={ocupado}
                        onClick={() => void mudarStatus(item.id, 'concluido')}
                      >
                        <Check size={14} className="mr-1.5" />
                        Concluir
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={ocupado}
                        onClick={() => void mudarStatus(item.id, 'cancelado')}
                      >
                        <XCircle size={14} className="mr-1.5 text-red-500" />
                        Cancelar
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <ModalCompromisso
        key={emEdicao?.id ?? (modalAberto ? 'novo' : 'fechado')}
        isOpen={modalAberto}
        onClose={() => {
          setModalAberto(false);
          setEmEdicao(null);
        }}
        existentes={itens}
        compromissoEmEdicao={emEdicao}
        aoSalvar={aoSalvar}
      />
    </div>
  );
}
