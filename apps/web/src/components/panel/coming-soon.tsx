import { Construction } from 'lucide-react';
import { PageHeader } from './page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Pantalla de un módulo que se construye en una fase posterior. */
export function ComingSoon(props: { title: string; phase: number; description: string; items?: string[] }) {
  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <PageHeader title={props.title} />
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Construction className="size-5 text-muted-foreground" />
            <CardTitle className="text-lg">Llega en la Fase {props.phase}</CardTitle>
            <Badge variant="outline" className="ml-auto">
              En construcción
            </Badge>
          </div>
          <CardDescription>{props.description}</CardDescription>
        </CardHeader>
        {props.items && (
          <CardContent>
            <ul className="grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
              {props.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

/**
 * Nombre histórico del encabezado: hoy es el mismo `PageHeader` que usan las pantallas nuevas,
 * así todas se ven igual sin tener que tocarlas una por una.
 */
export { PageHeader as PageTitle } from './page-header';
