import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { IconAlert, IconCheckCircle } from './icons';

export { formatBytes } from '@/utils/format';

/**
 * Shared presentational primitives.
 *
 * These hold no application state and know nothing about capture or Drive. They are
 * the vocabulary the popup and the options page are both written in, which is what
 * keeps the two surfaces looking like one product.
 */

/* ------------------------------------------------------------------ Button */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'default',
  size = 'md',
  block,
  loading,
  icon,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  const classes = [
    'sd-btn',
    variant !== 'default' ? `sd-btn--${variant}` : '',
    size !== 'md' ? `sd-btn--${size}` : '',
    block && size !== 'lg' ? 'sd-btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <span className="sd-spinner" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" className={`sd-icon-btn ${className}`} title={label} aria-label={label} {...rest}>
      {children}
    </button>
  );
}

/* -------------------------------------------------------------- Segmented */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  title?: string;
  disabled?: boolean;
}

/**
 * A radiogroup rendered as a segmented control.
 *
 * Implemented with roving arrow-key focus rather than a row of buttons so it behaves
 * the way a screen-reader user expects a set of exclusive choices to behave.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  compact,
  align = 'center',
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  compact?: boolean;
  /**
   * 'center' suits the popup, where options are short and the control is full width.
   * 'start' suits a settings row, where labels are longer and a left edge reads as
   * part of the form rather than as a floating pill.
   */
  align?: 'center' | 'start';
}) {
  const move = (delta: number): void => {
    const index = options.findIndex((option) => option.value === value);
    const enabled = options.filter((option) => !option.disabled);
    if (enabled.length === 0) return;
    const currentEnabled = Math.max(0, enabled.findIndex((option) => option.value === options[index]?.value));
    const next = enabled[(currentEnabled + delta + enabled.length) % enabled.length]!;
    onChange(next.value);
  };

  return (
    <div
      className={[
        'sd-segmented',
        compact ? 'sd-segmented--compact' : '',
        align === 'start' ? 'sd-segmented--start' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="radiogroup"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          disabled={option.disabled}
          title={option.title ?? option.label}
          className="sd-segmented__option"
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Controls */

export function Select<T extends string>({
  value,
  onChange,
  options,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <select
      className="sd-select"
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      {...rest}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="sd-switch"
      onClick={() => onChange(!checked)}
    />
  );
}

/* ---------------------------------------------------------------- Feedback */

export function ProgressBar({ ratio }: { ratio: number | null }) {
  const indeterminate = ratio === null;
  return (
    <div
      className={`sd-progress${indeterminate ? ' sd-progress--indeterminate' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(indeterminate ? {} : { 'aria-valuenow': Math.round(ratio * 100) })}
    >
      <div
        className="sd-progress__fill"
        style={indeterminate ? undefined : { width: `${Math.round(ratio * 100)}%` }}
      />
    </div>
  );
}

export function Banner({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'error' | 'warning' | 'success';
  children: ReactNode;
  action?: ReactNode;
}) {
  const Glyph = tone === 'success' ? IconCheckCircle : IconAlert;
  return (
    <div className={`sd-banner sd-banner--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone !== 'info' ? <Glyph size={15} className="sd-banner__icon" /> : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        {children}
        {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
      </div>
    </div>
  );
}
