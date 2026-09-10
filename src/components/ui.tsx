import type { CSSProperties, ReactNode } from 'react';

export function Card({
  title,
  subtitle,
  children,
  actions,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="card">
      {title && (
        <header className="card-head">
          <h2>{title}</h2>
          {subtitle && <p className="sub">{subtitle}</p>}
        </header>
      )}
      <div className="card-body">{children}</div>
      {actions && <footer className="card-foot">{actions}</footer>}
    </section>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'quiet',
  size = 'md',
  style,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'go' | 'quiet' | 'danger';
  size?: 'sm' | 'md';
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size}`}
      onClick={onClick}
      disabled={disabled}
      style={style}
      title={title}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Callout({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'bad' | 'info';
  children: ReactNode;
}) {
  return <div className={`callout callout-${tone}`}>{children}</div>;
}

export function Stat({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number | string;
  tone?: 'ok' | 'warn' | 'bad';
  onClick?: () => void;
}) {
  return (
    <div
      className={`stat${onClick ? ' stat-click' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <span className="stat-label">{label}</span>
      <span className={`stat-value${tone ? ` v-${tone}` : ''}`}>{value}</span>
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'accent';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p className="sub">{children}</p>}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="spinner">
      <span className="spinner-dot" />
      {label}
    </div>
  );
}
