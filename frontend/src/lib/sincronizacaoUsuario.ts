import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { supabase } from './supabase';
import { idDaCategoria } from './categorias';
import { useStore } from '../store/useStore';
import {
  atualizarCachePerfil,
  consultar_movimentacoes,
  consultar_orcamentos,
  listar_contas_a_pagar,
  type ContaAPagar,
  type Movimentacao,
  type Orcamento,
  type PerfilUsuario,
} from './financeService';
import { listarCompromissos, type Compromisso } from '../features/agenda';
import {
  aplicarEventoLista,
  compararCompromissos,
  compararContas,
  compararOrcamentos,
  compararTransacoes,
  ControladorCargaUnica,
  mapearContaLinha,
  mapearMovimentacaoLinha,
  normalizarOrcamentoLinha,
  type ContaLinha,
  type DominioUsuario,
  type EventoRealtime,
  type MovimentacaoLinha,
  type OrcamentoLinha,
  type StatusDominio,
} from './realtimeEstado';

interface EstadoDominio {
  status: StatusDominio;
  erro: string | null;
}

interface EstadoSyncUsuario {
  dominios: Record<DominioUsuario, EstadoDominio>;
  realtimeConectado: boolean;
}

const estadoInicialDominios = (): Record<DominioUsuario, EstadoDominio> => ({
  movimentacoes: { status: 'idle', erro: null },
  contas_a_pagar: { status: 'idle', erro: null },
  orcamentos: { status: 'idle', erro: null },
  compromissos: { status: 'idle', erro: null },
});

export const useEstadoSyncUsuario = create<EstadoSyncUsuario>(() => ({
  dominios: estadoInicialDominios(),
  realtimeConectado: false,
}));

const controlador = new ControladorCargaUnica<DominioUsuario>();
const TODOS_DOMINIOS: DominioUsuario[] = ['movimentacoes', 'contas_a_pagar', 'orcamentos', 'compromissos'];

async function carregarDominio(dominio: DominioUsuario): Promise<void> {
  if (dominio === 'movimentacoes') {
    const movs = await consultar_movimentacoes();
    useStore.setState({
      transactions: movs.map((m) => mapearMovimentacaoLinha(m, idDaCategoria)),
    });
    return;
  }
  if (dominio === 'contas_a_pagar') {
    const contas = await listar_contas_a_pagar();
    useStore.setState({
      fixedTransactions: contas.map((c) => mapearContaLinha(c, idDaCategoria)),
    });
    return;
  }
  if (dominio === 'orcamentos') {
    const lista = await consultar_orcamentos();
    useStore.setState({
      orcamentos: lista.map((o) => normalizarOrcamentoLinha(o) as Orcamento),
    });
    return;
  }
  const compromissos = await listarCompromissos();
  useStore.setState({ compromissos });
}

export async function garantirDominios(
  dominios: readonly DominioUsuario[],
  opcoes?: { forcar?: boolean }
): Promise<void> {
  const unicos = Array.from(new Set(dominios));
  await Promise.all(
    unicos.map((d) =>
      controlador.garantir(d, () => carregarDominio(d), {
        forcar: opcoes?.forcar,
        aoMudarStatus: (status, erro) => {
          useEstadoSyncUsuario.setState((s) => ({
            dominios: {
              ...s.dominios,
              [d]: { status, erro },
            },
          }));
        },
      })
    )
  );
}

export function useSincronizacaoDominios(dominios: readonly DominioUsuario[]) {
  const chave = dominios.join(',');
  const lista = useMemo(
    () => (chave ? (chave.split(',') as DominioUsuario[]) : []),
    [chave]
  );

  useEffect(() => {
    if (lista.length > 0) void garantirDominios(lista);
  }, [lista]);

  const estado = useEstadoSyncUsuario((s) => s.dominios);
  const loading = lista.some((d) => estado[d].status === 'idle' || estado[d].status === 'loading');
  const error = lista.map((d) => estado[d].erro).find((e) => e !== null) ?? null;
  const recarregar = () => garantirDominios(lista, { forcar: true });

  return { loading, error, recarregar };
}

