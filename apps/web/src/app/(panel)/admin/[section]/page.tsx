import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ComingSoon } from '@/components/panel/coming-soon';

/** Módulos que se construyen en fases posteriores (docs/fase-0/07-plan-de-fases.md). */
const SECTIONS: Record<string, { title: string; phase: number; description: string; items: string[] }> = {
  puntos: {
    title: 'Puntos y Recompensas',
    phase: 7,
    description: 'Reglas de acumulación, vencimiento y catálogo de recompensas.',
    items: ['Canje en el cobro', 'Ajustes manuales con motivo'],
  },
};

type Props = { params: Promise<{ section: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const section = SECTIONS[(await params).section];
  return { title: section?.title ?? 'Panel' };
}

export default async function SectionPage({ params }: Props) {
  const section = SECTIONS[(await params).section];
  if (!section) notFound();
  return <ComingSoon {...section} />;
}
