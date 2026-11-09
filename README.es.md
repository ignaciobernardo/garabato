<p align="center"><img src="docs/icon.png" width="88" alt=""></p>

<h1 align="center">Garabato</h1>

<p align="center">Raya cualquier página web mientras la grabas.</p>

<p align="center"><a href="README.md">English</a></p>

Garabato es una extensión de Chrome para revisar sitios web en voz alta. Graba la pestaña en la que
estás con tu cámara y micrófono, y mientras hablas puedes dibujar encima y dejar comentarios
anclados a la página. Cada comentario queda marcado con su minuto en el video. Al detener tienes un
**MP4**, los comentarios en **Markdown** y subtítulos **VTT**.

Sin cuenta, sin servidor, sin subir nada. Todo pasa en tu navegador y los archivos quedan en tu
carpeta de Descargas.

![Garabato en una landing: un título destacado, un botón encerrado, una flecha y tres comentarios con su minuto](docs/screenshot.png)

## Instalar

Garabato todavía no está en la Chrome Web Store, así que se carga como extensión sin empaquetar:

1. Clona o [descarga](https://github.com/ignaciobernardo/garabato/archive/refs/heads/main.zip) este repo.
2. Abre `chrome://extensions`, activa **Modo de desarrollador** y haz clic en
   **Cargar extensión sin empaquetar**. Elige la carpeta `extension`.
3. Fija Garabato desde el ícono de pieza de puzzle junto a la barra de direcciones.

En cualquier página, haz clic en el ícono o presiona **Alt+Shift+G** para mostrar u ocultar la barra.

Para probarlo sin instalar nada: `python3 -m http.server 8098` en el repo y abre
<http://localhost:8098/demo/>.

## Uso

| Tecla | Herramienta |
|---|---|
| V | Cursor (usar la página normal) |
| P | Lápiz |
| H | Destacador |
| A | Flecha (Shift = ángulos de 15°) |
| R | Rectángulo (Shift = cuadrado) |
| C | Comentario: clic en la página, escribe, ⌘↵ guarda |
| F | Tinta efímera: los trazos se borran solos a los ~3 s |
| L | Lista de comentarios |
| ⌘Z | Deshacer · Esc vuelve al cursor |

- **Grabar** pide compartir *esta pestaña*, cuenta 3-2-1 y graba la página con los dibujos, los
  comentarios, la burbuja de cámara y un halo que sigue al puntero (Chrome no incluye el cursor al
  capturar una pestaña). El audio mezcla tu micrófono con el sonido de la pestaña. Se puede pausar.
- La **cámara** se enciende sola al apretar Grabar y se apaga al terminar. Clic en el botón de
  cámara para verte antes de grabar; si la apagas, no sales en el video. La burbuja se arrastra; al
  pasar el mouse cambia de tamaño o se cierra.
- Los dibujos y comentarios quedan pegados al contenido al hacer scroll.
- Al detener se abre la **revisión**: el video con los comentarios en una línea de tiempo y como
  subtítulos. Clic en un comentario salta a ese momento. Desde ahí descargas el video, los
  comentarios o los subtítulos.

![La revisión: el video con marcas de comentarios en la línea de tiempo y la lista al lado](docs/review.png)

### Qué te llevas

El Markdown lista cada comentario con su minuto, el elemento donde hiciste clic y su texto, listo
para pegar en un issue o un ticket:

```md
# Comentarios · Tostado

http://localhost:8098/demo/

09-11-2026, 6:27:41 p. m. · 3 comentarios · video 00:11

1. **[00:01]** El título queda en 3 líneas en el laptop. Más corto: "Tostado esta semana."
   `div.wrap > section.hero > h1` — “Single-origin coffee, roasted this week.”
```

El video es MP4 H.264 a la resolución completa de la pestaña (2× en pantallas Retina) cuando Chrome
puede codificarlo, y WebM si no.

## Privacidad y permisos

- Garabato pide solo `activeTab` y `scripting`. Corre en una pestaña cuando haces clic en el ícono
  o usas el atajo, y nunca lee tus otras pestañas ni tu historial.
- No hace ninguna petición de red. Grabaciones y comentarios viven en memoria hasta que los
  descargas.
- Chrome pide permiso de cámara y micrófono por sitio, la primera vez que grabas ahí.

## Límites

- Si navegas a otra URL durante la grabación, se pierde (Garabato avisa antes de salir). Las
  navegaciones dentro de apps de una sola página no la cortan.
- No funciona en páginas `chrome://`, la Chrome Web Store ni el visor de PDF.
- Los comentarios viven en memoria: exporta el `.md` antes de recargar.
- Por ahora solo Chrome. Firefox no soporta la captura de pestaña con `preferCurrentTab`.

## Cómo funciona

- `extension/garabato.js` es toda la herramienta: un archivo, sin dependencias ni build. Dibuja su
  interfaz dentro de un Shadow DOM para que los estilos de la página no se metan, y también
  funciona como `<script>` normal (así lo usa la demo).
- La grabación usa `getDisplayMedia({ preferCurrentTab: true })` y `MediaRecorder`. El audio de la
  pestaña y el micrófono se mezclan con Web Audio.
- La burbuja de cámara y los dibujos son parte de la página, así que la captura los graba como
  todo lo demás.
- `extension/player.html` reproduce el video de revisión desde el origen de la extensión, para que
  CSP estrictos (como el de GitHub) no lo bloqueen.
- `extension/background.js` inyecta el script al hacer clic en el ícono.

## Idiomas

La interfaz está en inglés, o en español si tu navegador está en español. Todos los textos están en
el objeto `T` al comienzo de `garabato.js`; se agradecen pull requests con más idiomas.

## Contribuir

Issues y pull requests bienvenidos. No hay build: edita `extension/garabato.js`, haz clic en la
flecha de recargar de Garabato en `chrome://extensions` y recarga la página donde estás probando.
La demo es la forma más rápida de probar un cambio.

`scripts/pack.sh` arma el .zip para la Chrome Web Store.

## Licencia

[MIT](LICENSE)