export function aplicarMovimentacaoLocal(
  eventType: EventoRealtime,
  nova: Movimentacao | MovimentacaoLinha | null,
  antigoId?: string | null
): void {
  const mapeada = nova ? mapearMovimentacaoLinha(nova, idDaCategoria) : null;
  useStore.setState((s) => ({
    transactions: aplicarEventoLista(s.transactions, { eventType, novo: mapeada, antigoId }, compararTransacoes),
  }));
}

export function aplicarContaLocal(
  eventType: EventoRealtime,
  nova: ContaAPagar | ContaLinha | null,
  antigoId?: string | null
): void {
  const mapeada = nova ? mapearContaLinha(nova, idDaCategoria) : null;
  useStore.setState((s) => ({
    fixedTransactions: aplicarEventoLista(s.fixedTransactions, { eventType, novo: mapeada, antigoId }, compararContas),
  }));
}

export function aplicarOrcamentoLocal(
  eventType: EventoRealtime,
  novo: Orcamento | OrcamentoLinha | null,
  antigoId?: string | null
): void {
  const normalizado = novo ? (normalizarOrcamentoLinha(novo) as Orcamento) : null;
  useStore.setState((s) => ({
    orcamentos: aplicarEventoLista(s.orcamentos, { eventType, novo: normalizado, antigoId }, compararOrcamentos),
  }));
}

export function aplicarCompromissoLocal(
  eventType: EventoRealtime,
  novo: Compromisso | null,
  antigoId?: string | null
): void {
  useStore.setState((s) => ({
    compromissos: aplicarEventoLista(s.compromissos, { eventType, novo, antigoId }, compararCompromissos),
  }));
}

export function aplicarPerfilLocal(novoPerfil: PerfilUsuario): void {
  useStore.setState({ perfil: novoPerfil });
  if (novoPerfil.auth_id) atualizarCachePerfil(novoPerfil.auth_id, novoPerfil);
}

interface CallbacksRealtime {
  aoAtualizarPerfil?: (p: PerfilUsuario) => void;
  aoMudarAssinatura?: () => void;
}

interface SessaoRealtimeAtiva {
  chave: string;
  canal: ReturnType<typeof supabase.channel>;
  refCount: number;
  callbacks: CallbacksRealtime;
  timerDesmontar?: ReturnType<typeof setTimeout>;
  timerAssinatura?: ReturnType<typeof setTimeout>;
  timerReconciliacao?: ReturnType<typeof setTimeout>;
  destruir: () => void;
}

let sessaoRealtime: SessaoRealtimeAtiva | null = null;

type PerfilRealtime = Pick<PerfilUsuario, 'id' | 'telefone'>;

