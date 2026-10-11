import type { Metadata, Viewport } from 'next';
import { Archivo, Geist, Playfair_Display } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });
const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-display' });
// La serif del cartel del local: se usa para la marca y para lo que ve el cliente.
const playfair = Playfair_Display({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-brand' });

export const metadata: Metadata = {
  title: { default: 'Estoicos', template: '%s · Estoicos' },
  description: 'Turnos, cobros y clientes de la barbería.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#111315' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" suppressHydrationWarning className={cn('font-sans', geist.variable, archivo.variable, playfair.variable)}>
      <body className="min-h-dvh antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
