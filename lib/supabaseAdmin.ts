// Cliente Supabase com chave de SERVICO (ignora RLS) e adaptadores reais das Deps
// da Hotmart. Uso exclusivo no servidor: nunca expor a chave ao navegador nem logar
// chaves, tokens, e-mails ou telefones.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Deps } from './hotmart/processar';
import {
  ERRO_SEM_TELEFONE,
  ERRO_TELEFONE_VINCULADO,
  erroSeguro,
  gravarAssinaturaCondicional,
  linhaEvento,
  truncarErro,
  usuarioJaCadastrado,
  violacaoUnica,
} from './hotmart/linhas';

export function criarClienteAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    throw new Error('Variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias.');
  }
  return createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// O Supabase so gera o link (sem enviar e-mail); quem envia e o n8n, pelo webhook abaixo.
// Convite para conta nova; se o e-mail ja tem conta, link de recuperacao (abre a mesma tela).
async function enviarLinkPeloN8n(
  db: SupabaseClient,
  email: string,
  nome: string | undefined,
  redirectTo: string,
): Promise<{ userId: string | null; tipo: 'convite' | 'redefinicao' }> {
  const url = process.env.N8N_EMAIL_WEBHOOK_URL;
  if (!url) throw new Error('N8N_EMAIL_WEBHOOK_URL ausente');

  let tipo: 'convite' | 'redefinicao' = 'convite';
  let r = await db.auth.admin.generateLink({
    type: 'invite',
    email,
    options: { data: { nome }, redirectTo },
  });
  if (usuarioJaCadastrado(r.error)) {
    tipo = 'redefinicao';
    r = await db.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } });
  }
  if (r.error || !r.data?.properties?.action_link) {
    throw new Error(erroSeguro('Falha ao gerar link', r.error ?? {}));
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-secret': process.env.N8N_EMAIL_WEBHOOK_SECRET ?? '',
    },
    body: JSON.stringify({ email, nome: nome ?? '', tipo, link: r.data.properties.action_link }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Falha ao enviar e-mail pelo n8n (HTTP ${resp.status})`);
  return { userId: r.data.user?.id ?? null, tipo };
}

export function criarDepsHotmart(db: SupabaseClient, appUrl: string): Deps {
  // Cria o perfil so se nao existir para este auth_id nem para este telefone.
  // Nunca faz upsert: isso poderia trocar o auth_id de um perfil existente.
  async function garantirPerfil(
    authId: string,
    d: { email: string; nome: string; telefone: string },
  ): Promise<'ok' | 'conflito'> {
    const porAuth = await db.from('perfis').select('id').eq('auth_id', authId).maybeSingle();
    if (porAuth.error) throw new Error('Falha ao consultar perfil');
    if (porAuth.data) return 'ok';

    const porTelefone = await db
      .from('perfis')
      .select('id')
      .eq('telefone', d.telefone)
      .maybeSingle();
    if (porTelefone.error) throw new Error('Falha ao consultar perfil');
    if (porTelefone.data) return 'conflito'; // pertence a outro auth_id

    const ins = await db.from('perfis').insert({
      auth_id: authId,
      telefone: d.telefone,
      nome: d.nome,
      email: d.email,
      role: 'user',
    });
    if (violacaoUnica(ins.error)) return 'conflito'; // corrida com outro processo
    if (ins.error) throw new Error('Falha ao criar perfil');
    return 'ok';
  }

  return {
    async registrarEvento(chave, e) {
      const { error } = await db.from('hotmart_eventos').insert(linhaEvento(chave, e, e));
      if (violacaoUnica(error)) return false; // ja visto
      if (error) throw new Error(erroSeguro('Falha ao registrar evento', error));
      return true;
    },

    async liberarEvento(chave) {
      const { error } = await db.from('hotmart_eventos').delete().eq('chave', chave);
      if (error) throw new Error(erroSeguro('Falha ao liberar evento', error));
    },

    async buscarAssinatura(codigo) {
      const { data, error } = await db
        .from('assinaturas')
        .select('id, ultimo_evento_em, convite_enviado_em')
        .eq('hotmart_assinante_codigo', codigo)
        .maybeSingle();
      if (error) throw new Error(erroSeguro('Falha ao buscar assinatura', error));
      if (!data) return null;
      return {
        id: data.id as string,
        ultimoEventoEm: data.ultimo_evento_em ? new Date(data.ultimo_evento_em) : null,
        conviteEnviadoEm: data.convite_enviado_em ? new Date(data.convite_enviado_em) : null,
      };
    },

    // Upsert condicional em dois passos (o PostgREST nao expressa "ON CONFLICT DO UPDATE
    // WHERE" e evitamos RPC para nao exigir nova migracao):
    // 1) insere se nao existe (ignora duplicado); 2) update filtrado pela ordem do evento,
    // atomico no banco, entao eventos concorrentes nao regridem o estado.
    async gravarAssinatura(d) {
      await gravarAssinaturaCondicional(db, d);
    },

    async registrarEntrada(d) {
      const { error } = await db.from('entradas').upsert(
        { transacao: d.transacao, assinante_codigo: d.assinanteCodigo, valor: d.valor, moeda: d.moeda, taxa: d.taxa },
        { onConflict: 'transacao', ignoreDuplicates: true },
      );
      if (error) throw new Error(erroSeguro('Falha ao registrar entrada', error));
    },

    async removerEntrada(transacao) {
      const { error } = await db.from('entradas').delete().eq('transacao', transacao);
      if (error) throw new Error(erroSeguro('Falha ao remover entrada', error));
    },

    async convidar({ email, nome, telefone }) {
      const { userId } = await enviarLinkPeloN8n(db, email, nome, `${appUrl}/definir-senha`);
      if (!userId) return;
      if (!telefone) {
        // Sem telefone não há como vincular o perfil: avisa o admin em vez de calar.
        const { error: e3 } = await db
          .from('assinaturas')
          .update({ convite_erro: ERRO_SEM_TELEFONE })
          .eq('email', email);
        if (e3) throw new Error('Falha ao registrar convite sem telefone');
        return;
      }

      const r = await garantirPerfil(userId, { email, nome, telefone });
      if (r === 'conflito') {
        // O convite foi enviado; so sinaliza o conflito para revisao (sem dados pessoais).
        const { error: e2 } = await db
          .from('assinaturas')
          .update({ convite_erro: ERRO_TELEFONE_VINCULADO })
          .eq('email', email)
          .eq('telefone', telefone);
        if (e2) throw new Error('Falha ao registrar conflito de telefone');
      }
    },

    async marcarConvite(codigo, erro) {
      if (erro === null) {
        const { error } = await db
          .from('assinaturas')
          .update({ convite_enviado_em: new Date().toISOString() })
          .eq('hotmart_assinante_codigo', codigo);
        if (error) throw new Error(erroSeguro('Falha ao marcar convite', error));
        // Limpa erro anterior, mas preserva o aviso de conflito de telefone.
        const { error: e2 } = await db
          .from('assinaturas')
          .update({ convite_erro: null })
          .eq('hotmart_assinante_codigo', codigo)
          .neq('convite_erro', ERRO_TELEFONE_VINCULADO)
          .neq('convite_erro', ERRO_SEM_TELEFONE);
        if (e2) throw new Error(erroSeguro('Falha ao limpar erro do convite', e2));
        return;
      }
      const { error } = await db
        .from('assinaturas')
        .update({ convite_erro: truncarErro(erro) })
        .eq('hotmart_assinante_codigo', codigo);
      if (error) throw new Error(erroSeguro('Falha ao registrar erro do convite', error));
    },
  };
}

// Adaptadores reais do reenvio de convite pelo admin (chave de servico).
// Mensagens de erro so com `erroSeguro`: nunca e-mail, token ou message do Auth.
export function criarDepsReenvio(db: SupabaseClient, appUrl: string) {
  const redirectTo = `${appUrl}/definir-senha`;
  return {
    async validarToken(token: string): Promise<{ id: string } | null> {
      const { data, error } = await db.auth.getUser(token);
      if (error || !data.user) return null;
      return { id: data.user.id };
    },

    async papelDoUsuario(userId: string): Promise<string | null> {
      const { data, error } = await db
        .from('perfis')
        .select('role')
        .eq('auth_id', userId)
        .maybeSingle();
      if (error) throw new Error(erroSeguro('Falha ao consultar perfil', error));
      return (data?.role as string | undefined) ?? null;
    },

    async buscarAssinatura(id: string) {
      const { data, error } = await db
        .from('assinaturas')
        .select('id, status, data_vencimento, email')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(erroSeguro('Falha ao buscar assinatura', error));
      if (!data) return null;
      return {
        id: data.id as string,
        status: data.status as string,
        dataVencimento: data.data_vencimento ? new Date(data.data_vencimento) : null,
        email: data.email as string,
      };
    },

    async enviarEmail(a: { id: string; email: string }): Promise<'convite' | 'redefinicao'> {
      return (await enviarLinkPeloN8n(db, a.email, undefined, redirectTo)).tipo;
    },

    async registrarReenvio(assinaturaId: string, adminId: string): Promise<void> {
      const { error } = await db
        .from('assinaturas')
        .update({
          convite_reenviado_por: adminId,
          convite_reenviado_em: new Date().toISOString(),
        })
        .eq('id', assinaturaId);
      if (error) throw new Error(erroSeguro('Falha ao registrar reenvio', error));
    },
  };
}
