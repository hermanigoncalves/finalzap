type BrandProps = {
  compact?: boolean;
  light?: boolean;
  className?: string;
};

export function BrandSymbol({ className = '', light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-xl ${light ? 'bg-white/10 ring-1 ring-white/20' : 'bg-brand-green-900'} ${className}`}>
      <svg viewBox="0 0 48 48" aria-hidden="true" className="h-[72%] w-[72%]">
        <path
          d="M10 7.5h28a5.5 5.5 0 0 1 5.5 5.5v15a5.5 5.5 0 0 1-5.5 5.5H25l-10 7v-7h-5A5.5 5.5 0 0 1 4.5 28V13A5.5 5.5 0 0 1 10 7.5Z"
          fill="none"
          stroke="white"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        <path d="M15 27v3m7-7v7m7-11v11" stroke="#10A36A" strokeWidth="3" strokeLinecap="round" />
        <path d="m14 23 7-6 6 3 8-8m-6 0h6v6" fill="none" stroke="#D4A417" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export default function Brand({ compact = false, light = false, className = '' }: BrandProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`} aria-label="FINALZAP by Sueli’s">
      <BrandSymbol light={light} className={compact ? 'h-9 w-9' : 'h-14 w-14'} />
      <div className="leading-tight">
        <div className={`font-heading font-bold tracking-tight ${compact ? 'text-lg' : 'text-3xl'}`}>
          <span className={light ? 'text-white' : 'text-brand-green-900'}>FINAL</span>
          <span className="text-brand-gold-500">ZAP</span>
        </div>
        <p className={`mt-0.5 text-xs font-medium ${light ? 'text-white/75' : 'text-slate-600'}`}>by Sueli’s</p>
      </div>
    </div>
  );
}
