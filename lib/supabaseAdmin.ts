// Cliente Supabase com chave de serviço (ignora RLS) e adaptadores Hotmart/Admin.
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

async function enviarLinkPeloN8n(
  db: SupabaseClient,
  email: string,
  nome: string | undefined,
  redirectTo: string,
): Promise<{ userId: string | null; tipo: 'convite' | 'redefinicao' }> {
  const url = process.env.N8N_EMAIL_WEBHOOK_URL;
  if (!url) throw new Error('N8N_EMAIL_WEBHOOK_URL ausente');
  const segredo = process.env.N8N_EMAIL_WEBHOOK_SECRET;
  if (!segredo || !segredo.trim()) throw new Error('N8N_EMAIL_WEBHOOK_SECRET ausente');

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
  const actionLink = r.data?.properties?.action_link;
  if (r.error || typeof actionLink !== 'string' || !actionLink.startsWith('https://')) {
    throw new Error(erroSeguro('Falha ao gerar link', r.error ?? {}));
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-secret': segredo,
    },
    body: JSON.stringify({ email, nome: nome ?? '', tipo, link: actionLink }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Falha ao enviar e-mail pelo n8n (HTTP ${resp.status})`);
  return { userId: r.data.user?.id ?? null, tipo };
}

export function criarDepsHotmart(db: SupabaseClient, appUrl: string): Deps {
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
    if (porTelefone.data) return 'conflito';

    const ins = await db.from('perfis').insert({
      auth_id: authId,
      telefone: d.telefone,
      nome: d.nome,
      email: d.email,
      role: 'user',
    });
    if (violacaoUnica(ins.error)) return 'conflito';
    if (ins.error) throw new Error('Falha ao criar perfil');
    return 'ok';
  }

  return {
    async registrarEvento(chave, e) {
      const { error } = await db.from('hotmart_eventos').insert(linhaEvento(chave, e, e));
      if (violacaoUnica(error)) return false;
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
        const { error: e3 } = await db
          .from('assinaturas')
          .update({ convite_erro: ERRO_SEM_TELEFONE })
          .eq('email', email);
        if (e3) throw new Error('Falha ao registrar convite sem telefone');
        return;
      }

      const r = await garantirPerfil(userId, { email, nome, telefone });
      if (r === 'conflito') {
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
