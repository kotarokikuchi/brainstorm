// Textos da interface em português do Brasil: o dicionário base (os outros idiomas traduzem este).
// Chaves: área.significado. {nome} é trocado em tempo de execução e deve aparecer igual na tradução.
// Nomes de teclas (Ctrl, Shift, Alt, Tab, Esc, Del, Delete, Enter) não se traduzem.
export default {
  // ---- Comuns (o mesmo texto em vários lugares) ----
  'common.undo': 'Desfazer (Ctrl+Z)',  // dica de botão
  'common.redo': 'Refazer (Ctrl+Shift+Z)',  // dica de botão
  'common.close': 'Fechar',  // dica do botão ×
  'common.save': 'Salvar',  // botão
  'common.delete': 'Apagar',  // botão (pasta, documento, tópico, elemento do quadro)
  'common.duplicate': 'Duplicar',  // botão / item de menu
  'common.move': 'Mover',  // botão: abre o menu "Mover para"
  'common.rename': 'Renomear',  // botão
  'common.restore': 'Restaurar',  // botão (lixeira e histórico de versões)
  'common.moreOptions': 'Mais opções',  // dica do botão "…"
  'common.link': 'Link',  // endereço web preso a um tópico ou elemento
  'common.clickToRename': 'Clique para renomear',  // dica sobre o título do documento ou da pasta
  'common.imageTypeError': 'Use uma imagem PNG, JPG, GIF ou WEBP.',
  'key.space': 'Espaço',  // nome da tecla barra de espaço

  // ---- Seletor de idioma ----
  'lang.select': 'Idioma',  // dica e rótulo acessível do seletor

  // ---- Barra do topo ----
  'topbar.docOptions': 'Opções do mapa',  // dica do botão "…" ao lado do título (vale também para quadros)
  'topbar.present': 'Apresentar',  // dica: modo apresentação
  'topbar.logout': 'Sair',  // dica: encerrar a sessão
  'topbar.maps': 'Mapas',
  'topbar.boards': 'Quadros',
  'topbar.listMaps': 'Listar mapas',
  'topbar.listBoards': 'Listar quadros',

  // ---- Estado do salvamento automático (texto no topo) ----
  'status.saved': 'Salvo',
  'status.saving': 'Salvando…',
  'status.conflict': 'Mapa alterado em outra aba — recarregue',
  'status.saveError': 'Erro ao salvar — tentando de novo',

  // ---- Documentos (mapa mental ou quadro) ----
  'doc.centralTopic': 'Mapa central',  // texto do tópico central de um mapa novo
  'doc.untitledBoard': 'Quadro sem título',  // título de um quadro novo
  'doc.untitled': '(sem título)',  // mostrado na lista para documento sem título
  'doc.copySuffix': ' (cópia)',  // acrescentado ao título ao duplicar; mantenha o espaço inicial
  'doc.moveToTrash': 'Mover para a lixeira',  // item de menu
  'doc.trashConfirmMap': 'Apagar o mapa "{title}"? Ele vai para a lixeira, de onde dá para restaurar.',
  'doc.trashConfirmBoard': 'Apagar o quadro "{title}"? Ele vai para a lixeira, de onde dá para restaurar.',
  'doc.unsavedLeaveConfirm': 'Este documento tem alterações que não foram salvas (erro ao salvar). Sair mesmo assim e perdê-las?',
  'doc.duplicateError': 'Não foi possível duplicar o mapa.',  // vale também para quadros

  // ---- Lista de documentos (página inicial) ----
  'list.root': 'Meus mapas',  // título da página e nome da pasta raiz (trilha e menu "Mover para")
  'list.newFolder': 'Nova pasta',  // botão
  'list.newBoard': 'Novo quadro',  // botão
  'list.newMap': 'Novo mapa',  // botão
  'list.searchPlaceholder': 'Buscar mapas, quadros, skills e pastas',  // texto de exemplo do campo de busca
  'list.sortBy': 'Ordenar',  // dica do seletor de ordenação
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

  // ---- Pastas ----
  'folder.moveTo': 'Mover para',  // título do menu com a lista de pastas de destino
  'folder.newPrompt': 'Nome da nova pasta',  // pergunta ao criar
  'folder.renamePrompt': 'Nome da pasta',  // pergunta ao renomear
  'folder.deleteConfirm': 'Apagar a pasta "{name}"? O que está dentro dela (mapas, quadros e subpastas) vai para a pasta de cima.',
  'folder.saveError': 'Não foi possível salvar as pastas.',

  // ---- Lixeira ----
  'trash.title': 'Lixeira ({n})',  // {n}: quantidade de documentos
  'trash.deletedAt': 'apagado em {date}',  // {date}: data e hora já formatadas
  'trash.purge': 'Apagar de vez',  // botão: exclusão definitiva
  'trash.purgeConfirm': 'Apagar de vez? Isso não pode ser desfeito.',
  'trash.restoreConflict': 'Já existe um mapa com esse identificador; não foi possível restaurar.',

  // ---- Histórico de versões ----
  'history.title': 'Histórico de versões',  // dica do botão e título do painel
  'history.hint': 'Uma cópia a cada 2 min de edição · últimas 50',
  'history.empty': 'Nenhuma versão anterior ainda.',
  'history.entryOne': '{title} · 1 tópico',  // versão com um único tópico
  'history.entryMany': '{title} · {n} tópicos',  // {n}: quantidade de tópicos (0 ou mais de 1)
  'history.restoreConfirm': 'Restaurar esta versão? (Ctrl+Z desfaz)',
  'history.loadError': 'Não foi possível carregar esta versão.',

  // ---- Exportar ----
  'export.title': 'Exportar',  // dica do botão
  'export.png': 'Imagem (PNG)',
  'export.pdf': 'PDF (imprimir / salvar)',
  'export.svg': 'Vetor (SVG)',
  'export.md': 'Texto (Markdown)',
  'export.error': 'Não foi possível exportar: {error}',
  'export.fileFallback': 'mapa',  // nome do arquivo exportado quando o título não tem letras nem números

  // ---- Erros técnicos (entram em {error} de outras mensagens) ----
  'error.fileTooLarge': 'arquivo maior que 20 MB',
  'error.invalidImage': 'imagem inválida',

  // ---- Apresentação ----
  'present.prev': 'Anterior (←)',  // dica
  'present.next': 'Próximo (→ ou Espaço)',  // dica
  'present.exit': 'Sair (Esc)',  // dica: sair da apresentação

  // ---- Zoom (mapa e quadro) ----
  'zoom.out': 'Diminuir zoom',  // dica
  'zoom.in': 'Aumentar zoom',  // dica
  'zoom.reset': 'Zoom 100%',  // dica do botão que mostra o zoom atual
  'zoom.fit': 'Ajustar à tela',  // dica

  // ---- Mapa: barra sobre o tópico selecionado (dicas dos botões) ----
  'map.toolbar.style': 'Cor e forma',
  'map.toolbar.text': 'Estilo do texto',
  'map.toolbar.image': 'Imagem',
  'map.toolbar.attachments': 'Anexos',
  'map.toolbar.comments': 'Comentários (Alt+Shift+C)',
  'map.toolbar.delete': 'Apagar (Del)',
  'map.connect': 'Ligar a outro nó',  // dica e item de menu: criar ligação (seta) até outro tópico
  'map.addChild': 'Novo filho (Tab)',  // dica do botão "+"
  'map.addSibling': 'Novo irmão (Enter)',  // dica do botão "+"
  'map.hint.child': 'filho',  // dica curta ao lado da tecla Tab: cria um tópico filho
  'map.hint.sibling': 'irmão',  // dica curta ao lado da tecla Enter: cria um tópico irmão
  'map.outline': 'Outline (Alt+Shift+O)',  // dica: ver o mapa como lista editável
  'map.openError': 'Não foi possível abrir este mapa: o arquivo dele está corrompido.',

  // ---- Mapa: menu do tópico ----
  'map.menu.child': 'Novo filho',
  'map.menu.sibling': 'Novo irmão',
  'map.menu.collapse': 'Recolher / expandir',  // item de menu e dica do marcador no outline
  'map.menu.focus': 'Focar neste ramo',
  'map.menu.showBranchAs': 'Mostrar ramo como',  // seguido das opções de layout
  'map.menu.copyBranch': 'Copiar ramo',
  'map.menu.cutBranch': 'Recortar ramo',
  'map.menu.pasteBranch': 'Colar ramo',

  // ---- Mapa: layout ----
  'map.layout.title': 'Layout',  // dica do seletor
  'map.layout.map': 'Mapa',  // mapa mental (ramos para os dois lados)
  'map.layout.org': 'Organograma',
  'map.layout.list': 'Lista',

  // ---- Mapa: modo foco ----
  'map.focus.label': 'Foco:',  // seguido do nome do ramo em foco
  'map.focus.exit': 'Sair do foco',  // botão

  // ---- Mapa: imagem do tópico ----
  'map.image.drop': 'Solte a imagem aqui ou clique para escolher',
  'map.image.formats': 'PNG, JPG, GIF ou WEBP · até 20 MB',
  'map.image.remove': 'Remover imagem',
  'map.image.addError': 'Não foi possível adicionar a imagem: {error}',

  // ---- Mapa: anexos do tópico ----
  'map.attach.title': 'Anexos',  // título do painel
  'map.attach.add': 'Adicionar arquivos',
  'map.attach.hint': 'Solte aqui ou clique · até 20 MB cada',
  'map.attach.remove': 'Remover anexo',  // dica do botão ×
  'map.attach.uploadError': 'Não foi possível enviar o arquivo: {error}',

  // ---- Mapa: comentários do tópico ----
  'map.comment.placeholder': 'Adicionar comentário',  // texto de exemplo do campo
  'map.comment.send': 'Enviar (Enter)',  // dica
  'map.comment.delete': 'Apagar comentário',  // dica do botão ×

  // ---- Mapa: estilo do texto do tópico ----
  'map.text.bold': 'Negrito (Ctrl+B)',  // dica
  'map.text.italic': 'Itálico (Ctrl+I)',  // dica
  'map.text.size': 'Tamanho',
  'map.text.small': 'Pequeno',
  'map.text.medium': 'Médio',
  'map.text.large': 'Grande',
  'map.text.color': 'Cor do texto',

  // ---- Mapa: link do tópico ----
  'map.url.placeholder': 'Endereço (https://…)',  // texto de exemplo do campo: endereço web
  'map.url.invalid': 'Use um endereço http:// ou https://',
  'map.url.remove': 'Remover link',

  // ---- Mapa: painel "Cor e forma" ----
  'map.style.tabShape': 'Forma',  // aba
  'map.style.tabBorder': 'Borda',  // aba
  'map.style.tabLine': 'Linha',  // aba: a linha que liga o tópico ao pai
  'map.style.themeColors': 'Cores do tema',
  'map.style.customColors': 'Cores personalizadas',
  'map.style.pickColor': 'Escolher cor',  // dica do botão "+"
  'map.style.auto': 'Automática',  // dica da amostra: cor automática (a do ramo)
  'map.style.noFill': 'Sem preenchimento',  // dica da amostra
  'map.style.boundary': 'Mostrar como contorno',  // chave liga/desliga: área tracejada em volta do ramo
  'map.style.borderColor': 'Cor da borda',
  'map.style.lineColor': 'Cor da linha até o pai',
  'map.style.width': 'Espessura',  // da borda ou da linha
  'map.style.thin': 'Fina',
  'map.style.medium': 'Média',
  'map.style.thick': 'Grossa',
  'map.style.style': 'Estilo',  // da borda ou da linha: sólida, tracejada, pontilhada
  'map.style.solid': 'Sólida',
  'map.style.dashed': 'Tracejada',
  'map.style.dotted': 'Pontilhada',

  // ---- Mapa: forma do tópico (dicas) ----
  'map.shape.underline': 'Linha',  // só um sublinhado, sem caixa
  'map.shape.rect': 'Retângulo',
  'map.shape.rounded': 'Arredondado',
  'map.shape.pill': 'Elipse',
  'map.shape.cloud': 'Nuvem',

  // ---- Mapa: ligações entre tópicos (setas livres) ----
  'map.link.color': 'Cor',  // dica
  'map.link.startMarker': 'Ponta inicial',  // dica: marcador no início da ligação
  'map.link.endMarker': 'Ponta final',  // dica: marcador no fim da ligação
  'map.link.swap': 'Inverter direção',  // dica
  'map.link.addLabel': 'Adicionar rótulo',  // item de menu
  'map.link.delete': 'Excluir ligação',  // item de menu
  'map.link.labelPrompt': 'Rótulo da ligação',  // pergunta
  'map.link.exitTop': 'Sair por cima',  // dica: lado do tópico de onde a ligação sai
  'map.link.exitRight': 'Sair pela direita',
  'map.link.exitBottom': 'Sair por baixo',
  'map.link.exitLeft': 'Sair pela esquerda',

  // ---- Quadro: ferramentas (dicas; entre parênteses, as teclas de atalho) ----
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
  'board.tool.image': 'Inserir imagem',  // item de menu
  'board.tool.bucket': 'Balde de tinta',  // item de menu
  'board.tool.lasso': 'Seleção de laço',  // item de menu
  'board.tool.laser': 'Ponteiro laser',  // item de menu

  // ---- Quadro: painel de estilo ----
  'board.props.stroke': 'Traço',  // cor do traço
  'board.props.background': 'Fundo',  // cor de fundo
  'board.props.noBackground': 'Sem fundo',  // dica da amostra transparente
  'board.props.fill': 'Preenchimento',
  'board.props.fillHachure': 'Hachurado',
  'board.props.fillSolid': 'Sólido',
  'board.props.width': 'Espessura',  // do traço
  'board.props.widthThin': 'Fina',
  'board.props.widthMedium': 'Média',
  'board.props.widthThick': 'Grossa',
  'board.props.strokeStyle': 'Estilo do traço',
  'board.props.strokeSolid': 'Sólido',
  'board.props.strokeDashed': 'Tracejado',
  'board.props.strokeDotted': 'Pontilhado',
  'board.props.roughness': 'Desleixo',  // quão "feito à mão" o traço parece
  'board.props.roughArchitect': 'Arquiteto',  // traço reto, preciso
  'board.props.roughArtist': 'Artista',  // um pouco irregular
  'board.props.roughCartoonist': 'Cartunista',  // bem irregular
  'board.props.fontFamily': 'Família da fonte',
  'board.props.fontHand': 'Manuscrita',
  'board.props.fontNormal': 'Normal',
  'board.props.fontCode': 'Código',  // fonte monoespaçada
  'board.props.fontSize': 'Tamanho do texto',
  'board.props.sizeS': 'P',  // abreviação de "pequeno" (rótulo de botão)
  'board.props.sizeM': 'M',  // abreviação de "médio"
  'board.props.sizeL': 'G',  // abreviação de "grande"
  'board.props.sizeXL': 'XG',  // abreviação de "extra grande"
  'board.props.textAlign': 'Alinhamento do texto',
  'board.props.alignLeft': 'À esquerda',
  'board.props.alignCenter': 'Centralizado',
  'board.props.alignRight': 'À direita',
  'board.props.opacity': 'Opacidade',
  'board.props.layers': 'Camadas',  // ordem de empilhamento
  'board.props.toBack': 'Para o fundo',
  'board.props.backward': 'Uma para trás',
  'board.props.forward': 'Uma para frente',
  'board.props.toFront': 'Para a frente de tudo',
  'board.props.actions': 'Ações',
  'board.props.link': 'Link (Ctrl+K)',  // dica

  // ---- Quadro: barra de baixo e mensagens ----
  'board.zoomOut': 'Diminuir zoom (Ctrl −)',  // dica
  'board.zoomIn': 'Aumentar zoom (Ctrl +)',  // dica
  'board.openError': 'Não foi possível abrir este quadro: o arquivo dele está corrompido.',
  'board.image.insertError': 'Não foi possível inserir a imagem: {error}',
  'board.link.prompt': 'Endereço do link (vazio remove)',  // pergunta
  'board.link.invalid': 'Use um endereço http ou https.',

  // ---- Quadro: ajuda de atalhos (as chaves …Keys são a coluna das teclas) ----
  'board.help.button': 'Atalhos (?)',  // dica do botão
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
  'board.help.nudgeKeys': 'Setas',  // as teclas de seta do teclado
  'board.help.nudge': 'Mover 1 px (Shift: 10)',
  'board.help.layerStep': 'Uma camada para frente / para trás',
  'board.help.layerEnds': 'Para a frente de tudo / para o fundo',
  'board.help.zoomKeys': 'Ctrl+rodinha, Ctrl ±',  // rodinha = a roda do mouse
  'board.help.zoom': 'Zoom',

  // ---- Página de login ----
  'login.title': 'Entrar · Brainstorm',  // título da aba; "Brainstorm" é o nome do app, não se traduz
  'login.user': 'Usuário',  // rótulo do campo
  'login.password': 'Senha',  // rótulo do campo
  'login.submit': 'Entrar',  // botão
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
