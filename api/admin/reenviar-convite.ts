import { TOLERANCIA_DIAS } from '../../lib/hotmart/eventos';
import { tratarReenvio } from '../../lib/admin/reenvio';
import { criarClienteAdmin, criarDepsReenvio } from '../../lib/supabaseAdmin';

// Sem CORS: so o painel admin chama, com Authorization: Bearer (sessao do Supabase).
export default async function handler(req: any, res: any) {
  const log = (nivel: 'warn' | 'error', dados: Record<string, string | undefined>) =>
    console[nivel]('admin-reenvio', dados);

  let deps: ReturnType<typeof criarDepsReenvio>;
  try {
    // process.env lido por requisicao.
    const appUrl = process.env.APP_URL;
    if (!appUrl) throw new Error('APP_URL ausente');
    deps = criarDepsReenvio(criarClienteAdmin(), appUrl);
  } catch (e) {
    log('error', { etapa: 'configurar', erro: e instanceof Error ? e.name : 'desconhecido' });
    res.status(500).json({ erro: 'falha ao reenviar' });
    return;
  }

  const { status, corpo } = await tratarReenvio(
    {
      method: req.method,
      headers: req.headers ?? {},
      // Getter: o corpo so e lido depois da autenticacao e da checagem de admin.
      get body() {
        return req.body;
      },
    },
    { ...deps, agora: () => new Date(), toleranciaDias: TOLERANCIA_DIAS, log },
  );
  res.status(status).json(corpo);
}
