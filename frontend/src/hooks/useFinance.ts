import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { nomeDaCategoria, idDaCategoria } from '../lib/categorias';
import {
  registrar_movimentacao,
  remover_movimentacao,
  consultar_movimentacoes,
  consultar_saldo,
  consultar_resumo_mensal,
  consultar_resumo_varios_meses,
  consultar_orcamentos,
  definir_orcamento,
  remover_orcamento,
  cadastrar_conta_a_pagar,
  listar_contas_a_pagar,
  contas_vencendo,
  marcar_conta_paga,
  gerar_dicas_economia,
  listar_assinaturas,
  cadastrar_assinatura,
  atualizar_assinatura,
  remover_assinatura,
  listar_uso_servico,
  registrar_uso_servico,
  resumo_uso_servico,
  listar_custos_fixos,
  cadastrar_custo_fixo,
  atualizar_custo_fixo,
  remover_custo_fixo,
  total_custos_fixos,
  formatar_moeda_brl,
  type Orcamento,
  type TipoAssinatura,
  type TipoMovimentacao,
  resolverTelefoneUsuario,
} from '../lib/financeService';

export type { Orcamento, TipoAssinatura, TipoMovimentacao };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : '');

/**
 * Hook que sincroniza o Zustand (estado local da UI) com o Supabase
 * seguindo as regras do prompt do agente financeiro (FINALZAP).
 */
