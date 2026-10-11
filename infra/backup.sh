#!/usr/bin/env bash
# Copia de seguridad de la base, con verificación de que se puede restaurar.
#
# Un backup que nunca se probó no es un backup. Este script hace las dos cosas:
#   1. Saca la copia (comprimida, con la fecha en el nombre).
#   2. La restaura en una base descartable y cuenta las filas de las tablas que importan.
# Si el paso 2 falla, el script termina con error: eso es lo que hay que alertar.
#
# Uso:
#   ./infra/backup.sh                      # copia + prueba de restauración
#   ./infra/backup.sh --solo-copia         # solo la copia (más rápido)
#   ./infra/backup.sh --restaurar <copia>  # restaura una copia puntual en la base de prueba
#
# Variables:
#   DATABASE_URL       de dónde se saca la copia (obligatoria)
#   BACKUP_DIR         dónde se guarda (por defecto ./backups)
#   BACKUP_RETAIN_DAYS cuántos días se conservan (por defecto 30)

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"
STAMP="$(date +%Y-%m-%d-%H%M)"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Falta DATABASE_URL." >&2
  exit 1
fi

# Tablas cuyo contenido no puede perderse: si alguna vuelve vacía, la copia no sirve.
TABLAS_CRITICAS=(organizations branches customers appointments sales payments points_entries)

copia() {
  mkdir -p "$BACKUP_DIR"
  local archivo="$BACKUP_DIR/estoicos-$STAMP.dump"
  echo "→ Copiando la base en $archivo"
  # Formato custom (-Fc): comprime y permite restaurar tablas sueltas.
  pg_dump --format=custom --no-owner --no-privileges --file="$archivo" "$DATABASE_URL"
  echo "   $(du -h "$archivo" | cut -f1)"
  echo "$archivo"
}

restaurar_y_verificar() {
  local archivo="$1"
  local base_prueba="estoicos_restore_test_$$"
  local admin_url="${DATABASE_URL%/*}/postgres"

  echo "→ Probando la restauración en $base_prueba"
  psql "$admin_url" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $base_prueba;"
  psql "$admin_url" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $base_prueba;"
  # La limpieza corre pase lo que pase: no se deja basura dando vueltas.
  trap 'psql "$admin_url" -q -c "DROP DATABASE IF EXISTS $base_prueba;" >/dev/null 2>&1 || true' EXIT

  pg_restore --no-owner --no-privileges --dbname="${DATABASE_URL%/*}/$base_prueba" "$archivo" >/dev/null

  local fallo=0
  for tabla in "${TABLAS_CRITICAS[@]}"; do
    local filas
    filas="$(psql "${DATABASE_URL%/*}/$base_prueba" -tAc "SELECT count(*) FROM \"$tabla\";" 2>/dev/null || echo "ERROR")"
    printf '   %-20s %s\n' "$tabla" "$filas"
    if [[ "$filas" == "ERROR" ]]; then
      echo "   ⚠️  No se pudo leer $tabla en la copia restaurada." >&2
      fallo=1
    fi
  done

  if [[ "$fallo" -eq 1 ]]; then
    echo "✗ La copia NO se pudo restaurar entera." >&2
    exit 1
  fi
  echo "✓ La copia se restaura y las tablas están."
}

limpiar_viejas() {
  echo "→ Borrando copias de más de $RETAIN_DAYS días"
  find "$BACKUP_DIR" -name 'estoicos-*.dump' -type f -mtime "+$RETAIN_DAYS" -print -delete || true
}

case "${1:-}" in
  --restaurar)
    [[ -n "${2:-}" ]] || { echo "Indicá qué copia restaurar." >&2; exit 1; }
    restaurar_y_verificar "$2"
    ;;
  --solo-copia)
    copia > /dev/null
    limpiar_viejas
    ;;
  *)
    archivo="$(copia | tail -1)"
    restaurar_y_verificar "$archivo"
    limpiar_viejas
    ;;
esac
