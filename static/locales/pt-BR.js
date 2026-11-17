// UI strings in Brazilian Portuguese: the base dictionary (the other languages translate this one).
// Keys: area.meaning. {name} is replaced at runtime and must appear unchanged in the translation.
// Key names (Ctrl, Shift, Alt, Tab, Esc, Del, Delete, Enter) are not translated.
export default {
  // ---- Common (same text in several places) ----
  'common.undo': 'Desfazer (Ctrl+Z)',  // button tooltip
  'common.redo': 'Refazer (Ctrl+Shift+Z)',  // button tooltip
  'common.close': 'Fechar',  // tooltip of the × button
  'common.save': 'Salvar',  // button
  'common.delete': 'Apagar',  // button (folder, document, topic, board element)
  'common.duplicate': 'Duplicar',  // button / menu item
  'common.move': 'Mover',  // button: opens the "Move to" menu
  'common.rename': 'Renomear',  // button
  'common.restore': 'Restaurar',  // button (trash and version history)
  'common.moreOptions': 'Mais opções',  // tooltip of the "…" button
  'common.link': 'Link',  // web address attached to a topic or element
  'common.clickToRename': 'Clique para renomear',  // tooltip on the document or folder title
  'common.imageTypeError': 'Use uma imagem PNG, JPG, GIF ou WEBP.',
  'key.space': 'Espaço',  // name of the Space bar key

  // ---- Language selector ----
  'lang.select': 'Idioma',  // tooltip and accessible label of the selector

  // ---- Top bar ----
  'topbar.docOptions': 'Opções do mapa',  // tooltip of the "…" button next to the title (also used for boards)
  'topbar.present': 'Apresentar',  // tooltip: presentation mode
  'topbar.logout': 'Sair',  // tooltip: end the session
  'topbar.maps': 'Mapas',
  'topbar.boards': 'Quadros',
  'topbar.listMaps': 'Listar mapas',
  'topbar.listBoards': 'Listar quadros',

  // ---- Autosave status (text at the top) ----
  'status.saved': 'Salvo',
  'status.saving': 'Salvando…',
  'status.conflict': 'Documento alterado em outra aba — recarregue',
  'status.trashed': 'Documento movido para a lixeira em outra aba',
  'status.saveError': 'Erro ao salvar — tentando de novo',

  // ---- Documents (mind map or board) ----
  'doc.centralTopic': 'Mapa central',  // text of the central topic of a new map
  'doc.untitledBoard': 'Quadro sem título',  // title of a new board
  'doc.untitled': '(sem título)',  // shown in the list for a document without a title
  'doc.copySuffix': ' (cópia)',  // appended to the title when duplicating; keep the leading space
  'doc.moveToTrash': 'Mover para a lixeira',  // menu item
  'doc.trashConfirmMap': 'Apagar o mapa "{title}"? Ele vai para a lixeira, de onde dá para restaurar.',
  'doc.trashConfirmBoard': 'Apagar o quadro "{title}"? Ele vai para a lixeira, de onde dá para restaurar.',
  'doc.unsavedLeaveConfirm': 'Este documento tem alterações que não foram salvas (erro ao salvar). Sair mesmo assim e perdê-las?',
  'doc.duplicateError': 'Não foi possível duplicar o mapa.',  // also used for boards

  // ---- Document list (home page) ----
  'list.root': 'Meus mapas',  // page title and name of the root folder (breadcrumb and "Move to" menu)
  'list.newFolder': 'Nova pasta',  // button
  'list.newBoard': 'Novo quadro',  // button
  'list.newMap': 'Novo mapa',  // button
  'list.searchPlaceholder': 'Buscar mapas, quadros, skills e pastas',  // placeholder of the search field
  'list.sortBy': 'Ordenar',  // tooltip of the sort selector
  'list.sortRecent': 'Modificados recentemente',
  'list.sortOldest': 'Modificados há mais tempo',
  'list.sortAz': 'Nome (A–Z)',
  'list.sortZa': 'Nome (Z–A)',
  'list.empty': 'Nenhum mapa ainda. Crie o primeiro.',
  'list.noMaps': 'Nenhum mapa ainda.',
  'list.noBoards': 'Nenhum quadro ainda.',
  'list.emptyFolder': 'Pasta vazia.',
  'list.searchNoResults': 'Nada encontrado para “{query}”.',
  'list.createMapError': 'Não foi possível criar o mapa.',
  'list.createBoardError': 'Não foi possível criar o quadro.',

  // ---- Folders ----
  'folder.moveTo': 'Mover para',  // title of the menu listing the destination folders
  'folder.newPrompt': 'Nome da nova pasta',  // prompt when creating
  'folder.renamePrompt': 'Nome da pasta',  // prompt when renaming
  'folder.deleteConfirm': 'Apagar a pasta "{name}"? O que está dentro dela (mapas, quadros e subpastas) vai para a pasta de cima.',
  'folder.saveError': 'Não foi possível salvar as pastas.',

  // ---- Trash ----
  'trash.title': 'Lixeira ({n})',  // {n}: number of documents
  'trash.deletedAt': 'apagado em {date}',  // {date}: date and time, already formatted
  'trash.purge': 'Apagar de vez',  // button: permanent deletion
  'trash.purgeConfirm': 'Apagar de vez? Isso não pode ser desfeito.',

  // ---- Version history ----
  'history.title': 'Histórico de versões',  // button tooltip and panel title
  'history.hint': 'Uma cópia a cada 2 min de edição · últimas 50',
  'history.empty': 'Nenhuma versão anterior ainda.',
  'history.entryOne': '{title} · 1 tópico',  // version with a single topic
  'history.entryMany': '{title} · {n} tópicos',  // {n}: number of topics (0 or more than 1)
  'history.restoreConfirm': 'Restaurar esta versão? (Ctrl+Z desfaz)',
  'history.loadError': 'Não foi possível carregar esta versão.',

  // ---- Export ----
  'export.title': 'Exportar',  // button tooltip
  'export.png': 'Imagem (PNG)',
  'export.pdf': 'PDF (imprimir / salvar)',
  'export.svg': 'Vetor (SVG)',
  'export.md': 'Texto (Markdown)',
  'export.error': 'Não foi possível exportar: {error}',
  'export.fileFallback': 'mapa',  // exported file name when the title has no letters or digits

  // ---- Technical errors (inserted into {error} of other messages) ----
  'error.fileTooLarge': 'arquivo maior que 20 MB',
  'error.invalidImage': 'imagem inválida',

  // ---- Presentation ----
  'present.prev': 'Anterior (←)',  // tooltip
  'present.next': 'Próximo (→ ou Espaço)',  // tooltip
  'present.exit': 'Sair (Esc)',  // tooltip: leave the presentation

  // ---- Zoom (map and board) ----
  'zoom.out': 'Diminuir zoom',  // tooltip
  'zoom.in': 'Aumentar zoom',  // tooltip
  'zoom.reset': 'Zoom 100%',  // tooltip of the button showing the current zoom
  'zoom.fit': 'Ajustar à tela',  // tooltip

  // ---- Map: toolbar above the selected topic (button tooltips) ----
  'map.toolbar.style': 'Cor e forma',
  'map.toolbar.text': 'Estilo do texto',
  'map.toolbar.image': 'Imagem',
  'map.toolbar.attachments': 'Anexos',
  'map.toolbar.comments': 'Comentários (Alt+Shift+C)',
  'map.toolbar.delete': 'Apagar (Del)',
  'map.connect': 'Ligar a outro nó',  // tooltip and menu item: create a connection (arrow) to another topic
  'map.addChild': 'Novo filho (Tab)',  // tooltip of the "+" button
  'map.addSibling': 'Novo irmão (Enter)',  // tooltip of the "+" button
  'map.hint.child': 'filho',  // short hint next to the Tab key: creates a child topic
  'map.hint.sibling': 'irmão',  // short hint next to the Enter key: creates a sibling topic
  'map.outline': 'Outline (Alt+Shift+O)',  // tooltip: view the map as an editable list
  'map.openError': 'Não foi possível abrir este mapa: o arquivo dele está corrompido.',

  // ---- Map: topic menu ----
  'map.menu.child': 'Novo filho',
  'map.menu.sibling': 'Novo irmão',
  'map.menu.collapse': 'Recolher / expandir',  // menu item and tooltip of the bullet in the outline
  'map.menu.focus': 'Focar neste ramo',
  'map.menu.showBranchAs': 'Mostrar ramo como',  // followed by the layout options
  'map.menu.copyBranch': 'Copiar ramo',
  'map.menu.cutBranch': 'Recortar ramo',
  'map.menu.pasteBranch': 'Colar ramo',

  // ---- Map: layout ----
  'map.layout.title': 'Layout',  // selector tooltip
  'map.layout.map': 'Mapa',  // mind map (branches on both sides)
  'map.layout.org': 'Organograma',
  'map.layout.list': 'Lista',

  // ---- Map: focus mode ----
  'map.focus.label': 'Foco:',  // followed by the name of the focused branch
  'map.focus.exit': 'Sair do foco',  // button

  // ---- Map: topic image ----
  'map.image.drop': 'Solte a imagem aqui ou clique para escolher',
  'map.image.formats': 'PNG, JPG, GIF ou WEBP · até 20 MB',
  'map.image.remove': 'Remover imagem',
  'map.image.addError': 'Não foi possível adicionar a imagem: {error}',

  // ---- Map: topic attachments ----
  'map.attach.title': 'Anexos',  // panel title
  'map.attach.add': 'Adicionar arquivos',
  'map.attach.hint': 'Solte aqui ou clique · até 20 MB cada',
  'map.attach.remove': 'Remover anexo',  // tooltip of the × button
  'map.attach.uploadError': 'Não foi possível enviar o arquivo: {error}',

  // ---- Map: topic comments ----
  'map.comment.placeholder': 'Adicionar comentário',  // field placeholder
  'map.comment.send': 'Enviar (Enter)',  // tooltip
  'map.comment.delete': 'Apagar comentário',  // tooltip of the × button

  // ---- Map: topic text style ----
  'map.text.bold': 'Negrito (Ctrl+B)',  // tooltip
  'map.text.italic': 'Itálico (Ctrl+I)',  // tooltip
  'map.text.size': 'Tamanho',
  'map.text.small': 'Pequeno',
  'map.text.medium': 'Médio',
  'map.text.large': 'Grande',
  'map.text.color': 'Cor do texto',

  // ---- Map: topic link ----
  'map.url.placeholder': 'Endereço (https://…)',  // field placeholder: web address
  'map.url.invalid': 'Use um endereço http:// ou https://',
  'map.url.remove': 'Remover link',

  // ---- Map: "Color and shape" panel ----
  'map.style.tabShape': 'Forma',  // tab
  'map.style.tabBorder': 'Borda',  // tab
  'map.style.tabLine': 'Linha',  // tab: the line connecting the topic to its parent
  'map.style.themeColors': 'Cores do tema',
  'map.style.customColors': 'Cores personalizadas',
  'map.style.pickColor': 'Escolher cor',  // tooltip of the "+" button
  'map.style.auto': 'Automática',  // swatch tooltip: automatic color (the branch's color)
  'map.style.noFill': 'Sem preenchimento',  // swatch tooltip
  'map.style.boundary': 'Mostrar como contorno',  // on/off switch: dashed area around the branch
  'map.style.borderColor': 'Cor da borda',
  'map.style.lineColor': 'Cor da linha até o pai',
  'map.style.width': 'Espessura',  // of the border or the line
  'map.style.thin': 'Fina',
  'map.style.medium': 'Média',
  'map.style.thick': 'Grossa',
  'map.style.style': 'Estilo',  // of the border or the line: solid, dashed, dotted
  'map.style.solid': 'Sólida',
  'map.style.dashed': 'Tracejada',
  'map.style.dotted': 'Pontilhada',

  // ---- Map: topic shape (tooltips) ----
  'map.shape.underline': 'Linha',  // just an underline, no box
  'map.shape.rect': 'Retângulo',
  'map.shape.rounded': 'Arredondado',
  'map.shape.pill': 'Elipse',
  'map.shape.cloud': 'Nuvem',

  // ---- Map: connections between topics (free arrows) ----
  'map.link.color': 'Cor',  // tooltip
  'map.link.startMarker': 'Ponta inicial',  // tooltip: marker at the start of the connection
  'map.link.endMarker': 'Ponta final',  // tooltip: marker at the end of the connection
  'map.link.swap': 'Inverter direção',  // tooltip
  'map.link.addLabel': 'Adicionar rótulo',  // menu item
  'map.link.delete': 'Excluir ligação',  // menu item
  'map.link.labelPrompt': 'Rótulo da ligação',  // prompt
  'map.link.exitTop': 'Sair por cima',  // tooltip: side of the topic the connection leaves from
  'map.link.exitRight': 'Sair pela direita',
  'map.link.exitBottom': 'Sair por baixo',
  'map.link.exitLeft': 'Sair pela esquerda',

  // ---- Board: tools (tooltips; shortcut keys in parentheses) ----
  'board.tool.hand': 'Mover a tela (H ou Espaço)',
  'board.tool.select': 'Selecionar (V ou 1)',
  'board.tool.rectangle': 'Retângulo (R ou 2)',
  'board.tool.diamond': 'Losango (D ou 3)',
  'board.tool.ellipse': 'Elipse (O ou 4)',
  'board.tool.arrow': 'Seta (A ou 5)',
  'board.tool.line': 'Linha (L ou 6)',
  'board.tool.freedraw': 'Lápis (P ou 7)',
  'board.tool.text': 'Texto (T ou 8)',
  'board.tool.note': 'Nota adesiva (N)',
  'board.tool.eraser': 'Borracha (E ou 0)',
  'board.tool.more': 'Mais ferramentas',
  'board.tool.image': 'Inserir imagem',  // menu item
  'board.tool.bucket': 'Balde de tinta',  // menu item
  'board.tool.lasso': 'Seleção de laço',  // menu item
  'board.tool.laser': 'Ponteiro laser',  // menu item

  // ---- Board: style panel ----
  'board.props.stroke': 'Traço',  // stroke color
  'board.props.background': 'Fundo',  // background color
  'board.props.noBackground': 'Sem fundo',  // tooltip of the transparent swatch
  'board.props.fill': 'Preenchimento',
  'board.props.fillHachure': 'Hachurado',
  'board.props.fillSolid': 'Sólido',
  'board.props.width': 'Espessura',  // of the stroke
  'board.props.widthThin': 'Fina',
  'board.props.widthMedium': 'Média',
  'board.props.widthThick': 'Grossa',
  'board.props.strokeStyle': 'Estilo do traço',
  'board.props.strokeSolid': 'Sólido',
  'board.props.strokeDashed': 'Tracejado',
  'board.props.strokeDotted': 'Pontilhado',
  'board.props.roughness': 'Desleixo',  // how "hand-drawn" the stroke looks
  'board.props.roughArchitect': 'Arquiteto',  // straight, precise stroke
  'board.props.roughArtist': 'Artista',  // slightly irregular
  'board.props.roughCartoonist': 'Cartunista',  // very irregular
  'board.props.fontFamily': 'Família da fonte',
  'board.props.fontHand': 'Manuscrita',
  'board.props.fontNormal': 'Normal',
  'board.props.fontCode': 'Código',  // monospaced font
  'board.props.fontSize': 'Tamanho do texto',
  'board.props.sizeS': 'P',  // abbreviation of "small" (button label)
  'board.props.sizeM': 'M',  // abbreviation of "medium"
  'board.props.sizeL': 'G',  // abbreviation of "large"
  'board.props.sizeXL': 'XG',  // abbreviation of "extra large"
  'board.props.textAlign': 'Alinhamento do texto',
  'board.props.alignLeft': 'À esquerda',
  'board.props.alignCenter': 'Centralizado',
  'board.props.alignRight': 'À direita',
  'board.props.opacity': 'Opacidade',
  'board.props.layers': 'Camadas',  // stacking order
  'board.props.toBack': 'Para o fundo',
  'board.props.backward': 'Uma para trás',
  'board.props.forward': 'Uma para frente',
  'board.props.toFront': 'Para a frente de tudo',
  'board.props.actions': 'Ações',
  'board.props.link': 'Link (Ctrl+K)',  // tooltip

  // ---- Board: bottom bar and messages ----
  'board.zoomOut': 'Diminuir zoom (Ctrl −)',  // tooltip
  'board.zoomIn': 'Aumentar zoom (Ctrl +)',  // tooltip
  'board.openError': 'Não foi possível abrir este quadro: o arquivo dele está corrompido.',
  'board.image.insertError': 'Não foi possível inserir a imagem: {error}',
  'board.link.prompt': 'Endereço do link (vazio remove)',  // prompt
  'board.link.invalid': 'Use um endereço http ou https.',

  // ---- Board: shortcuts help (the …Keys keys are the key column) ----
  'board.help.button': 'Atalhos (?)',  // button tooltip
  'board.help.title': 'Atalhos do quadro',
  'board.help.panKeys': 'H / Espaço',
  'board.help.pan': 'Mover a tela',
  'board.help.selectKeys': 'V ou 1',
  'board.help.select': 'Selecionar',
  'board.help.rectangleKeys': 'R ou 2',
  'board.help.rectangle': 'Retângulo',
  'board.help.diamondKeys': 'D ou 3',
  'board.help.diamond': 'Losango',
  'board.help.ellipseKeys': 'O ou 4',
  'board.help.ellipse': 'Elipse',
  'board.help.arrowKeys': 'A ou 5',
  'board.help.arrow': 'Seta',
  'board.help.lineKeys': 'L ou 6',
  'board.help.line': 'Linha',
  'board.help.freedrawKeys': 'P ou 7',
  'board.help.freedraw': 'Lápis',
  'board.help.image': 'Inserir imagem (ou colar com Ctrl+V, ou arrastar o arquivo para a lousa)',
  'board.help.laser': 'Ponteiro laser: rastro que some sozinho (não é salvo)',
  'board.help.lasso': 'Seleção de laço: contorno livre (Shift soma à seleção)',
  'board.help.bucket': 'Balde de tinta: pinta o fundo da forma (ou a cor da linha/texto)',
  'board.help.textKeys': 'T ou 8',
  'board.help.text': 'Texto (ou duplo clique); Enter quebra a linha, Esc ou clicar fora conclui',
  'board.help.note': 'Nota adesiva: clique cria e já edita; o texto quebra dentro dela',
  'board.help.eraserKeys': 'E ou 0',
  'board.help.eraser': 'Borracha',
  'board.help.undoRedo': 'Desfazer / refazer',
  'board.help.duplicate': 'Duplicar',
  'board.help.clipboard': 'Copiar / recortar / colar (também entre abas e com outros programas)',
  'board.help.selectAll': 'Selecionar tudo',
  'board.help.link': 'Link no elemento (clique no ícone abre)',
  'board.help.delete': 'Apagar',
  'board.help.nudgeKeys': 'Setas',  // the keyboard arrow keys
  'board.help.nudge': 'Mover 1 px (Shift: 10)',
  'board.help.layerStep': 'Uma camada para frente / para trás',
  'board.help.layerEnds': 'Para a frente de tudo / para o fundo',
  'board.help.zoomKeys': 'Ctrl+rodinha, Ctrl ±',  // wheel = the mouse wheel
  'board.help.zoom': 'Zoom',

  // ---- Login page ----
  'login.title': 'Entrar · Brainstorm',  // tab title; "Brainstorm" is the app name, not translated
  'login.user': 'Usuário',  // field label
  'login.password': 'Senha',  // field label
  'login.submit': 'Entrar',  // button
  'login.wrongCredentials': 'Usuário ou senha incorretos.',
  'login.tooManyAttempts': 'Muitas tentativas erradas. Espere alguns minutos e tente de novo.',
  'login.failed': 'Não foi possível entrar (HTTP {status}).',
  'login.noConnection': 'Sem conexão com o servidor.',
  'topbar.skills': 'Skills',
  'topbar.listSkills': 'Listar skills',
  'list.newSkill': 'Novo skill',
  'list.noSkills': 'Nenhum skill ainda.',
  'doc.untitledSkill': 'Skill sem título',
  'doc.trashConfirmSkill': 'Mover o skill "{title}" para a lixeira?',
  'list.createSkillError': 'Não foi possível criar o skill.',
  'skill.template': '# {title}\n\n## Quando usar\n\n## Instruções\n',
  'skill.edit': 'Editar',
  'skill.split': 'Dividir',
  'skill.preview': 'Preview',
  'skill.saveVersion': 'Salvar versão',
  'skill.versions': 'Versões',
  'skill.versionLabelPrompt': 'Nome da versão (opcional):',
  'skill.versionSaved': 'Versão salva',
  'skill.versionError': 'Não foi possível salvar a versão.',
  'skill.compare': 'Comparar',
  'skill.closeCompare': 'Fechar comparação',
  'skill.restoreConfirm': 'Restaurar esta versão? O texto atual fica salvo no histórico.',
  'skill.diffTooLarge': 'Texto grande demais para comparar.',
  'skill.chars': '{n} caracteres',
  'skill.addTag': 'Adicionar tag',
  'skill.removeTag': 'Remover tag {tag}',
  'skill.noVersions': 'Nenhuma versão ainda.',
  'topbar.settings': 'Configurações',
  'topbar.settingsLlm': 'Configurar LLM',
  'topbar.settingsBackup': 'Configurar backup (Object Storage)',
  'settings.llm.title': 'Configurar LLM',
  'settings.llm.hint': 'Chaves de API para funcionalidades futuras. Ficam guardadas só no servidor: depois de salvas, aparecem apenas os últimos caracteres, e nunca entram no backup.',
  'settings.llm.custom': 'Personalizado (compatível com OpenAI)',
  'settings.llm.key': 'Chave de API',
  'settings.llm.keyPlaceholder': 'Cole a chave',
  'settings.llm.model': 'Modelo padrão',
  'settings.llm.modelPlaceholder': 'Opcional',
  'settings.llm.baseUrl': 'Endereço base (http:// ou https://)',
  'settings.llm.configured': 'Chave salva',
  'settings.llm.notConfigured': 'Sem chave',
  'settings.llm.removeConfirm': 'Remover a chave de {name}?',
  'settings.llm.removed': 'Chave removida.',
  'settings.llm.default': 'Padrão',
  'settings.llm.defaultNeedsKey': 'Salve uma chave antes de escolher como padrão',
  'settings.llm.defaultSaved': '{name} agora é o LLM padrão.',
  'settings.secretSaved': 'Salva ({hint}) — deixe vazio para manter',
  'settings.saved': 'Salvo.',
  'settings.remove': 'Remover',
  'settings.error': 'Erro: {detail}',
  'settings.busy': 'Já há um backup ou uma restauração em andamento.',
  'settings.backup.title': 'Backup no Object Storage',
  'settings.backup.hint': 'Backup automático para o Wasabi (ou outro S3 compatível): mapas, quadros, skills e anexos num único arquivo .tar.gz. As chaves de API e as do storage não vão no backup.',
  'settings.backup.region': 'Região do Wasabi',
  'settings.backup.regionPlaceholder': 'ex.: eu-central-2',
  'settings.backup.endpoint': 'Endpoint (https://)',
  'settings.backup.bucket': 'Bucket',
  'settings.backup.prefix': 'Prefixo (pasta no bucket)',
  'settings.backup.accessKey': 'Access key',
  'settings.backup.secretKey': 'Secret key',
  'settings.backup.secretPlaceholder': 'Cole a secret key',
  'settings.backup.interval': 'Frequência',
  'settings.backup.every6h': 'A cada 6 horas',
  'settings.backup.every12h': 'A cada 12 horas',
  'settings.backup.every24h': 'Uma vez por dia',
  'settings.backup.every7d': 'Uma vez por semana',
  'settings.backup.keep': 'Manter os últimos (backups)',
  'settings.backup.enabled': 'Backup automático ligado (só quando algo mudou)',
  'settings.backup.saved': 'Configuração salva.',
  'settings.backup.invalid': 'Confira os campos: o endpoint precisa começar com https:// e o bucket usar só letras minúsculas, números, ponto e hífen.',
  'settings.backup.status': 'Situação',
  'settings.backup.run': 'Fazer backup agora',
  'settings.backup.running': 'Fazendo backup…',
  'settings.backup.notConfigured': 'Preencha endpoint, bucket e as duas chaves e salve para usar o backup.',
  'settings.backup.never': 'Nenhum backup feito ainda.',
  'settings.backup.lastSuccess': 'Último backup: {when}',
  'settings.backup.lastError': 'Último erro ({when}): {error}',
  'settings.backup.list': 'Backups no bucket',
  'settings.backup.loading': 'Carregando…',
  'settings.backup.empty': 'Nenhum backup no bucket ainda.',
  'settings.backup.restoreConfirm': 'Restaurar o backup de {when}?\n\nIsso substitui todos os mapas, quadros e skills atuais. Um backup do estado atual é feito antes.',
  'settings.backup.restoring': 'Restaurando… (primeiro um backup do estado atual)',
};
