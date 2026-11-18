import { periodoMesAtual, periodoValido, type Periodo } from '../lib/dashboardAdmin';
import { hojeISO } from '../lib/datas';

export default function FiltroPeriodo({ valor, onChange }: { valor: Periodo; onChange: (p: Periodo) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      {([['inicio', 'De'], ['fim', 'Até']] as const).map(([k, rotulo]) => (
        <label key={k} className="text-sm text-slate-600 dark:text-slate-300">
          <span className="block mb-1">{rotulo}</span>
          <input
            type="date"
            value={valor[k]}
            onChange={(e) => onChange({ ...valor, [k]: e.target.value })}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          />
        </label>
      ))}
      <button
        type="button"
        onClick={() => onChange(periodoMesAtual(hojeISO()))}
        className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        Mês atual
      </button>
      {!periodoValido(valor) && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">A data inicial deve ser anterior ou igual à final.</p>
      )}
    </div>
  );
}
