// Textos de la interfaz en español (neutro, tuteo). Traducción del diccionario base pt-BR.
// Claves: área.significado. {nombre} se sustituye en tiempo de ejecución y debe aparecer igual en la traducción.
// Los nombres de teclas (Ctrl, Shift, Alt, Tab, Esc, Del, Delete, Enter) no se traducen.
export default {
  // ---- Comunes (el mismo texto en varios lugares) ----
  'common.undo': 'Deshacer (Ctrl+Z)',  // sugerencia de botón
  'common.redo': 'Rehacer (Ctrl+Shift+Z)',  // sugerencia de botón
  'common.close': 'Cerrar',  // sugerencia del botón ×
  'common.save': 'Guardar',  // botón
  'common.delete': 'Eliminar',  // botón (carpeta, documento, tema, elemento de la pizarra)
  'common.duplicate': 'Duplicar',  // botón / elemento de menú
  'common.move': 'Mover',  // botón: abre el menú "Mover a"
  'common.rename': 'Renombrar',  // botón
  'common.restore': 'Restaurar',  // botón (papelera e historial de versiones)
  'common.moreOptions': 'Más opciones',  // sugerencia del botón "…"
  'common.link': 'Enlace',  // dirección web asociada a un tema o elemento
  'common.clickToRename': 'Haz clic para renombrar',  // sugerencia sobre el título del documento o de la carpeta
  'common.imageTypeError': 'Usa una imagen PNG, JPG, GIF o WEBP.',
  'key.space': 'Espacio',  // nombre de la barra espaciadora

  // ---- Selector de idioma ----
  'lang.select': 'Idioma',  // sugerencia y etiqueta accesible del selector

  // ---- Barra superior ----
  'topbar.docOptions': 'Opciones del mapa',  // sugerencia del botón "…" junto al título (vale también para pizarras)
  'topbar.present': 'Presentar',  // sugerencia: modo presentación
  'topbar.logout': 'Cerrar sesión',  // sugerencia: terminar la sesión
  'topbar.maps': 'Mapas',
  'topbar.boards': 'Pizarras',
  'topbar.listMaps': 'Ver mapas',
  'topbar.listBoards': 'Ver pizarras',

  // ---- Estado del guardado automático (texto en la parte superior) ----
  'status.saved': 'Guardado',
  'status.saving': 'Guardando…',
  'status.conflict': 'Mapa modificado en otra pestaña — recarga',
  'status.saveError': 'Error al guardar — reintentando',

  // ---- Documentos (mapa mental o pizarra) ----
  'doc.centralTopic': 'Tema central',  // texto del tema central de un mapa nuevo
  'doc.untitledBoard': 'Pizarra sin título',  // título de una pizarra nueva
  'doc.untitled': '(sin título)',  // se muestra en la lista para un documento sin título
  'doc.copySuffix': ' (copia)',  // se añade al título al duplicar; conserva el espacio inicial
  'doc.moveToTrash': 'Mover a la papelera',  // elemento de menú
  'doc.trashConfirmMap': '¿Eliminar el mapa "{title}"? Irá a la papelera, desde donde puedes restaurarlo.',
  'doc.trashConfirmBoard': '¿Eliminar la pizarra "{title}"? Irá a la papelera, desde donde puedes restaurarla.',
  'doc.unsavedLeaveConfirm': 'Este documento tiene cambios sin guardar (error al guardar). ¿Salir de todos modos y perderlos?',
  'doc.duplicateError': 'No se pudo duplicar el mapa.',  // vale también para pizarras

  // ---- Lista de documentos (página de inicio) ----
  'list.root': 'Mis mapas',  // título de la página y nombre de la carpeta raíz (ruta y menú "Mover a")
  'list.newFolder': 'Nueva carpeta',  // botón
  'list.newBoard': 'Nueva pizarra',  // botón
  'list.newMap': 'Nuevo mapa',  // botón
  'list.searchPlaceholder': 'Buscar mapas, pizarras y carpetas',  // texto de ejemplo del campo de búsqueda
  'list.sortBy': 'Ordenar',  // sugerencia del selector de orden
  'list.sortRecent': 'Modificados recientemente',
  'list.sortOldest': 'Modificados hace más tiempo',
  'list.sortAz': 'Nombre (A–Z)',
  'list.sortZa': 'Nombre (Z–A)',
  'list.empty': 'Aún no hay mapas. Crea el primero.',
  'list.noMaps': 'Aún no hay mapas.',
  'list.noBoards': 'Aún no hay pizarras.',
  'list.emptyFolder': 'Carpeta vacía.',
  'list.searchNoResults': 'No se encontró nada para “{query}”.',
  'list.createMapError': 'No se pudo crear el mapa.',
  'list.createBoardError': 'No se pudo crear la pizarra.',

  // ---- Carpetas ----
  'folder.moveTo': 'Mover a',  // título del menú con la lista de carpetas de destino
  'folder.newPrompt': 'Nombre de la nueva carpeta',  // pregunta al crear
  'folder.renamePrompt': 'Nombre de la carpeta',  // pregunta al renombrar
  'folder.deleteConfirm': '¿Eliminar la carpeta "{name}"? Lo que contiene (mapas, pizarras y subcarpetas) pasará a la carpeta superior.',
  'folder.saveError': 'No se pudieron guardar las carpetas.',

  // ---- Papelera ----
  'trash.title': 'Papelera ({n})',  // {n}: cantidad de documentos
  'trash.deletedAt': 'eliminado el {date}',  // {date}: fecha y hora ya formateadas
  'trash.purge': 'Eliminar para siempre',  // botón: borrado definitivo
  'trash.purgeConfirm': '¿Eliminar para siempre? No se puede deshacer.',
  'trash.restoreConflict': 'Ya existe un mapa con ese identificador; no se pudo restaurar.',

  // ---- Historial de versiones ----
  'history.title': 'Historial de versiones',  // sugerencia del botón y título del panel
  'history.hint': 'Una copia cada 2 min de edición · últimas 50',
  'history.empty': 'Aún no hay versiones anteriores.',
  'history.entryOne': '{title} · 1 tema',  // versión con un único tema
  'history.entryMany': '{title} · {n} temas',  // {n}: cantidad de temas (0 o más de 1)
  'history.restoreConfirm': '¿Restaurar esta versión? (Ctrl+Z deshace)',
  'history.loadError': 'No se pudo cargar esta versión.',

  // ---- Exportar ----
  'export.title': 'Exportar',  // sugerencia del botón
  'export.png': 'Imagen (PNG)',
  'export.pdf': 'PDF (imprimir / guardar)',
  'export.svg': 'Vector (SVG)',
  'export.md': 'Texto (Markdown)',
  'export.error': 'No se pudo exportar: {error}',
  'export.fileFallback': 'mapa',  // nombre del archivo exportado cuando el título no tiene letras ni números

  // ---- Errores técnicos (se insertan en {error} de otros mensajes) ----
  'error.fileTooLarge': 'archivo de más de 20 MB',
  'error.invalidImage': 'imagen no válida',

  // ---- Presentación ----
  'present.prev': 'Anterior (←)',  // sugerencia
  'present.next': 'Siguiente (→ o Espacio)',  // sugerencia
  'present.exit': 'Salir (Esc)',  // sugerencia: salir de la presentación

  // ---- Zoom (mapa y pizarra) ----
  'zoom.out': 'Alejar',  // sugerencia
  'zoom.in': 'Acercar',  // sugerencia
  'zoom.reset': 'Zoom 100%',  // sugerencia del botón que muestra el zoom actual
  'zoom.fit': 'Ajustar a la pantalla',  // sugerencia

  // ---- Mapa: barra sobre el tema seleccionado (sugerencias de los botones) ----
  'map.toolbar.style': 'Color y forma',
  'map.toolbar.text': 'Estilo del texto',
  'map.toolbar.image': 'Imagen',
  'map.toolbar.attachments': 'Adjuntos',
  'map.toolbar.comments': 'Comentarios (Alt+Shift+C)',
  'map.toolbar.delete': 'Eliminar (Del)',
  'map.connect': 'Conectar con otro tema',  // sugerencia y elemento de menú: crear una conexión (flecha) hasta otro tema
  'map.addChild': 'Nuevo subtema (Tab)',  // sugerencia del botón "+"
  'map.addSibling': 'Nuevo tema hermano (Enter)',  // sugerencia del botón "+"
  'map.hint.child': 'subtema',  // sugerencia corta junto a la tecla Tab: crea un subtema
  'map.hint.sibling': 'hermano',  // sugerencia corta junto a la tecla Enter: crea un tema hermano
  'map.outline': 'Esquema (Alt+Shift+O)',  // sugerencia: ver el mapa como lista editable
  'map.openError': 'No se pudo abrir este mapa: su archivo está dañado.',

  // ---- Mapa: menú del tema ----
  'map.menu.child': 'Nuevo subtema',
  'map.menu.sibling': 'Nuevo tema hermano',
  'map.menu.collapse': 'Contraer / expandir',  // elemento de menú y sugerencia del marcador en el esquema
  'map.menu.focus': 'Enfocar esta rama',
  'map.menu.showBranchAs': 'Mostrar rama como',  // seguido de las opciones de diseño
  'map.menu.copyBranch': 'Copiar rama',
  'map.menu.cutBranch': 'Cortar rama',
  'map.menu.pasteBranch': 'Pegar rama',

  // ---- Mapa: diseño ----
  'map.layout.title': 'Diseño',  // sugerencia del selector
  'map.layout.map': 'Mapa',  // mapa mental (ramas hacia ambos lados)
  'map.layout.org': 'Organigrama',
  'map.layout.list': 'Lista',

  // ---- Mapa: modo enfoque ----
  'map.focus.label': 'Enfoque:',  // seguido del nombre de la rama enfocada
  'map.focus.exit': 'Salir del enfoque',  // botón

  // ---- Mapa: imagen del tema ----
  'map.image.drop': 'Suelta la imagen aquí o haz clic para elegirla',
  'map.image.formats': 'PNG, JPG, GIF o WEBP · hasta 20 MB',
  'map.image.remove': 'Quitar imagen',
  'map.image.addError': 'No se pudo añadir la imagen: {error}',

  // ---- Mapa: adjuntos del tema ----
  'map.attach.title': 'Adjuntos',  // título del panel
  'map.attach.add': 'Añadir archivos',
  'map.attach.hint': 'Suelta aquí o haz clic · hasta 20 MB cada uno',
  'map.attach.remove': 'Quitar adjunto',  // sugerencia del botón ×
  'map.attach.uploadError': 'No se pudo subir el archivo: {error}',

  // ---- Mapa: comentarios del tema ----
  'map.comment.placeholder': 'Añadir comentario',  // texto de ejemplo del campo
  'map.comment.send': 'Enviar (Enter)',  // sugerencia
  'map.comment.delete': 'Eliminar comentario',  // sugerencia del botón ×

  // ---- Mapa: estilo del texto del tema ----
  'map.text.bold': 'Negrita (Ctrl+B)',  // sugerencia
  'map.text.italic': 'Cursiva (Ctrl+I)',  // sugerencia
  'map.text.size': 'Tamaño',
  'map.text.small': 'Pequeño',
  'map.text.medium': 'Mediano',
  'map.text.large': 'Grande',
  'map.text.color': 'Color del texto',

  // ---- Mapa: enlace del tema ----
  'map.url.placeholder': 'Dirección (https://…)',  // texto de ejemplo del campo: dirección web
  'map.url.invalid': 'Usa una dirección http:// o https://',
  'map.url.remove': 'Quitar enlace',

  // ---- Mapa: panel "Color y forma" ----
  'map.style.tabShape': 'Forma',  // pestaña
  'map.style.tabBorder': 'Borde',  // pestaña
  'map.style.tabLine': 'Línea',  // pestaña: la línea que une el tema con su padre
  'map.style.themeColors': 'Colores del tema',
  'map.style.customColors': 'Colores personalizados',
  'map.style.pickColor': 'Elegir color',  // sugerencia del botón "+"
  'map.style.auto': 'Automático',  // sugerencia de la muestra: color automático (el de la rama)
  'map.style.noFill': 'Sin relleno',  // sugerencia de la muestra
  'map.style.boundary': 'Mostrar como contorno',  // interruptor: área discontinua alrededor de la rama
  'map.style.borderColor': 'Color del borde',
  'map.style.lineColor': 'Color de la línea al padre',
  'map.style.width': 'Grosor',  // del borde o de la línea
  'map.style.thin': 'Fino',
  'map.style.medium': 'Medio',
  'map.style.thick': 'Grueso',
  'map.style.style': 'Estilo',  // del borde o de la línea: sólido, discontinuo, punteado
  'map.style.solid': 'Sólido',
  'map.style.dashed': 'Discontinuo',
  'map.style.dotted': 'Punteado',

  // ---- Mapa: forma del tema (sugerencias) ----
  'map.shape.underline': 'Línea',  // solo un subrayado, sin caja
  'map.shape.rect': 'Rectángulo',
  'map.shape.rounded': 'Redondeado',
  'map.shape.pill': 'Elipse',
  'map.shape.cloud': 'Nube',

  // ---- Mapa: conexiones entre temas (flechas libres) ----
  'map.link.color': 'Color',  // sugerencia
  'map.link.startMarker': 'Extremo inicial',  // sugerencia: marcador al inicio de la conexión
  'map.link.endMarker': 'Extremo final',  // sugerencia: marcador al final de la conexión
  'map.link.swap': 'Invertir dirección',  // sugerencia
  'map.link.addLabel': 'Añadir etiqueta',  // elemento de menú
  'map.link.delete': 'Eliminar conexión',  // elemento de menú
  'map.link.labelPrompt': 'Etiqueta de la conexión',  // pregunta
  'map.link.exitTop': 'Salir por arriba',  // sugerencia: lado del tema por el que sale la conexión
  'map.link.exitRight': 'Salir por la derecha',
  'map.link.exitBottom': 'Salir por abajo',
  'map.link.exitLeft': 'Salir por la izquierda',

  // ---- Pizarra: herramientas (sugerencias; entre paréntesis, las teclas de atajo) ----
  'board.tool.hand': 'Mover el lienzo (H o Espacio)',
  'board.tool.select': 'Seleccionar (V o 1)',
  'board.tool.rectangle': 'Rectángulo (R o 2)',
  'board.tool.diamond': 'Rombo (D o 3)',
  'board.tool.ellipse': 'Elipse (O o 4)',
  'board.tool.arrow': 'Flecha (A o 5)',
  'board.tool.line': 'Línea (L o 6)',
  'board.tool.freedraw': 'Lápiz (P o 7)',
  'board.tool.text': 'Texto (T o 8)',
  'board.tool.note': 'Nota adhesiva (N)',
  'board.tool.eraser': 'Borrador (E o 0)',
  'board.tool.more': 'Más herramientas',
  'board.tool.image': 'Insertar imagen',  // elemento de menú
  'board.tool.bucket': 'Bote de pintura',  // elemento de menú
  'board.tool.lasso': 'Selección de lazo',  // elemento de menú
  'board.tool.laser': 'Puntero láser',  // elemento de menú

  // ---- Pizarra: panel de estilo ----
  'board.props.stroke': 'Trazo',  // color del trazo
  'board.props.background': 'Fondo',  // color de fondo
  'board.props.noBackground': 'Sin fondo',  // sugerencia de la muestra transparente
  'board.props.fill': 'Relleno',
  'board.props.fillHachure': 'Tramado',
  'board.props.fillSolid': 'Sólido',
  'board.props.width': 'Grosor del trazo',  // del trazo
  'board.props.widthThin': 'Fino',
  'board.props.widthMedium': 'Medio',
  'board.props.widthThick': 'Grueso',
  'board.props.strokeStyle': 'Estilo del trazo',
  'board.props.strokeSolid': 'Sólido',
  'board.props.strokeDashed': 'Discontinuo',
  'board.props.strokeDotted': 'Punteado',
  'board.props.roughness': 'Irregularidad',  // cuán "hecho a mano" parece el trazo
  'board.props.roughArchitect': 'Arquitecto',  // trazo recto, preciso
  'board.props.roughArtist': 'Artista',  // algo irregular
  'board.props.roughCartoonist': 'Caricaturista',  // muy irregular
  'board.props.fontFamily': 'Tipo de fuente',
  'board.props.fontHand': 'A mano',
  'board.props.fontNormal': 'Normal',
  'board.props.fontCode': 'Código',  // fuente monoespaciada
  'board.props.fontSize': 'Tamaño del texto',
  'board.props.sizeS': 'P',  // abreviatura de "pequeño" (etiqueta de botón)
  'board.props.sizeM': 'M',  // abreviatura de "mediano"
  'board.props.sizeL': 'G',  // abreviatura de "grande"
  'board.props.sizeXL': 'XG',  // abreviatura de "extra grande"
  'board.props.textAlign': 'Alinear texto',
  'board.props.alignLeft': 'Izquierda',
  'board.props.alignCenter': 'Centrado',
  'board.props.alignRight': 'Derecha',
  'board.props.opacity': 'Opacidad',
  'board.props.layers': 'Capas',  // orden de apilamiento
  'board.props.toBack': 'Enviar al fondo',
  'board.props.backward': 'Enviar hacia atrás',
  'board.props.forward': 'Traer hacia adelante',
  'board.props.toFront': 'Traer al frente',
  'board.props.actions': 'Acciones',
  'board.props.link': 'Enlace (Ctrl+K)',  // sugerencia

  // ---- Pizarra: barra inferior y mensajes ----
  'board.zoomOut': 'Alejar (Ctrl −)',  // sugerencia
  'board.zoomIn': 'Acercar (Ctrl +)',  // sugerencia
  'board.openError': 'No se pudo abrir esta pizarra: su archivo está dañado.',
  'board.image.insertError': 'No se pudo insertar la imagen: {error}',
  'board.link.prompt': 'Dirección del enlace (vacío lo quita)',  // pregunta
  'board.link.invalid': 'Usa una dirección http o https.',

  // ---- Pizarra: ayuda de atajos (las claves …Keys son la columna de las teclas) ----
  'board.help.button': 'Atajos (?)',  // sugerencia del botón
  'board.help.title': 'Atajos de la pizarra',
  'board.help.panKeys': 'H / Espacio',
  'board.help.pan': 'Mover el lienzo',
  'board.help.selectKeys': 'V o 1',
  'board.help.select': 'Seleccionar',
  'board.help.rectangleKeys': 'R o 2',
  'board.help.rectangle': 'Rectángulo',
  'board.help.diamondKeys': 'D o 3',
  'board.help.diamond': 'Rombo',
  'board.help.ellipseKeys': 'O o 4',
  'board.help.ellipse': 'Elipse',
  'board.help.arrowKeys': 'A o 5',
  'board.help.arrow': 'Flecha',
  'board.help.lineKeys': 'L o 6',
  'board.help.line': 'Línea',
  'board.help.freedrawKeys': 'P o 7',
  'board.help.freedraw': 'Lápiz',
  'board.help.image': 'Insertar imagen (o pegar con Ctrl+V, o arrastrar el archivo a la pizarra)',
  'board.help.laser': 'Puntero láser: rastro que desaparece solo (no se guarda)',
  'board.help.lasso': 'Selección de lazo: contorno libre (Shift añade a la selección)',
  'board.help.bucket': 'Bote de pintura: pinta el fondo de la forma (o el color de la línea/texto)',
  'board.help.textKeys': 'T o 8',
  'board.help.text': 'Texto (o doble clic); Enter salta de línea, Esc o clic fuera termina',
  'board.help.note': 'Nota adhesiva: un clic la crea y ya la edita; el texto se ajusta dentro',
  'board.help.eraserKeys': 'E o 0',
  'board.help.eraser': 'Borrador',
  'board.help.undoRedo': 'Deshacer / rehacer',
  'board.help.duplicate': 'Duplicar',
  'board.help.clipboard': 'Copiar / cortar / pegar (también entre pestañas y con otros programas)',
  'board.help.selectAll': 'Seleccionar todo',
  'board.help.link': 'Enlace en el elemento (clic en el icono para abrirlo)',
  'board.help.delete': 'Eliminar',
  'board.help.nudgeKeys': 'Flechas',  // las teclas de flecha del teclado
  'board.help.nudge': 'Mover 1 px (Shift: 10)',
  'board.help.layerStep': 'Una capa hacia adelante / hacia atrás',
  'board.help.layerEnds': 'Traer al frente / enviar al fondo',
  'board.help.zoomKeys': 'Ctrl+rueda, Ctrl ±',  // rueda = la rueda del ratón
  'board.help.zoom': 'Zoom',

  // ---- Página de inicio de sesión ----
  'login.title': 'Iniciar sesión · Brainstorm',  // título de la pestaña; "Brainstorm" es el nombre de la app, no se traduce
  'login.user': 'Usuario',  // etiqueta del campo
  'login.password': 'Contraseña',  // etiqueta del campo
  'login.submit': 'Entrar',  // botón
  'login.wrongCredentials': 'Usuario o contraseña incorrectos.',
  'login.tooManyAttempts': 'Demasiados intentos fallidos. Espera unos minutos y vuelve a intentarlo.',
  'login.failed': 'No se pudo iniciar sesión (HTTP {status}).',
  'login.noConnection': 'Sin conexión con el servidor.',
  'topbar.skills': 'Skills',
  'topbar.listSkills': 'Ver skills',
  'list.newSkill': 'Nuevo skill',
  'list.noSkills': 'Aún no hay skills.',
  'doc.untitledSkill': 'Skill sin título',
  'doc.trashConfirmSkill': '¿Mover el skill "{title}" a la papelera?',
  'list.createSkillError': 'No se pudo crear el skill.',
  'skill.template': '# {title}\n\n## Cuándo usar\n\n## Instrucciones\n',
};
