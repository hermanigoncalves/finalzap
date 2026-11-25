import { aplicarCors } from '../../lib/serverEnv';
import { CHAVES_CREDENCIAL, cifrarValor, decifrarValor, exigirAdmin, type ChaveCredencial } from '../../lib/admin/credenciais';

export default async function handler(req: any, res: any) {
  aplicarCors(req, res, 'GET, PUT, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = await exigirAdmin(req, res);
    if (!supabase) return;

    if (req.method === 'PUT') {
      const { chave, valor } = req.body ?? {};
      if (!CHAVES_CREDENCIAL.includes(chave)) return res.status(400).json({ error: 'Credencial inválida.' });
      const texto = typeof valor === 'string' ? valor.trim() : '';
      if (texto.length > 2000) return res.status(400).json({ error: 'Valor longo demais.' });

      const { error } = texto
        ? await supabase.from('credenciais_servico').upsert({ chave, valor: cifrarValor(texto), atualizado_em: new Date().toISOString() })
        : await supabase.from('credenciais_servico').delete().eq('chave', chave);
      if (error) throw error;
    }

    const { data, error } = await supabase.from('credenciais_servico').select('chave, valor');
    if (error) throw error;
    const salvas = new Map((data ?? []).map((l) => [l.chave as ChaveCredencial, l.valor as string]));
    const credenciais = CHAVES_CREDENCIAL.map((chave) => {
      const bruto = salvas.get(chave) || process.env[chave];
      const valor = bruto ? decifrarValor(bruto) : undefined;
      return { chave, configurada: !!valor, final: valor ? valor.slice(-4) : null };
    });
    return res.status(200).json({ credenciais });
  } catch (e: any) {
    console.error('[credenciais] falha:', e?.name);
    return res.status(500).json({ error: 'Erro interno.' });
  }
}
