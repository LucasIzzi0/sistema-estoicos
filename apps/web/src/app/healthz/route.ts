/** Chequeo de salud de la web para Railway durante el deploy. */
export function GET() {
  return Response.json({ status: 'ok' });
}
