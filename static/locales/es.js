// UI strings in Spanish (neutral, informal "tú"), translated from the base dictionary (pt-BR).
// Keys: area.meaning. {name} is replaced at runtime and must appear unchanged in the translation.
// Key names (Ctrl, Shift, Alt, Tab, Esc, Del, Delete, Enter) are not translated.
export default {
  // ---- Common (same text in several places) ----
  'common.undo': 'Deshacer (Ctrl+Z)',  // button tooltip
  'common.redo': 'Rehacer (Ctrl+Shift+Z)',  // button tooltip
  'common.close': 'Cerrar',  // tooltip of the × button
  'common.save': 'Guardar',  // button
  'common.delete': 'Eliminar',  // button (folder, document, topic, board element)
  'common.duplicate': 'Duplicar',  // button / menu item
  'common.move': 'Mover',  // button: opens the "Move to" menu
  'common.rename': 'Renombrar',  // button
  'common.restore': 'Restaurar',  // button (trash and version history)
  'common.moreOptions': 'Más opciones',  // tooltip of the "…" button
  'common.link': 'Enlace',  // web address attached to a topic or element
  'common.clickToRename': 'Haz clic para renombrar',  // tooltip on the document or folder title
  'common.imageTypeError': 'Usa una imagen PNG, JPG, GIF o WEBP.',
  'key.space': 'Espacio',  // name of the Space bar key

  // ---- Language selector ----
  'lang.select': 'Idioma',  // tooltip and accessible label of the selector

  // ---- Top bar ----
  'topbar.docOptions': 'Opciones del mapa',  // tooltip of the "…" button next to the title (also used for boards)
  'topbar.present': 'Presentar',  // tooltip: presentation mode
  'topbar.logout': 'Cerrar sesión',  // tooltip: end the session
  'topbar.maps': 'Mapas',
  'topbar.boards': 'Pizarras',
  'topbar.listMaps': 'Ver mapas',
  'topbar.listBoards': 'Ver pizarras',

  // ---- Autosave status (text at the top) ----
  'status.saved': 'Guardado',
  'status.saving': 'Guardando…',
  'status.conflict': 'Documento modificado en otra pestaña — recarga',
  'status.trashed': 'Documento movido a la papelera en otra pestaña',
  'status.saveError': 'Error al guardar — reintentando',

  // ---- Documents (mind map or board) ----
  'doc.centralTopic': 'Tema central',  // text of the central topic of a new map
  'doc.untitledBoard': 'Pizarra sin título',  // title of a new board
  'doc.untitled': '(sin título)',  // shown in the list for a document without a title
  'doc.copySuffix': ' (copia)',  // appended to the title when duplicating; keep the leading space
  'doc.moveToTrash': 'Mover a la papelera',  // menu item
  'doc.trashConfirmMap': '¿Eliminar el mapa "{title}"? Irá a la papelera, desde donde puedes restaurarlo.',
  'doc.trashConfirmBoard': '¿Eliminar la pizarra "{title}"? Irá a la papelera, desde donde puedes restaurarla.',
  'doc.unsavedLeaveConfirm': 'Este documento tiene cambios sin guardar (error al guardar). ¿Salir de todos modos y perderlos?',
  'doc.duplicateError': 'No se pudo duplicar el mapa.',  // also used for boards

  // ---- Document list (home page) ----
  'list.root': 'Mis mapas',  // page title and name of the root folder (breadcrumb and "Move to" menu)
  'list.newFolder': 'Nueva carpeta',  // button
  'list.newBoard': 'Nueva pizarra',  // button
  'list.newMap': 'Nuevo mapa',  // button
  'list.searchPlaceholder': 'Buscar mapas, pizarras, skills y carpetas',  // placeholder of the search field
  'list.sortBy': 'Ordenar',  // tooltip of the sort selector
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

  // ---- Folders ----
  'folder.moveTo': 'Mover a',  // title of the menu listing the destination folders
  'folder.newPrompt': 'Nombre de la nueva carpeta',  // prompt when creating
  'folder.renamePrompt': 'Nombre de la carpeta',  // prompt when renaming
  'folder.deleteConfirm': '¿Eliminar la carpeta "{name}"? Lo que contiene (mapas, pizarras y subcarpetas) pasará a la carpeta superior.',
  'folder.saveError': 'No se pudieron guardar las carpetas.',

  // ---- Trash ----
  'trash.title': 'Papelera ({n})',  // {n}: number of documents
  'trash.deletedAt': 'eliminado el {date}',  // {date}: date and time, already formatted
  'trash.purge': 'Eliminar para siempre',  // button: permanent deletion
  'trash.purgeConfirm': '¿Eliminar para siempre? No se puede deshacer.',

  // ---- Version history ----
  'history.title': 'Historial de versiones',  // button tooltip and panel title
  'history.hint': 'Una copia cada 2 min de edición · últimas 50',
  'history.empty': 'Aún no hay versiones anteriores.',
  'history.entryOne': '{title} · 1 tema',  // version with a single topic
  'history.entryMany': '{title} · {n} temas',  // {n}: number of topics (0 or more than 1)
  'history.restoreConfirm': '¿Restaurar esta versión? (Ctrl+Z deshace)',
  'history.loadError': 'No se pudo cargar esta versión.',

  // ---- Export ----
  'export.title': 'Exportar',  // button tooltip
  'export.png': 'Imagen (PNG)',
  'export.pdf': 'PDF (imprimir / guardar)',
  'export.svg': 'Vector (SVG)',
  'export.md': 'Texto (Markdown)',
  'export.error': 'No se pudo exportar: {error}',
  'export.fileFallback': 'mapa',  // exported file name when the title has no letters or digits

  // ---- Technical errors (inserted into {error} of other messages) ----
  'error.fileTooLarge': 'archivo de más de 20 MB',
  'error.invalidImage': 'imagen no válida',

  // ---- Presentation ----
  'present.prev': 'Anterior (←)',  // tooltip
  'present.next': 'Siguiente (→ o Espacio)',  // tooltip
  'present.exit': 'Salir (Esc)',  // tooltip: leave the presentation

  // ---- Zoom (map and board) ----
  'zoom.out': 'Alejar',  // tooltip
  'zoom.in': 'Acercar',  // tooltip
  'zoom.reset': 'Zoom 100%',  // tooltip of the button showing the current zoom
  'zoom.fit': 'Ajustar a la pantalla',  // tooltip

  // ---- Map: toolbar above the selected topic (button tooltips) ----
  'map.toolbar.style': 'Color y forma',
  'map.toolbar.text': 'Estilo del texto',
  'map.toolbar.image': 'Imagen',
  'map.toolbar.attachments': 'Adjuntos',
  'map.toolbar.comments': 'Comentarios (Alt+Shift+C)',
  'map.toolbar.delete': 'Eliminar (Del)',
  'map.connect': 'Conectar con otro tema',  // tooltip and menu item: create a connection (arrow) to another topic
  'map.addChild': 'Nuevo subtema (Tab)',  // tooltip of the "+" button
  'map.addSibling': 'Nuevo tema hermano (Enter)',  // tooltip of the "+" button
  'map.hint.child': 'subtema',  // short hint next to the Tab key: creates a child topic
  'map.hint.sibling': 'hermano',  // short hint next to the Enter key: creates a sibling topic
  'map.outline': 'Esquema (Alt+Shift+O)',  // tooltip: view the map as an editable list
  'map.openError': 'No se pudo abrir este mapa: su archivo está dañado.',

  // ---- Map: topic menu ----
  'map.menu.child': 'Nuevo subtema',
  'map.menu.sibling': 'Nuevo tema hermano',
  'map.menu.collapse': 'Contraer / expandir',  // menu item and tooltip of the bullet in the outline
  'map.menu.focus': 'Enfocar esta rama',
  'map.menu.showBranchAs': 'Mostrar rama como',  // followed by the layout options
  'map.menu.copyBranch': 'Copiar rama',
  'map.menu.cutBranch': 'Cortar rama',
  'map.menu.pasteBranch': 'Pegar rama',

  // ---- Map: layout ----
  'map.layout.title': 'Diseño',  // selector tooltip
  'map.layout.map': 'Mapa',  // mind map (branches on both sides)
  'map.layout.org': 'Organigrama',
  'map.layout.list': 'Lista',

  // ---- Map: focus mode ----
  'map.focus.label': 'Enfoque:',  // followed by the name of the focused branch
  'map.focus.exit': 'Salir del enfoque',  // button

  // ---- Map: topic image ----
  'map.image.drop': 'Suelta la imagen aquí o haz clic para elegirla',
  'map.image.formats': 'PNG, JPG, GIF o WEBP · hasta 20 MB',
  'map.image.remove': 'Quitar imagen',
  'map.image.addError': 'No se pudo añadir la imagen: {error}',

  // ---- Map: topic attachments ----
  'map.attach.title': 'Adjuntos',  // panel title
  'map.attach.add': 'Añadir archivos',
  'map.attach.hint': 'Suelta aquí o haz clic · hasta 20 MB cada uno',
  'map.attach.remove': 'Quitar adjunto',  // tooltip of the × button
  'map.attach.uploadError': 'No se pudo subir el archivo: {error}',

  // ---- Map: topic comments ----
  'map.comment.placeholder': 'Añadir comentario',  // field placeholder
  'map.comment.send': 'Enviar (Enter)',  // tooltip
  'map.comment.delete': 'Eliminar comentario',  // tooltip of the × button

  // ---- Map: topic text style ----
  'map.text.bold': 'Negrita (Ctrl+B)',  // tooltip
  'map.text.italic': 'Cursiva (Ctrl+I)',  // tooltip
  'map.text.size': 'Tamaño',
  'map.text.small': 'Pequeño',
  'map.text.medium': 'Mediano',
  'map.text.large': 'Grande',
  'map.text.color': 'Color del texto',

  // ---- Map: topic link ----
  'map.url.placeholder': 'Dirección (https://…)',  // field placeholder: web address
  'map.url.invalid': 'Usa una dirección http:// o https://',
  'map.url.remove': 'Quitar enlace',

  // ---- Map: "Color and shape" panel ----
  'map.style.tabShape': 'Forma',  // tab
  'map.style.tabBorder': 'Borde',  // tab
  'map.style.tabLine': 'Línea',  // tab: the line connecting the topic to its parent
  'map.style.themeColors': 'Colores del tema',
  'map.style.customColors': 'Colores personalizados',
  'map.style.pickColor': 'Elegir color',  // tooltip of the "+" button
  'map.style.auto': 'Automático',  // swatch tooltip: automatic color (the branch's color)
  'map.style.noFill': 'Sin relleno',  // swatch tooltip
  'map.style.boundary': 'Mostrar como contorno',  // on/off switch: dashed area around the branch
  'map.style.borderColor': 'Color del borde',
  'map.style.lineColor': 'Color de la línea al padre',
  'map.style.width': 'Grosor',  // of the border or the line
  'map.style.thin': 'Fino',
  'map.style.medium': 'Medio',
  'map.style.thick': 'Grueso',
  'map.style.style': 'Estilo',  // of the border or the line: solid, dashed, dotted
  'map.style.solid': 'Sólido',
  'map.style.dashed': 'Discontinuo',
  'map.style.dotted': 'Punteado',

  // ---- Map: topic shape (tooltips) ----
  'map.shape.underline': 'Línea',  // just an underline, no box
  'map.shape.rect': 'Rectángulo',
  'map.shape.rounded': 'Redondeado',
  'map.shape.pill': 'Elipse',
  'map.shape.cloud': 'Nube',

  // ---- Map: connections between topics (free arrows) ----
  'map.link.color': 'Color',  // tooltip
  'map.link.startMarker': 'Extremo inicial',  // tooltip: marker at the start of the connection
  'map.link.endMarker': 'Extremo final',  // tooltip: marker at the end of the connection
  'map.link.swap': 'Invertir dirección',  // tooltip
  'map.link.addLabel': 'Añadir etiqueta',  // menu item
  'map.link.delete': 'Eliminar conexión',  // menu item
  'map.link.labelPrompt': 'Etiqueta de la conexión',  // prompt
  'map.link.exitTop': 'Salir por arriba',  // tooltip: side of the topic the connection leaves from
  'map.link.exitRight': 'Salir por la derecha',
  'map.link.exitBottom': 'Salir por abajo',
  'map.link.exitLeft': 'Salir por la izquierda',

  // ---- Board: tools (tooltips; shortcut keys in parentheses) ----
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
  'board.tool.image': 'Insertar imagen',  // menu item
  'board.tool.bucket': 'Bote de pintura',  // menu item
  'board.tool.lasso': 'Selección de lazo',  // menu item
  'board.tool.laser': 'Puntero láser',  // menu item

  // ---- Board: style panel ----
  'board.props.stroke': 'Trazo',  // stroke color
  'board.props.background': 'Fondo',  // background color
  'board.props.noBackground': 'Sin fondo',  // tooltip of the transparent swatch
  'board.props.fill': 'Relleno',
  'board.props.fillHachure': 'Tramado',
  'board.props.fillSolid': 'Sólido',
  'board.props.width': 'Grosor del trazo',  // of the stroke
  'board.props.widthThin': 'Fino',
  'board.props.widthMedium': 'Medio',
  'board.props.widthThick': 'Grueso',
  'board.props.strokeStyle': 'Estilo del trazo',
  'board.props.strokeSolid': 'Sólido',
  'board.props.strokeDashed': 'Discontinuo',
  'board.props.strokeDotted': 'Punteado',
  'board.props.roughness': 'Irregularidad',  // how "hand-drawn" the stroke looks
  'board.props.roughArchitect': 'Arquitecto',  // straight, precise stroke
  'board.props.roughArtist': 'Artista',  // slightly irregular
  'board.props.roughCartoonist': 'Caricaturista',  // very irregular
  'board.props.fontFamily': 'Tipo de fuente',
  'board.props.fontHand': 'A mano',
  'board.props.fontNormal': 'Normal',
  'board.props.fontCode': 'Código',  // monospaced font
  'board.props.fontSize': 'Tamaño del texto',
  'board.props.sizeS': 'P',  // abbreviation of "small" (button label)
  'board.props.sizeM': 'M',  // abbreviation of "medium"
  'board.props.sizeL': 'G',  // abbreviation of "large"
  'board.props.sizeXL': 'XG',  // abbreviation of "extra large"
  'board.props.textAlign': 'Alinear texto',
  'board.props.alignLeft': 'Izquierda',
  'board.props.alignCenter': 'Centrado',
  'board.props.alignRight': 'Derecha',
  'board.props.opacity': 'Opacidad',
  'board.props.layers': 'Capas',  // stacking order
  'board.props.toBack': 'Enviar al fondo',
  'board.props.backward': 'Enviar hacia atrás',
  'board.props.forward': 'Traer hacia adelante',
  'board.props.toFront': 'Traer al frente',
  'board.props.actions': 'Acciones',
  'board.props.link': 'Enlace (Ctrl+K)',  // tooltip

  // ---- Board: bottom bar and messages ----
  'board.zoomOut': 'Alejar (Ctrl −)',  // tooltip
  'board.zoomIn': 'Acercar (Ctrl +)',  // tooltip
  'board.openError': 'No se pudo abrir esta pizarra: su archivo está dañado.',
  'board.image.insertError': 'No se pudo insertar la imagen: {error}',
  'board.link.prompt': 'Dirección del enlace (vacío lo quita)',  // prompt
  'board.link.invalid': 'Usa una dirección http o https.',

  // ---- Board: shortcuts help (the …Keys keys are the key column) ----
  'board.help.button': 'Atajos (?)',  // button tooltip
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
  'board.help.nudgeKeys': 'Flechas',  // the keyboard arrow keys
  'board.help.nudge': 'Mover 1 px (Shift: 10)',
  'board.help.layerStep': 'Una capa hacia adelante / hacia atrás',
  'board.help.layerEnds': 'Traer al frente / enviar al fondo',
  'board.help.zoomKeys': 'Ctrl+rueda, Ctrl ±',  // wheel = the mouse wheel
  'board.help.zoom': 'Zoom',

  // ---- Login page ----
  'login.title': 'Iniciar sesión · Brainstorm',  // tab title; "Brainstorm" is the app name, not translated
  'login.user': 'Usuario',  // field label
  'login.password': 'Contraseña',  // field label
  'login.submit': 'Entrar',  // button
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
  'skill.edit': 'Editar',
  'skill.split': 'Dividir',
  'skill.preview': 'Vista previa',
  'skill.saveVersion': 'Guardar versión',
  'skill.versions': 'Versiones',
  'skill.versionLabelPrompt': 'Nombre de la versión (opcional):',
  'skill.versionSaved': 'Versión guardada',
  'skill.versionError': 'No se pudo guardar la versión.',
  'skill.compare': 'Comparar',
  'skill.closeCompare': 'Cerrar comparación',
  'skill.restoreConfirm': '¿Restaurar esta versión? El texto actual queda guardado en el historial.',
  'skill.diffTooLarge': 'Texto demasiado grande para comparar.',
  'skill.chars': '{n} caracteres',
  'skill.addTag': 'Añadir etiqueta',
  'skill.removeTag': 'Quitar etiqueta {tag}',
  'skill.noVersions': 'Aún no hay versiones.',
  'topbar.settings': 'Configuración',
  'topbar.settingsLlm': 'Configurar LLM',
  'topbar.settingsBackup': 'Configurar copia de seguridad (Object Storage)',
  'settings.llm.title': 'Configurar LLM',
  'settings.llm.hint': 'Claves de API para funciones futuras. Se guardan solo en el servidor: una vez guardadas, solo se muestran los últimos caracteres y nunca entran en la copia de seguridad.',
  'settings.llm.custom': 'Personalizado (compatible con OpenAI)',
  'settings.llm.key': 'Clave de API',
  'settings.llm.keyPlaceholder': 'Pega la clave',
  'settings.llm.model': 'Modelo predeterminado',
  'settings.llm.modelPlaceholder': 'Opcional',
  'settings.llm.baseUrl': 'URL base (http:// o https://)',
  'settings.llm.configured': 'Clave guardada',
  'settings.llm.notConfigured': 'Sin clave',
  'settings.llm.removeConfirm': '¿Quitar la clave de {name}?',
  'settings.llm.removed': 'Clave eliminada.',
  'settings.llm.default': 'Predeterminado',
  'settings.llm.defaultNeedsKey': 'Guarda una clave antes de elegirlo como predeterminado',
  'settings.llm.defaultSaved': '{name} es ahora el LLM predeterminado.',
  'settings.secretSaved': 'Guardada ({hint}): déjalo vacío para mantenerla',
  'settings.saved': 'Guardado.',
  'settings.remove': 'Quitar',
  'settings.error': 'Error: {detail}',
  'settings.busy': 'Ya hay una copia de seguridad o una restauración en curso.',
  'settings.backup.title': 'Copia de seguridad en Object Storage',
  'settings.backup.hint': 'Copia de seguridad automática en Wasabi (u otro almacenamiento compatible con S3): mapas, pizarras, skills y adjuntos en un único archivo .tar.gz. Las claves de API y las del almacenamiento no se incluyen.',
  'settings.backup.region': 'Región de Wasabi',
  'settings.backup.regionPlaceholder': 'p. ej., eu-central-2',
  'settings.backup.endpoint': 'Endpoint (https://)',
  'settings.backup.bucket': 'Bucket',
  'settings.backup.prefix': 'Prefijo (carpeta en el bucket)',
  'settings.backup.accessKey': 'Access key',
  'settings.backup.secretKey': 'Secret key',
  'settings.backup.secretPlaceholder': 'Pega la secret key',
  'settings.backup.interval': 'Frecuencia',
  'settings.backup.every6h': 'Cada 6 horas',
  'settings.backup.every12h': 'Cada 12 horas',
  'settings.backup.every24h': 'Una vez al día',
  'settings.backup.every7d': 'Una vez por semana',
  'settings.backup.keep': 'Conservar las últimas (copias)',
  'settings.backup.enabled': 'Copia automática activada (solo si algo cambió)',
  'settings.backup.saved': 'Configuración guardada.',
  'settings.backup.invalid': 'Revisa los campos: el endpoint debe empezar por https:// y el bucket solo admite minúsculas, números, puntos y guiones.',
  'settings.backup.status': 'Estado',
  'settings.backup.run': 'Hacer copia ahora',
  'settings.backup.running': 'Haciendo la copia…',
  'settings.backup.notConfigured': 'Completa el endpoint, el bucket y las dos claves y guarda para usar las copias.',
  'settings.backup.never': 'Aún no hay copias.',
  'settings.backup.lastSuccess': 'Última copia: {when}',
  'settings.backup.lastError': 'Último error ({when}): {error}',
  'settings.backup.list': 'Copias en el bucket',
  'settings.backup.loading': 'Cargando…',
  'settings.backup.empty': 'Aún no hay copias en el bucket.',
  'settings.backup.restoreConfirm': '¿Restaurar la copia del {when}?\n\nEsto reemplaza todos los mapas, pizarras y skills actuales. Antes se hace una copia del estado actual.',
  'settings.backup.restoring': 'Restaurando… (primero una copia del estado actual)',
};
