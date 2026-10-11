'use client';

import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

/** Campo de código de 6 dígitos. Llama a onComplete apenas se completa. */
export function CodeInput(props: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <InputOTP
      maxLength={6}
      inputMode="numeric"
      pattern="^[0-9]*$"
      autoComplete="one-time-code"
      autoFocus
      value={props.value}
      onChange={props.onChange}
      onComplete={props.onComplete}
      disabled={props.disabled}
      containerClassName="justify-center"
    >
      <InputOTPGroup>
        {Array.from({ length: 6 }, (_, i) => (
          <InputOTPSlot key={i} index={i} className="size-11 text-lg" />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
