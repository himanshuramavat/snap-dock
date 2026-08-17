import type { ReactNode } from 'react';

/** Layout primitives for the settings page. Presentational only. */

export function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="sd-panel">
      <header className="sd-panel__head">
        <h2 className="sd-panel__title">{title}</h2>
        {description ? <p className="sd-panel__desc">{description}</p> : null}
      </header>
      <div className="sd-panel__body">{children}</div>
    </section>
  );
}

export function Setting({
  label,
  description,
  control,
  layout = 'inline',
  htmlFor,
}: {
  label: string;
  description?: string;
  control: ReactNode;
  layout?: 'inline' | 'stacked' | 'switch';
  htmlFor?: string;
}) {
  const className =
    layout === 'stacked'
      ? 'sd-setting sd-setting--stacked'
      : layout === 'switch'
        ? 'sd-setting sd-setting--switch'
        : 'sd-setting';

  return (
    <div className={className}>
      <div>
        <label className="sd-setting__label" htmlFor={htmlFor}>
          {label}
        </label>
        {description ? <p className="sd-setting__desc">{description}</p> : null}
      </div>
      <div
        className={`sd-setting__control${layout === 'stacked' ? ' sd-setting__control--full' : ''}`}
      >
        {control}
      </div>
    </div>
  );
}
