# geo-referencia-service

Microservicio de referencia geografica de Paraguay (SIFEN/INE), con jerarquia
de 4 niveles: **Departamento -> Distrito -> Ciudad/Localidad -> Barrio**.

- Persistencia: SQLite (`better-sqlite3`), un solo archivo `data/geo.db`.
- Ingest: parsea el excel de origen (`exceljs`), normaliza a 4 tablas y aplica
  altas/bajas/modificaciones por diff contra el estado actual de `geo.db`.
- Query: servicio Express que carga todo `geo.db` a un cache en memoria
  (arbol anidado) al arrancar, y lo recarga automaticamente cuando `geo.db`
  cambia.

## Estructura

```
geo-referencia-service/
├── data/
│   ├── CÓDIGO DE REFERENCIA GEOGRAFICA...xlsx   (excel de origen)
│   └── geo.db                                    (se genera con el ingest)
├── scripts/
│   └── ingest.js              CLI: corre el ingest
├── src/
│   ├── config.js              rutas y puerto
│   ├── db/
│   │   ├── schema.sql          DDL de las 4 tablas + ingest_runs
│   │   └── connection.js       apertura de better-sqlite3 (WAL, FKs)
│   ├── ingest/
│   │   ├── excelReader.js      lee el xlsx, detecta columnas por keyword
│   │   ├── hash.js              hash por fila (sha1) para detectar cambios
│   │   ├── diff.js              sincroniza un nivel: altas/bajas/mods
│   │   └── run.js               orquesta los 4 niveles en una transaccion
│   ├── server/
│   │   ├── cache.js             arbol en memoria + getters por nivel
│   │   ├── watcher.js           fs.watch sobre geo.db -> recarga cache
│   │   ├── app.js               Express app + rutas + health
│   │   └── index.js             bootstrap (ensureDb, cache, watcher, listen)
│   └── routes/
│       └── geo.js               los 4 endpoints REST
└── package.json
```

## Instalacion

```bash
npm install
```

`better-sqlite3` es un modulo nativo: la instalacion descarga un binario
precompilado para tu plataforma/version de Node. Si falla, revisa que tengas
una version de Node LTS soportada o herramientas de build instaladas.

## 1. Ingest (excel -> geo.db)

```bash
npm run ingest
# o, para apuntar a otro archivo:
node scripts/ingest.js "data/otro_archivo.xlsx"
```

Que hace:

1. Busca el primer `.xlsx` en `data/` (o el que se pase por argumento).
2. Detecta automaticamente, por palabras clave en los encabezados, las
   columnas de codigo/nombre de cada nivel (departamento, distrito,
   ciudad/localidad, barrio) — no depende de nombres exactos de columna.
3. Lee todas las filas (se asume una fila por barrio, con los codigos/nombres
   de departamento/distrito/ciudad repetidos en cada fila).
4. Para cada nivel, de arriba hacia abajo, compara contra `geo.db`:
   - **Alta**: codigo nuevo (o reaparece tras estar de baja) -> insert.
   - **Modificacion**: mismo codigo, nombre distinto -> update + nuevo hash.
   - **Baja**: codigo que ya no aparece en el excel -> soft delete
     (`is_active = 0`), no se borra la fila. Si el padre se da de baja, los
     hijos quedan automaticamente fuera del arbol activo en la proxima
     corrida (se detectan como baja tambien).
5. Aplica todo en una unica transaccion SQLite.
6. Guarda un resumen en la tabla `ingest_runs` y lo imprime en consola.

Los `id` (autoincrement) son estables entre corridas mientras el codigo natural
del registro no cambie, asi las FK (`departamento_id`, `distrito_id`,
`ciudad_id`) nunca quedan huerfanas.

Se puede re-correr el ingest cuantas veces se quiera (por ejemplo cuando INE
publica una nueva version del excel); solo se aplican los diffs.

## 2. Query service

```bash
npm start        # producción
npm run dev       # con --watch (reinicia el proceso al cambiar el codigo)
```

Al arrancar:

1. Se asegura de que exista el schema en `geo.db` (por si el servicio arranca
   antes del primer ingest).
