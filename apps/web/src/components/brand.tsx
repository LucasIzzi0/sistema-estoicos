import { cn } from '@/lib/utils';

/** Logotipo tipográfico (hasta tener el logo real de la marca). */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('brand-title text-xl uppercase', className)}>
      Estoicos<span className="text-gold">.</span>
    </span>
  );
}
