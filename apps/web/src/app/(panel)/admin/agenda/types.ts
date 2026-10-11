/** Datos que comparten el tablero de la agenda y sus diálogos. */
export interface AgendaService {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
}

export interface AgendaBarber {
  id: string;
  displayName: string;
  color: string | null;
}

export interface NewAppointmentDraft {
  barberId: string;
  date: string;
  time: string;
}