2. Carga todo `geo.db` (solo filas activas) a un cache en memoria, indexado
   por id y agrupado por padre para lookups O(1).
3. Arranca un `fs.watch` sobre la carpeta de `geo.db`: cualquier escritura
   (incluye los sidecars `-wal`/`-shm` de WAL) dispara, con debounce de
   400ms, una recarga completa del cache. Correr `npm run ingest` con el
   servidor ya arriba actualiza el cache sin reiniciar el proceso.
4. Expone los endpoints en `http://localhost:3000` (o `PORT` si se define).

### Endpoints

| Metodo | Ruta                              | Descripcion                         |
|--------|-----------------------------------|--------------------------------------|
| GET    | `/departamentos`                        | Lista todos los departamentos                        |
| GET    | `/departamentos/:id/distritos`          | Distritos de un departamento (por path)               |
| GET    | `/distritos?departamento_id=:id`        | Mismo resultado, filtrando por query param            |
| GET    | `/distritos/:id/ciudades`               | Ciudades/localidades de un distrito (por path)         |
| GET    | `/ciudades?distrito_id=:id`             | Mismo resultado, filtrando por query param            |
| GET    | `/ciudades/:id/barrios`                 | Barrios de una ciudad (por path)                       |
| GET    | `/barrios?ciudad_id=:id`                | Mismo resultado, filtrando por query param            |
| GET    | `/health`                               | Estado + conteos del cache                             |
| GET    | `/docs`                                  | Swagger UI (documentacion interactiva, "Try it out")  |
| GET    | `/openapi.json`                          | Spec OpenAPI 3.0 en JSON (tambien esta en `openapi.yaml`) |

Las rutas por query param son equivalentes a las anidadas por path (mismo
cache, misma respuesta); se agregaron para poder pedir "los hijos de X" sin
tener que armar la ruta anidada. Si falta el parametro responde `400`, si el
id no existe responde `404`, igual que la version por path.

Ejemplo:

```
GET /departamentos/1/distritos        == GET /distritos?departamento_id=1
GET /distritos/236/ciudades           == GET /ciudades?distrito_id=236
GET /ciudades/1/barrios                == GET /barrios?ciudad_id=1
```

Con el servidor arriba, abrí `http://localhost:3000/docs` en el navegador para
probar los endpoints desde ahí, o importá `openapi.yaml` en Postman/Insomnia.

`:id` es el id interno (autoincrement) devuelto en cada fila, no el codigo
INE/SIFEN original (ese se conserva en el campo `codigo` de cada registro).

Ejemplo de respuesta de `/departamentos`:

```json
[
  { "id": 1, "codigo": "01", "nombre": "CONCEPCION" },
  { "id": 2, "codigo": "02", "nombre": "SAN PEDRO" }
]
```

Si el `:id` del padre no existe (o esta dado de baja), la respuesta es
`404 { "error": "... no encontrado" }`. Si el padre existe pero no tiene
hijos activos, la respuesta es `200 []`.

## Notas de diseño

- **Localidades sin barrios**: en el excel real, ~6600 de las 7735 filas
  tienen la columna de barrio en blanco (la localidad no tiene una
  subdivision en barrios formalmente codificada). En esos casos el ingest no
  descarta la fila: crea un unico barrio que representa a toda la localidad,
  reutilizando el codigo y el nombre de la ciudad/localidad. Asi
  `ciudades/:id/barrios` siempre devuelve al menos un elemento para toda
  ciudad activa.
- **Por que soft delete y no borrar filas**: preserva auditoria/historial y
  evita romper referencias externas que ya hayan guardado un `id`.
- **Por que cache en memoria en vez de consultar SQLite en cada request**: el
  dataset es chico (~18/272/6766/7735 filas) y cabe comodo en memoria; los 4
  endpoints quedan O(1) sin tocar disco por request.
- **Por que `fs.watch` sobre el directorio y no sobre el archivo**: con
  `journal_mode = WAL`, las escrituras van a `geo.db-wal` y no siempre
  disparan un evento directo sobre `geo.db`; observar el directorio y
  filtrar por los 4 nombres relevantes es mas confiable.
