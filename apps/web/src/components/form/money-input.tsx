'use client';

import { parsePesosToCents } from '@estoicos/shared';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const format = (cents: number) =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(cents / 100);

/**
 * Monto en pesos. Se escribe como se escribe en Argentina ("15.000" o "15000,50") y el valor
 * viaja en centavos enteros. `null` = vacío.
 */
export function MoneyInput(props: {
  id?: string;
  value: number | null;
  onChange: (cents: number | null) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
  'aria-invalid'?: boolean;
}) {
  const [text, setText] = useState(props.value === null ? '' : format(props.value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const parsed = parsePesosToCents(text);
    if (parsed !== props.value) setText(props.value === null ? '' : format(props.value));
    // Solo cuando cambia el valor desde afuera.
  }, [props.value]);

  return (
    <div className={cn('relative', props.className)}>
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
        $
      </span>
      <Input
        id={props.id}
        inputMode="decimal"
        className="pl-7 tabular-nums"
        placeholder={props.placeholder ?? '0'}
        required={props.required}
        aria-invalid={invalid || props['aria-invalid']}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === '') {
            setInvalid(false);
            props.onChange(null);
            return;
          }
          const cents = parsePesosToCents(e.target.value);
          setInvalid(cents === null);
          if (cents !== null) props.onChange(cents);
        }}
        onBlur={() => {
          const cents = parsePesosToCents(text);
          if (cents !== null) setText(format(cents));
        }}
      />
    </div>
  );
}

/** Porcentaje (0 a 100, con hasta 2 decimales) que viaja en puntos básicos: 45 % = 4500. */
export function PercentInput(props: {
  id?: string;
  value: number | null;
  onChange: (bps: number | null) => void;
  placeholder?: string;
  allowNegative?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(props.value === null ? '' : String(props.value / 100).replace('.', ','));

  useEffect(() => {
    const current = Math.round(Number(text.replace(',', '.')) * 100);
    if (props.value !== null && current !== props.value) setText(String(props.value / 100).replace('.', ','));
    if (props.value === null && text !== '') setText('');
  }, [props.value]);

  return (
    <div className={cn('relative', props.className)}>
      <Input
        id={props.id}
        inputMode="decimal"
        className="pr-8 tabular-nums"
        placeholder={props.placeholder}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw.trim() === '') return props.onChange(null);
          const value = Number(raw.replace(',', '.'));
          if (Number.isFinite(value) && (props.allowNegative || value >= 0))
            props.onChange(Math.round(value * 100));
        }}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
        %
      </span>
    </div>
  );
}