function criarSessaoRealtime(perfil: PerfilRealtime, callbacks: CallbacksRealtime): SessaoRealtimeAtiva {
  const chave = `${perfil.id}:${perfil.telefone}`;
  let encerrada = false;
  let teveQueda = false;

  const estado: SessaoRealtimeAtiva = {
    chave,
    canal: null as unknown as ReturnType<typeof supabase.channel>,
    refCount: 1,
    callbacks,
    destruir: () => {},
  };

  const reconciliarProntos = () => {
    if (encerrada) return;
    clearTimeout(estado.timerReconciliacao);
    estado.timerReconciliacao = setTimeout(() => {
      if (encerrada) return;
      const prontos = TODOS_DOMINIOS.filter((d) => controlador.obterStatus(d) === 'ready');
      if (prontos.length > 0) void garantirDominios(prontos, { forcar: true });
      estado.callbacks.aoMudarAssinatura?.();
    }, 500);
  };

  const agendarAssinatura = () => {
    if (encerrada) return;
    clearTimeout(estado.timerAssinatura);
    estado.timerAssinatura = setTimeout(() => {
      if (!encerrada) estado.callbacks.aoMudarAssinatura?.();
    }, 500);
  };

  const canal = supabase
    .channel(`usuario-tempo-real:${perfil.telefone}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'movimentacoes', filter: `telefone=eq.${perfil.telefone}` },
      (payload) => {
        if (controlador.obterStatus('movimentacoes') !== 'ready') return;
        const ev = payload.eventType as EventoRealtime;
        aplicarMovimentacaoLocal(
          ev,
          ev === 'DELETE' ? null : (payload.new as MovimentacaoLinha),
          (payload.old as { id?: string } | null)?.id ?? null
        );
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'contas_a_pagar', filter: `telefone=eq.${perfil.telefone}` },
      (payload) => {
        if (controlador.obterStatus('contas_a_pagar') !== 'ready') return;
        const ev = payload.eventType as EventoRealtime;
        aplicarContaLocal(
          ev,
          ev === 'DELETE' ? null : (payload.new as ContaLinha),
          (payload.old as { id?: string } | null)?.id ?? null
        );
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orcamentos', filter: `telefone=eq.${perfil.telefone}` },
      (payload) => {
        if (controlador.obterStatus('orcamentos') !== 'ready') return;
        const ev = payload.eventType as EventoRealtime;
        aplicarOrcamentoLocal(
          ev,
          ev === 'DELETE' ? null : (payload.new as OrcamentoLinha),
          (payload.old as { id?: string } | null)?.id ?? null
        );
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'compromissos', filter: `telefone=eq.${perfil.telefone}` },
      (payload) => {
        if (controlador.obterStatus('compromissos') !== 'ready') return;
        const ev = payload.eventType as EventoRealtime;
        aplicarCompromissoLocal(
          ev,
          ev === 'DELETE' ? null : (payload.new as Compromisso),
          (payload.old as { id?: string } | null)?.id ?? null
        );
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'perfis', filter: `id=eq.${perfil.id}` },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          useStore.setState({ perfil: null });
          estado.callbacks.aoMudarAssinatura?.();
          return;
        }
        const novo = payload.new as PerfilUsuario;
        if (novo?.id) {
          aplicarPerfilLocal(novo);
          estado.callbacks.aoAtualizarPerfil?.(novo);
        }
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'assinaturas', filter: `telefone=eq.${perfil.telefone}` },
      agendarAssinatura
    )
    .subscribe((status) => {
      if (encerrada) return;
      if (status === 'SUBSCRIBED') {
        useEstadoSyncUsuario.setState({ realtimeConectado: true });
        if (teveQueda) {
          teveQueda = false;
          reconciliarProntos();
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        teveQueda = true;
        useEstadoSyncUsuario.setState({ realtimeConectado: false });
      }
    });

  const onOffline = () => {
    if (encerrada) return;
    teveQueda = true;
    useEstadoSyncUsuario.setState({ realtimeConectado: false });
  };

  const onOnline = () => {
    if (!encerrada && teveQueda) {
      teveQueda = false;
      reconciliarProntos();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
  }

  estado.canal = canal;
  estado.destruir = () => {
    if (encerrada) return;
    encerrada = true;
    clearTimeout(estado.timerDesmontar);
    clearTimeout(estado.timerAssinatura);
    clearTimeout(estado.timerReconciliacao);
    if (typeof window !== 'undefined') {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    }
    useEstadoSyncUsuario.setState({ realtimeConectado: false });
    void supabase.removeChannel(canal);
    if (sessaoRealtime === estado) sessaoRealtime = null;
  };

  return estado;
}

export function adquirirRealtimeUsuario(
  perfil: PerfilRealtime,
  callbacks: CallbacksRealtime
): () => void {
  const chave = `${perfil.id}:${perfil.telefone}`;

  if (sessaoRealtime && sessaoRealtime.chave === chave) {
    clearTimeout(sessaoRealtime.timerDesmontar);
    sessaoRealtime.timerDesmontar = undefined;
    sessaoRealtime.refCount += 1;
    sessaoRealtime.callbacks = callbacks;
  } else {
    sessaoRealtime?.destruir();
    sessaoRealtime = criarSessaoRealtime(perfil, callbacks);
  }

  const alvo = sessaoRealtime;
  let liberado = false;
  return () => {
    if (liberado) return;
    liberado = true;
    alvo.refCount = Math.max(0, alvo.refCount - 1);
    if (alvo.refCount === 0) {
      clearTimeout(alvo.timerDesmontar);
      alvo.timerDesmontar = setTimeout(() => {
        if (alvo.refCount === 0) alvo.destruir();
      }, 50);
    }
  };
}

export function resetarSincronizacaoUsuario(): void {
  sessaoRealtime?.destruir();
  sessaoRealtime = null;
  controlador.resetar();
  useEstadoSyncUsuario.setState({
    dominios: estadoInicialDominios(),
    realtimeConectado: false,
  });
  useStore.setState({
    transactions: [],
    fixedTransactions: [],
    orcamentos: [],
    compromissos: [],
    perfil: null,
  });
}
