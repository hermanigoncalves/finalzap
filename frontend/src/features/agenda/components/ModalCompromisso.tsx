import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Modal } from '../../../components/ui';
import { hojeISO } from '../../../lib/datas';
import {
  detectarConflitos,
  extrairErroConflito,
  formatarDataHoraSP,
  montarIntervaloSP,
} from '../regras.ts';
import type { Compromisso, NovoCompromissoInput } from '../tipos.ts';

interface ModalCompromissoProps {
  isOpen: boolean;
  onClose: () => void;
  existentes: readonly Compromisso[];
  compromissoEmEdicao?: Compromisso | null;
  aoSalvar: (dados: NovoCompromissoInput, id?: string) => Promise<void>;
}

const campoClasse =
  'w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-green-500';

export function ModalCompromisso({
  isOpen,
  onClose,
  existentes,
  compromissoEmEdicao,
  aoSalvar,
}: ModalCompromissoProps) {
  const inicioAtual = compromissoEmEdicao ? formatarDataHoraSP(compromissoEmEdicao.inicio) : null;
  const fimAtual = compromissoEmEdicao ? formatarDataHoraSP(compromissoEmEdicao.fim) : null;

  const [titulo, setTitulo] = useState(compromissoEmEdicao?.titulo ?? '');
  const [data, setData] = useState(inicioAtual?.dataISO ?? hojeISO());
  const [horaInicio, setHoraInicio] = useState(inicioAtual?.hora ?? '09:00');
  const [horaFim, setHoraFim] = useState(fimAtual?.hora ?? '');
  const [local, setLocal] = useState(compromissoEmEdicao?.local ?? '');
  const [descricao, setDescricao] = useState(compromissoEmEdicao?.descricao ?? '');
  const [conflitos, setConflitos] = useState<Compromisso[]>([]);
  const [conflitoServidor, setConflitoServidor] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(permitirConflito: boolean) {
    setErro(null);
    setConflitoServidor(null);
    if (!titulo.trim()) {
      setErro('Informe o título do compromisso.');
      return;
    }

    let intervalo: { inicio: string; fim: string };
    try {
      intervalo = montarIntervaloSP(data, horaInicio, horaFim);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Horário inválido.');
      return;
    }

    if (!permitirConflito) {
      const encontrados = detectarConflitos(
        { ...intervalo, ...(compromissoEmEdicao ? { id: compromissoEmEdicao.id } : {}) },
        existentes,
      );
      if (encontrados.length > 0) {
        setConflitos(encontrados);
        return;
      }
    }

    setSalvando(true);
    try {
      await aoSalvar(
        { titulo, data, horaInicio, horaFim, local, descricao, permitirConflito },
        compromissoEmEdicao?.id,
      );
      onClose();
    } catch (err) {
      const msgConflito = extrairErroConflito(err);
      if (msgConflito) {
        setConflitoServidor(msgConflito);
      } else {
        setErro(err instanceof Error ? err.message : 'Não foi possível salvar o compromisso.');
      }
    } finally {
      setSalvando(false);
    }
  }

  const temConflito = conflitos.length > 0 || Boolean(conflitoServidor);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={compromissoEmEdicao ? 'Remarcar Compromisso' : 'Novo Compromisso'}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enviar(false);
        }}
        className="space-y-4"
      >
        <div>
          <label htmlFor="agenda-titulo" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Título
          </label>
          <input
            id="agenda-titulo"
            type="text"
            required
            maxLength={200}
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex.: Dentista, Reunião com cliente"
            className={campoClasse}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="agenda-data" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Data
            </label>
            <input
              id="agenda-data"
              type="date"
              required
              value={data}
              onChange={(e) => {
                setData(e.target.value);
                setConflitos([]);
                setConflitoServidor(null);
              }}
              className={campoClasse}
            />
          </div>
          <div>
            <label htmlFor="agenda-inicio" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Início
            </label>
            <input
              id="agenda-inicio"
              type="time"
              required
              value={horaInicio}
              onChange={(e) => {
                setHoraInicio(e.target.value);
                setConflitos([]);
                setConflitoServidor(null);
              }}
              className={campoClasse}
            />
          </div>
          <div>
            <label htmlFor="agenda-fim" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Término (opcional)
            </label>
            <input
              id="agenda-fim"
              type="time"
              value={horaFim}
              onChange={(e) => {
                setHoraFim(e.target.value);
                setConflitos([]);
                setConflitoServidor(null);
              }}
              className={campoClasse}
            />
          </div>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Se o término ficar em branco, será usada a duração padrão de 60 minutos (fuso Brasília).
        </p>

        <div>
          <label htmlFor="agenda-local" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Local (opcional)
          </label>
          <input
            id="agenda-local"
            type="text"
            maxLength={200}
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            placeholder="Ex.: Clínica Centro, Google Meet"
            className={campoClasse}
          />
        </div>

        <div>
          <label htmlFor="agenda-desc" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            Observações (opcional)
          </label>
          <textarea
            id="agenda-desc"
            rows={2}
            maxLength={1000}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className={campoClasse}
          />
        </div>

        {temConflito && (
          <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 text-amber-900 dark:text-amber-200 text-sm space-y-2">
            <div className="flex items-start gap-2 font-medium">
              <AlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>Conflito de horário detectado</span>
            </div>
            {conflitoServidor && <p className="text-xs">{conflitoServidor}</p>}
            {conflitos.length > 0 && (
              <ul className="list-disc list-inside text-xs space-y-0.5">
                {conflitos.map((c) => {
                  const ini = formatarDataHoraSP(c.inicio);
                  const fm = formatarDataHoraSP(c.fim);
                  return (
                    <li key={c.id}>
                      {c.titulo} ({ini.data} {ini.hora}–{fm.hora})
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={salvando}
                onClick={() => void enviar(true)}
              >
                Agendar mesmo assim
              </Button>
            </div>
          </div>
        )}

        {erro && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {erro}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button type="submit" disabled={salvando}>
            {salvando ? 'Salvando...' : compromissoEmEdicao ? 'Salvar alteração' : 'Agendar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
