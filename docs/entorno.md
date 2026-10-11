# Notas del entorno de desarrollo

## iCloud vacía archivos de `node_modules` — RESUELTO (03/10/2026)

El proyecto vive en `~/Documents`, que en esta Mac está sincronizada con iCloud Drive. iCloud
descarga los archivos **bajo demanda**: cuando necesita espacio, los vacía y deja solo una
referencia. Con documentos no molesta; con `node_modules` rompe todo, porque Node abre el
archivo, lo lee vacío y falla con errores que no tienen nada que ver con el código:

```
TypeError: r.register is not a function          (tsx)
TypeError: _semver.default.satisfies is not a function   (next)
Error: Invalid package config .../vitest/package.json
Error: spawn ENOEXEC                             (esbuild)
```

También deja copias en conflicto: `package 2.json`, `routes-manifest 2.json`, etc.

**La solución:** macOS **no sincroniza nada que termine en `.nosync`**. En `pnpm-workspace.yaml`
está configurado `virtualStoreDir: .pnpm.nosync`, así los paquetes reales (casi 1 GB) viven en
`.pnpm.nosync/` y `node_modules/` queda con unos pocos atajos. iCloud no los toca más.

Si alguna vez volviera a pasar, el parche manual es:

```bash
# 1. Forzar la descarga de todas las dependencias (85 MB, tarda unos minutos).
find node_modules -type f -print0 | xargs -0 -P 8 -n 200 cat > /dev/null

# 2. Borrar las copias en conflicto que dejó iCloud.
find . -path ./node_modules -prune -o -name "* [0-9].*" -print -delete
```

Si después de eso algo sigue roto, el archivo se bajó mal y hay que reinstalar:

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install --frozen-lockfile
```

Si el problema reapareciera en `.next/` (la carpeta de compilación), alcanza con borrarla y
volver a compilar.

## Node 24, no 25

El proyecto está fijado en **Node 24** (`.nvmrc`) y Prisma 7 **no soporta Node 25**: avisa en
cada instalación. En esta Mac el `node` por defecto es el 25, así que hay que anteponer el 24:

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
```

## Levantar el sistema

**Importante:** hay que arrancarlo desde una terminal propia. macOS le da **prioridad baja** a los
procesos lanzados en segundo plano por otra herramienta, y el API puede tardar minutos en cargar
en vez de segundos.

Una pestaña de Terminal por servicio, y en todas primero:

```bash
cd ~/Documents/Sistema\ Estoicos
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"   # el proyecto usa Node 24, no el 25
```

Después, una por pestaña:

```bash
cd apps/api && PORT=4000 node --import tsx/esm src/main.ts
cd apps/worker && node --import tsx/esm src/main.ts
cd apps/web && ./node_modules/.bin/next start --port 3000   # antes: pnpm --filter @estoicos/web build
```

Queda en `http://localhost:3000` (y desde el celular en la misma red, por la IP de la Mac).

`pnpm dev` también sirve y recompila sola la web al guardar, pero es más lenta de arrancar. El API
**no** recarga solo con ninguno de los dos métodos: si cambia código del servidor, hay que
reiniciarlo.

Para matar todo antes de reiniciar (ojo: `next dev` se llama `next-server` y sobrevive a un
`pkill -f "next dev"`):

```bash
pkill -f "next-server"; pkill -f "node --import tsx"; lsof -ti:3000,4000 | xargs kill -9
```
