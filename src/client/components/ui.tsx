import { useEffect, useState, type ReactNode } from 'react';
import { formatMoney } from '../../shared/money';
import { useStore } from '../store';

export function Money({ cents, sign, className, decimals }: { cents: number; sign?: boolean; className?: string; decimals?: boolean }) {
  const { state } = useStore();
  const cls = sign ? (cents > 0 ? 'pos' : cents < 0 ? 'neg' : '') : '';
  return <span className={`money ${cls} ${className ?? ''}`}>{formatMoney(cents, state?.settings.currency ?? 'EUR', { sign, decimals })}</span>;
}

export const eur = (c: number, decimals = true) => formatMoney(c, 'EUR', { decimals });

export function Card({ title, actions, children, className, subtitle }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
          {actions && <div className="row gap-s">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'warn' | 'danger' | 'accent'; icon?: string }) {
  return (
    <div className={`stat ${tone ? `tone-${tone}` : ''}`}>
      <div className="stat-label">{icon && <span className="stat-icon">{icon}</span>}{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Progress({ ratio, color, height = 8, marker }: { ratio: number; color?: string; height?: number; marker?: number }) {
  const r = Math.max(0, ratio);
  const tone = r > 1 ? 'var(--danger)' : r > 0.85 ? 'var(--warn)' : color ?? 'var(--accent)';
  return (
    <div className="progress" style={{ height }} role="progressbar" aria-valuenow={Math.round(r * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${Math.min(100, r * 100)}%`, background: tone }} />
      {marker !== undefined && marker > 0 && marker < 1 && <div className="progress-marker" style={{ left: `${marker * 100}%` }} title="Avancement du mois" />}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'danger' | 'accent' | 'info' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Empty({ icon = '✨', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h4>{title}</h4>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h3>{title}</h3>
          <button className="btn-icon" onClick={onClose} aria-label="Fermer">✕</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Saisie d'un montant en euros, stocké en centimes. */
export function MoneyInput({ value, onChange, placeholder, allowNegative }: { value: number; onChange: (cents: number) => void; placeholder?: string; allowNegative?: boolean }) {
  const [text, setText] = useState(value ? (value / 100).toString().replace('.', ',') : '');
  useEffect(() => {
    const cur = Math.round(Number(text.replace(',', '.').replace(/\s/g, '')) * 100);
    if (cur !== value) setText(value ? (value / 100).toString().replace('.', ',') : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="input-money">
      <input
        inputMode="decimal"
        value={text}
        placeholder={placeholder ?? '0,00'}
        onChange={(e) => {
          const v = allowNegative ? e.target.value.replace(/[^\d,.\s-]/g, '') : e.target.value.replace(/[^\d,.\s]/g, '');
          setText(v);
          const n = Number(v.replace(',', '.').replace(/\s/g, ''));
          if (Number.isFinite(n)) onChange(Math.round(n * 100));
        }}
      />
      <span>€</span>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((i) => (
        <button key={i.value} role="tab" aria-selected={value === i.value} className={`tab ${value === i.value ? 'active' : ''}`} onClick={() => onChange(i.value)}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function ScopeToggle() {
  const { scope, setScope, state } = useStore();
  const partner = state?.settings.partnerName ?? 'Kelly';
  return (
    <Tabs
      value={scope}
      onChange={setScope}
      items={[{ value: 'me', label: '👤 Moi' }, { value: 'couple', label: `💞 Couple (avec ${partner})` }]}
    />
  );
}

export function Gauge({ ratio, label, sub }: { ratio: number; label: string; sub?: string }) {
  const r = Math.max(0, Math.min(1.2, ratio));
  const angle = Math.min(1, r) * 180;
  const color = ratio > 1 ? 'var(--danger)' : ratio > 0.85 ? 'var(--warn)' : 'var(--good)';
  const rad = (a: number) => ((180 - a) * Math.PI) / 180;
  const x = 60 + 48 * Math.cos(rad(angle));
  const y = 60 - 48 * Math.sin(rad(angle));
  return (
    <div className="gauge">
      <svg viewBox="0 0 120 70" aria-hidden>
        <path d="M12 60 A48 48 0 0 1 108 60" fill="none" stroke="var(--line)" strokeWidth="10" strokeLinecap="round" />
        {angle > 0 && <path d={`M12 60 A48 48 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />}
      </svg>
      <div className="gauge-label">
        <strong style={{ color }}>{label}</strong>
        {sub && <span className="muted small">{sub}</span>}
      </div>
    </div>
  );
}

export const ownerLabel = (o: string, partner = 'Kelly', me = 'Ange') => (o === 'ange' ? me : o === 'kelly' ? partner : 'Commun');

export const chartTheme = {
  grid: 'var(--line)',
  axis: { fontSize: 12, fill: 'var(--muted)' },
  tooltip: {
    contentStyle: { background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--text)' },
    labelStyle: { color: 'var(--muted)' },
  },
};

export const kEur = (v: number) => {
  const e = v / 100;
  return Math.abs(e) >= 1000 ? `${(e / 1000).toFixed(1).replace('.', ',')} k€` : `${Math.round(e)} €`;
};
