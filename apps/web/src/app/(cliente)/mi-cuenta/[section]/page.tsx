import { CalendarPlus } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

const SECTIONS: Record<string, { title: string; text: string }> = {
  historial: {
    title: 'Historial',
    text: 'Acá vas a ver tus cortes anteriores: qué te hiciste, cuándo y con quién.',
  },
};

type Props = { params: Promise<{ section: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: SECTIONS[(await params).section]?.title ?? 'Mi cuenta' };
}

export default async function CustomerSection({ params }: Props) {
  const section = SECTIONS[(await params).section];
  if (!section) notFound();
  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-extrabold uppercase text-gold">{section.title}</h1>
      <div className="grid justify-items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
        <CalendarPlus className="size-8 text-muted-foreground" />
        <p className="max-w-xs text-muted-foreground">{section.text}</p>
      </div>
    </div>
  );
}