export function useFinance() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // O banco é a única fonte de transações e contas: nada é mantido só no navegador.
  const carregarDados = useCallback(async (silencioso: boolean | unknown = false) => {
    if (silencioso !== true) setLoading(true);
    setError(null);
    try {
      // 1. Movimentações do banco (fonte da verdade para saldo/extrato)
      // Sem limite: gráficos e totais do painel precisam de todo o histórico (a função pagina de 1000 em 1000).
      const movs = await consultar_movimentacoes();
      const txsDoBanco: Array<{
        id: string;
        description: string;
        amount: number;
        type: 'income' | 'expense';
        categoryId: string;
        accountId: string;
        date: string;
        mes?: string;
        fonte: 'whatsapp' | 'painel' | 'conta_paga' | 'recorrente';
        telefone?: string;
      }> = movs.map((m) => ({
        id: m.id,
        description: m.descricao,
        amount: Number(m.valor),
        type: m.tipo === 'receita' ? 'income' : 'expense',
        categoryId: idDaCategoria(m.categoria),
        accountId: 'acc_whatsapp',
        date: m.data,
        mes: m.mes,
        fonte: (m.fonte || 'whatsapp') as 'whatsapp' | 'painel' | 'conta_paga' | 'recorrente',
        telefone: m.telefone,
      }));

      useStore.setState({ transactions: txsDoBanco });

      // 2. Saldos
      await consultar_saldo();

      // 3. Orçamentos
      // (orçamentos são lidos direto do banco pela tela de Orçamento)

      // 4. Contas a pagar
      const contas = await listar_contas_a_pagar();
      const fixasDoBanco = contas.map((c) => ({
        id: c.id,
        description: c.descricao,
        amount: Number(c.valor),
        type: 'expense' as const,
        categoryId: c.categoria || 'Contas',
        accountId: 'acc_whatsapp',
        date: c.vencimento,
        vencimento: c.vencimento,
        frequency: 'Mensal' as const,
        status: (c.status === 'paga' || c.status === 'cancelada' ? c.status : 'pendente') as 'paga' | 'cancelada' | 'pendente',
        lembreteEnviado: false,
        telefone: c.telefone,
        movimentacaoId: c.movimentacao_id,
        fonte: 'conta_paga' as const,
      }));

      useStore.setState({ fixedTransactions: fixasDoBanco });

      setError(null);
    } catch (e) {
      setError(errMsg(e) || 'Erro ao carregar dados financeiros');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregarDados();
  }, [carregarDados]);

  /* -------------------- Função 1: Registrar movimentação -------------------- */
  const registrar_movimentacao_ui = useCallback(
    async (input: {
      tipo: TipoMovimentacao;
      valor: number;
      categoria: string;
      descricao: string;
      data?: string;
    }) => {
      try {
        const salvo = await registrar_movimentacao({
          tipo: input.tipo,
          valor: input.valor,
          categoria: nomeDaCategoria(input.categoria),
          descricao: input.descricao,
          data: input.data,
          fonte: 'painel',
        });

        await carregarDados(true);

        return {
          sucesso: true,
          mensagem: `Registrado com sucesso: ${salvo.tipo} de ${formatar_moeda_brl(Number(salvo.valor))} — ${salvo.descricao} (${salvo.categoria})`,
          movimentacao: salvo,
        };
      } catch (e) {
        return { sucesso: false, mensagem: errMsg(e) || 'Não foi possível salvar a movimentação.' };
      }
    },
    [carregarDados]
  );

  const remover_movimentacao_ui = useCallback(
    async (id: string) => {
      try {
        await remover_movimentacao(id);
        await carregarDados(true);
        return { sucesso: true as const };
      } catch (e) {
        return { sucesso: false as const, mensagem: errMsg(e) || 'Não foi possível excluir.' };
      }
    },
    [carregarDados]
  );

  /* -------------------- Função 3: Resumo mensal -------------------- */
  const resumo_mensal = useCallback(
    async (mes?: string) => {
      return consultar_resumo_mensal(undefined, mes);
    },
    []
  );

  /* -------------------- Função 4: Orçamento -------------------- */
  const definir_orcamento_ui = useCallback(
    async (categoria: string, limite: number, mes?: string) => {
      try {
        const salvo = await definir_orcamento({
          categoria: nomeDaCategoria(categoria),
          limite_mensal: limite,
          mes,
        });
        return { sucesso: true, orcamento: salvo };
      } catch (e) {
        return { sucesso: false, erro: errMsg(e) || 'Erro ao definir orçamento.' };
      }
    },
    []
  );

  const remover_orcamento_ui = useCallback(
    async (categoria: string, mes?: string) => {
      try {
        await remover_orcamento(nomeDaCategoria(categoria), undefined, mes);
        return { sucesso: true };
      } catch (e) {
        return { sucesso: false, erro: errMsg(e) || 'Erro ao remover orçamento.' };
      }
    },
    []
  );

  /* -------------------- Função 5: Contas a pagar -------------------- */
  const cadastrar_conta_a_pagar_ui = useCallback(
    async (input: {
      descricao: string;
      valor: number;
      categoria: string;
      vencimento: string;
    }) => {
      try {
        const salva = await cadastrar_conta_a_pagar({
          descricao: input.descricao,
          valor: input.valor,
          categoria: nomeDaCategoria(input.categoria),
          vencimento: input.vencimento,
        });

        await carregarDados(true);

        return { sucesso: true, conta: salva };
      } catch (e) {
        return { sucesso: false, erro: errMsg(e) || 'Erro ao cadastrar conta a pagar.' };
      }
    },
    [carregarDados]
  );

  const marcar_conta_paga_ui = useCallback(
    async (contaId: string) => {
      try {
        const resultado = await marcar_conta_paga(contaId);
        // A RPC já cria a despesa; recarrega do banco em vez de duplicar localmente.
        if (resultado.sucesso) await carregarDados(true);
        return {
          sucesso: resultado.sucesso,
          mensagem: resultado.mensagem,
          movimentacao_id: resultado.movimentacao_id,
        };
      } catch (e) {
        return {
          sucesso: false,
          mensagem: errMsg(e) || 'Não foi possível marcar a conta como paga.',
        };
      }
    },
    [carregarDados]
  );

  const lista_contas_vencendo = useCallback(
    async (dias: number = 7) => {
      return contas_vencendo(dias);
    },
    []
  );

  /* -------------------- Função 7: Dicas de economia -------------------- */
  const obter_dicas_economia = useCallback(
    (gastosPorCategoria: Record<string, number>, orcamentosList: Orcamento[] = []) => {
      return gerar_dicas_economia(gastosPorCategoria, orcamentosList);
    },
    []
  );

  /* -------------------- Função 8: Assinaturas (Hotmart) -------------------- */
  const listar_assinaturas_ui = useCallback(
    async (telefone?: string) => {
      return listar_assinaturas(telefone);
    },
    []
  );

  const cadastrar_assinatura_ui = useCallback(
    async (input: {
      telefone: string;
      nome: string;
      email: string;
      hotmart_id: string;
      plano: string;
      status: 'Ativo' | 'Inativo' | 'Cancelado' | 'Inadimplente';
      data_inicio: string;
      data_vencimento: string;
      metodo_pagamento: string;
    }) => {
      try {
        const salvo = await cadastrar_assinatura({
          ...input,
          telefone: input.telefone || (await resolverTelefoneUsuario()) || '',
        });
        return { sucesso: true, assinatura: salvo };
      } catch (e) {
        return { sucesso: false, erro: errMsg(e) || 'Erro ao cadastrar assinatura.' };
      }
    },
    []
  );

  const atualizar_assinatura_ui = useCallback(
    async (id: string, input: Partial<{
      nome: string;
      email: string;
      hotmart_id: string;
      plano: string;
      status: 'Ativo' | 'Inativo' | 'Cancelado' | 'Inadimplente';
      data_inicio: string;
      data_vencimento: string;
      metodo_pagamento: string;
    }>) => {
      try {
        const salvo = await atualizar_assinatura(id, input);
        return { sucesso: true, assinatura: salvo };
      } catch (e) {
        return { sucesso: false, erro: errMsg(e) || 'Erro ao atualizar assinatura.' };
      }
    },
    []
  );

  const remover_assinatura_ui = useCallback(
    async (id: string) => {
      try {
        await remover_assinatura(id);
        return { sucesso: true };
      } catch (e) {
        return { sucesso: false, erro: errMsg(e) || 'Erro ao remover assinatura.' };
      }
    },
    []
  );

  return {
    loading,
    error,
    recarregar: carregarDados,
    // Função 1
    registrar_movimentacao: registrar_movimentacao_ui,
    remover_movimentacao: remover_movimentacao_ui,
    // Função 2
    consultar_saldo,
    // Função 3
    resumo_mensal,
    consultar_resumo_varios_meses,
    // Função 4
    definir_orcamento: definir_orcamento_ui,
    remover_orcamento: remover_orcamento_ui,
    consultar_orcamentos,
    // Função 5
    cadastrar_conta_a_pagar: cadastrar_conta_a_pagar_ui,
    marcar_conta_paga: marcar_conta_paga_ui,
    lista_contas_vencendo,
    listar_contas_a_pagar,
    // Função 7
    obter_dicas_economia,
    formatar_moeda_brl,
    // Função 8: Assinaturas (Hotmart)
    listar_assinaturas: listar_assinaturas_ui,
    cadastrar_assinatura: cadastrar_assinatura_ui,
    atualizar_assinatura: atualizar_assinatura_ui,
    remover_assinatura: remover_assinatura_ui,
    // Função 9: Tokens / Uso de serviços
    listar_uso_servico,
    registrar_uso_servico,
    resumo_uso_servico,
    // Função 10: Custos fixos
    listar_custos_fixos,
    cadastrar_custo_fixo,
    atualizar_custo_fixo,
    remover_custo_fixo,
    total_custos_fixos,
  };
}
