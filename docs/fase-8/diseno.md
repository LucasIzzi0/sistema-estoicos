# Pasada de diseño (29/09/2026)

Pedido del fundador: *"mejorá la UX/UI todo lo que puedas, hacela funcional pero linda"*. Esto es lo que se cambió y por qué. No se tocó ninguna regla de negocio: es todo presentación y uso.

## El criterio

Una barbería no es un banco. El sistema se usa **parado, con el celular en una mano**, entre corte y corte, y el cliente lo ve desde su teléfono. Entonces: pocos números pero grandes, botones que se pueden tocar sin apuntar, y que cada pantalla diga qué hacer cuando todavía no hay nada cargado.

## Lo que cambió

### Colores y tipografía

- **Neutros cálidos** en vez de grises fríos: el fondo tira a papel, no a pantalla de oficina. El burdeos de la marca quedó más profundo.
- **Modo oscuro sobre carbón**, no negro puro: de noche cansa menos y el burdeos se ve.
- Se agregaron dos colores de sistema que faltaban: **verde de "bien"** y **ámbar de "atención"**. Antes cada pantalla elegía el suyo a mano (uno usaba esmeralda, otro ámbar, otro rojo), así que lo mismo se veía distinto en cada lugar.
- **Sombras suaves** en las tarjetas: se despegan del fondo sin ensuciar.
- Una clase única para las **cifras grandes** (plata, cantidades), con números de ancho fijo: las columnas quedan alineadas y no bailan.

### Blancos táctiles

Botones y campos eran de 32 px de alto, pensados para mouse. Ahora:

| | Antes | Ahora |
|---|---|---|
| Botón normal | 32 px | 36 px |
| Botón grande (cobrar, reservar) | 36 px | **44 px** |
| Campos y desplegables | 32 px | 40 px |

44 px es la medida que recomiendan Apple y Google para tocar con el pulgar sin errarle.

### Pantallas

- **Dashboard**: las cuatro cifras del día ahora son tarjetas con ícono y color según cómo viene la cosa. "Cómo entró la plata" muestra una barra por medio de pago, así se ve la proporción de un vistazo. "Para resolver" pasó a ser una lista de filas clickeables con flecha. La ocupación de cada barbero cambia de color según cuán lleno está el día.
- **Reportes**: mismas tarjetas de números que el dashboard, para que se lean igual.
- **Venta (mostrador)**: el **total y el botón de cobrar quedan pegados abajo** mientras se scrollea la venta, con el total en grande. Es la acción que más se repite en el día.
- **Caja**: el efectivo esperado se destaca del resto de los medios de pago.
- **Agenda**: cada turno tiene una **barra de color a la izquierda** según su estado (reservado, confirmado, en curso, no vino). Se entiende de lejos, que es como se mira una agenda.
- **Clientes**: la fila entera lleva a la ficha (antes solo el nombre, aunque el cursor decía lo contrario) y cada cliente tiene su avatar con iniciales.
- **Inicio (lo que ve el cliente)**: portada con el degradé de la marca y las tres razones para reservar.
- **Reserva y portal del cliente**: el próximo turno se destaca sobre los demás; el encabezado acompaña al hacer scroll.
- **Acceso**: fondo con luz de la marca, en vez de un formulario sobre gris.

### Estados vacíos

Doce pantallas decían "Todavía no hay nada". Ahora cada una explica **qué es eso y qué hacer**, con su ícono y, cuando corresponde, el botón para empezar: servicios, recompensas, equipo, clientes, envíos, ventas, turnos del cliente, movimientos de puntos.

### Esperas

Diez pantallas del panel muestran ahora un **esqueleto** mientras cargan: se ve la forma de la pantalla en vez de un blanco, y no pega un salto cuando llegan los datos.

### Detalles

- **Claro / oscuro / como el sistema**: se elige desde el menú del usuario. Antes seguía siempre al sistema operativo, sin forma de cambiarlo.
- Página de **"esta página no existe"** con una salida, en vez del error crudo.
- Se respeta **"reducir movimiento"** del sistema operativo: si el usuario lo activó, las animaciones no corren.

## Lo que NO se tocó

Ninguna regla de negocio, ningún cálculo, ninguna ruta de la API ni permiso. La pasada es de presentación: los 320 tests siguen pasando igual.

## Verificado en el navegador

Se recorrieron las pantallas en escritorio (1280 px) y en celular (390 px), con el sistema compilado como en producción:

- Panel: dashboard, agenda, caja, venta, clientes, servicios, productos, barberos, puntos, reportes, notificaciones y configuración.
- Cliente: inicio, reserva y acceso.
- En el celular se confirmó que **el total y el botón de cobrar quedan siempre a mano**, sin tener que scrollear hasta el fondo de la venta.

Dos cosas que aparecieron al mirar las capturas y se corrigieron en el momento: un degradé cortaba con un borde duro en la pantalla de acceso, y dos degradés usaban una sintaxis de color que el navegador descarta.

## Segunda pasada (29/09/2026): identidad y velocidad del mostrador

### La marca, de verdad

Entró el cartel del local, así que el sistema dejó de usar colores inventados:

- **Azul medio oscuro, negro y dorado.** Sobre claro manda el azul (botones, lo activo) y el dorado queda para los detalles; sobre oscuro manda el dorado, como el cartel.
- **La serif del cartel** (Playfair Display) para la marca y los títulos de la cara pública.
- **Lo que ve el cliente va siempre en oscuro**: inicio, reserva y su cuenta. La portada repite el marco dorado, "Barbería", "Disciplina · Estilo · Actitud" y "Tu estilo, nuestra prioridad".
- El panel de trabajo queda claro: se lee mejor ocho horas seguidas.

### El día a día, más rápido

| Antes | Ahora |
|---|---|
| Cargar un servicio eran 4 toques (tipo → servicio → barbero → Agregar) | **Un toque**: los cuatro servicios están como botones con su precio, con el barbero elegido al lado |
| Con la caja cerrada te enterabas **al apretar Cobrar**, con el cliente esperando | Se avisa apenas se abre la venta, con el botón para abrirla |
| El que llega sin turno se registraba y después había que buscarlo en la agenda para cobrarle | **"Empezar y cobrar"**: queda registrado y se abre su cobro |
| El vuelto se calculaba tipeando con cuánto paga | **Botones con los billetes**: justo, $30.000, $40.000, $50.000 (se arman según el total) |

### Errores encontrados y corregidos

- En una venta vacía aparecía el botón "Cerrar venta (la pagó con puntos)" en vez de "Cobrar".
- El atajo de servicios quedaba deshabilitado en las ventas de mostrador (sin barbero del turno). Ahora lleva su propio selector de barbero, así nunca le carga la comisión al que no fue.
- Los billetes sugeridos eran irreales (ofrecía $50.000 para un corte de $25.000).
