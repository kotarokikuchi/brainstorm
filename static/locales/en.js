// UI strings in English, translated from the base dictionary (pt-BR).
// Keys: area.meaning. {name} is replaced at runtime and must appear unchanged in the translation.
// Key names (Ctrl, Shift, Alt, Tab, Esc, Del, Delete, Enter) are not translated.
export default {
  // ---- Common (same text in several places) ----
  'common.undo': 'Undo (Ctrl+Z)',  // button tooltip
  'common.redo': 'Redo (Ctrl+Shift+Z)',  // button tooltip
  'common.close': 'Close',  // tooltip of the × button
  'common.save': 'Save',  // button
  'common.delete': 'Delete',  // button (folder, document, topic, board element)
  'common.duplicate': 'Duplicate',  // button / menu item
  'common.move': 'Move',  // button: opens the "Move to" menu
  'common.rename': 'Rename',  // button
  'common.restore': 'Restore',  // button (trash and version history)
  'common.moreOptions': 'More options',  // tooltip of the "…" button
  'common.link': 'Link',  // web address attached to a topic or element
  'common.clickToRename': 'Click to rename',  // tooltip on the document or folder title
  'common.imageTypeError': 'Use a PNG, JPG, GIF or WEBP image.',
  'key.space': 'Space',  // name of the Space bar key

  // ---- Language selector ----
  'lang.select': 'Language',  // tooltip and accessible label of the selector

  // ---- Top bar ----
  'topbar.docOptions': 'Map options',  // tooltip of the "…" button next to the title (also used for boards)
  'topbar.present': 'Present',  // tooltip: presentation mode
  'topbar.logout': 'Log out',  // tooltip: end the session
  'topbar.maps': 'Maps',
  'topbar.boards': 'Boards',
  'topbar.listMaps': 'All maps',
  'topbar.listBoards': 'All boards',

  // ---- Autosave status (text at the top) ----
  'status.saved': 'Saved',
  'status.saving': 'Saving…',
  'status.conflict': 'Document changed in another tab — reload',
  'status.trashed': 'Document moved to the trash in another tab',
  'status.saveError': 'Save failed — retrying',

  // ---- Documents (mind map or board) ----
  'doc.centralTopic': 'Central topic',  // text of the central topic of a new map
  'doc.untitledBoard': 'Untitled board',  // title of a new board
  'doc.untitled': '(untitled)',  // shown in the list for a document without a title
  'doc.copySuffix': ' (copy)',  // appended to the title when duplicating; keep the leading space
  'doc.moveToTrash': 'Move to trash',  // menu item
  'doc.trashConfirmMap': 'Delete the map "{title}"? It goes to the trash, where you can restore it.',
  'doc.trashConfirmBoard': 'Delete the board "{title}"? It goes to the trash, where you can restore it.',
  'doc.unsavedLeaveConfirm': 'This document has unsaved changes (save failed). Leave anyway and lose them?',
  'doc.duplicateError': 'Couldn’t duplicate the map.',  // also used for boards

  // ---- Document list (home page) ----
  'list.root': 'My maps',  // page title and name of the root folder (breadcrumb and "Move to" menu)
  'list.newFolder': 'New folder',  // button
  'list.newBoard': 'New board',  // button
  'list.newMap': 'New map',  // button
  'list.searchPlaceholder': 'Search maps, boards, skills and folders',  // placeholder of the search field
  'list.sortBy': 'Sort',  // tooltip of the sort selector
  'list.sortRecent': 'Recently modified',
  'list.sortOldest': 'Least recently modified',
  'list.sortAz': 'Name (A–Z)',
  'list.sortZa': 'Name (Z–A)',
  'list.empty': 'No maps yet. Create your first one.',
  'list.noMaps': 'No maps yet.',
  'list.noBoards': 'No boards yet.',
  'list.emptyFolder': 'This folder is empty.',
  'list.searchNoResults': 'No results for “{query}”.',
  'list.createMapError': 'Couldn’t create the map.',
  'list.createBoardError': 'Couldn’t create the board.',

  // ---- Folders ----
  'folder.moveTo': 'Move to',  // title of the menu listing the destination folders
  'folder.newPrompt': 'New folder name',  // prompt when creating
  'folder.renamePrompt': 'Folder name',  // prompt when renaming
  'folder.deleteConfirm': 'Delete the folder "{name}"? Its contents (maps, boards and subfolders) move to the parent folder.',
  'folder.saveError': 'Couldn’t save the folders.',

  // ---- Trash ----
  'trash.title': 'Trash ({n})',  // {n}: number of documents
  'trash.deletedAt': 'deleted {date}',  // {date}: date and time, already formatted
  'trash.purge': 'Delete forever',  // button: permanent deletion
  'trash.purgeConfirm': 'Delete forever? This can’t be undone.',
  'trash.restoreConflict': 'A map with this ID already exists; couldn’t restore it.',

  // ---- Version history ----
  'history.title': 'Version history',  // button tooltip and panel title
  'history.hint': 'A copy every 2 min of editing · last 50',
  'history.empty': 'No previous versions yet.',
  'history.entryOne': '{title} · 1 topic',  // version with a single topic
  'history.entryMany': '{title} · {n} topics',  // {n}: number of topics (0 or more than 1)
  'history.restoreConfirm': 'Restore this version? (Ctrl+Z to undo)',
  'history.loadError': 'Couldn’t load this version.',

  // ---- Export ----
  'export.title': 'Export',  // button tooltip
  'export.png': 'Image (PNG)',
  'export.pdf': 'PDF (print / save)',
  'export.svg': 'Vector (SVG)',
  'export.md': 'Text (Markdown)',
  'export.error': 'Couldn’t export: {error}',
  'export.fileFallback': 'map',  // exported file name when the title has no letters or digits

  // ---- Technical errors (inserted into {error} of other messages) ----
  'error.fileTooLarge': 'file larger than 20 MB',
  'error.invalidImage': 'invalid image',

  // ---- Presentation ----
  'present.prev': 'Previous (←)',  // tooltip
  'present.next': 'Next (→ or Space)',  // tooltip
  'present.exit': 'Exit (Esc)',  // tooltip: leave the presentation

  // ---- Zoom (map and board) ----
  'zoom.out': 'Zoom out',  // tooltip
  'zoom.in': 'Zoom in',  // tooltip
  'zoom.reset': 'Reset zoom (100%)',  // tooltip of the button showing the current zoom
  'zoom.fit': 'Zoom to fit',  // tooltip

  // ---- Map: toolbar above the selected topic (button tooltips) ----
  'map.toolbar.style': 'Color and shape',
  'map.toolbar.text': 'Text style',
  'map.toolbar.image': 'Image',
  'map.toolbar.attachments': 'Attachments',
  'map.toolbar.comments': 'Comments (Alt+Shift+C)',
  'map.toolbar.delete': 'Delete (Del)',
  'map.connect': 'Connect to another topic',  // tooltip and menu item: create a connection (arrow) to another topic
  'map.addChild': 'Add child (Tab)',  // tooltip of the "+" button
  'map.addSibling': 'Add sibling (Enter)',  // tooltip of the "+" button
  'map.hint.child': 'child',  // short hint next to the Tab key: creates a child topic
  'map.hint.sibling': 'sibling',  // short hint next to the Enter key: creates a sibling topic
  'map.outline': 'Outline (Alt+Shift+O)',  // tooltip: view the map as an editable list
  'map.openError': 'Couldn’t open this map: its file is corrupted.',

  // ---- Map: topic menu ----
  'map.menu.child': 'Add child',
  'map.menu.sibling': 'Add sibling',
  'map.menu.collapse': 'Collapse / expand',  // menu item and tooltip of the bullet in the outline
  'map.menu.focus': 'Focus on this branch',
  'map.menu.showBranchAs': 'Show branch as',  // followed by the layout options
  'map.menu.copyBranch': 'Copy branch',
  'map.menu.cutBranch': 'Cut branch',
  'map.menu.pasteBranch': 'Paste branch',

  // ---- Map: layout ----
  'map.layout.title': 'Layout',  // selector tooltip
  'map.layout.map': 'Mind map',  // mind map (branches on both sides)
  'map.layout.org': 'Org chart',
  'map.layout.list': 'List',

  // ---- Map: focus mode ----
  'map.focus.label': 'Focus:',  // followed by the name of the focused branch
  'map.focus.exit': 'Exit focus',  // button

  // ---- Map: topic image ----
  'map.image.drop': 'Drop an image here or click to choose',
  'map.image.formats': 'PNG, JPG, GIF or WEBP · up to 20 MB',
  'map.image.remove': 'Remove image',
  'map.image.addError': 'Couldn’t add the image: {error}',

  // ---- Map: topic attachments ----
  'map.attach.title': 'Attachments',  // panel title
  'map.attach.add': 'Add files',
  'map.attach.hint': 'Drop here or click · up to 20 MB each',
  'map.attach.remove': 'Remove attachment',  // tooltip of the × button
  'map.attach.uploadError': 'Couldn’t upload the file: {error}',

  // ---- Map: topic comments ----
  'map.comment.placeholder': 'Add a comment',  // field placeholder
  'map.comment.send': 'Send (Enter)',  // tooltip
  'map.comment.delete': 'Delete comment',  // tooltip of the × button

  // ---- Map: topic text style ----
  'map.text.bold': 'Bold (Ctrl+B)',  // tooltip
  'map.text.italic': 'Italic (Ctrl+I)',  // tooltip
  'map.text.size': 'Size',
  'map.text.small': 'Small',
  'map.text.medium': 'Medium',
  'map.text.large': 'Large',
  'map.text.color': 'Text color',

  // ---- Map: topic link ----
  'map.url.placeholder': 'URL (https://…)',  // field placeholder: web address
  'map.url.invalid': 'Use an http:// or https:// URL',
  'map.url.remove': 'Remove link',

  // ---- Map: "Color and shape" panel ----
  'map.style.tabShape': 'Shape',  // tab
  'map.style.tabBorder': 'Border',  // tab
  'map.style.tabLine': 'Line',  // tab: the line connecting the topic to its parent
  'map.style.themeColors': 'Theme colors',
  'map.style.customColors': 'Custom colors',
  'map.style.pickColor': 'Pick a color',  // tooltip of the "+" button
  'map.style.auto': 'Automatic',  // swatch tooltip: automatic color (the branch's color)
  'map.style.noFill': 'No fill',  // swatch tooltip
  'map.style.boundary': 'Show as boundary',  // on/off switch: dashed area around the branch
  'map.style.borderColor': 'Border color',
  'map.style.lineColor': 'Line color (to parent)',
  'map.style.width': 'Thickness',  // of the border or the line
  'map.style.thin': 'Thin',
  'map.style.medium': 'Medium',
  'map.style.thick': 'Thick',
  'map.style.style': 'Style',  // of the border or the line: solid, dashed, dotted
  'map.style.solid': 'Solid',
  'map.style.dashed': 'Dashed',
  'map.style.dotted': 'Dotted',

  // ---- Map: topic shape (tooltips) ----
  'map.shape.underline': 'Underline',  // just an underline, no box
  'map.shape.rect': 'Rectangle',
  'map.shape.rounded': 'Rounded',
  'map.shape.pill': 'Ellipse',
  'map.shape.cloud': 'Cloud',

  // ---- Map: connections between topics (free arrows) ----
  'map.link.color': 'Color',  // tooltip
  'map.link.startMarker': 'Start arrowhead',  // tooltip: marker at the start of the connection
  'map.link.endMarker': 'End arrowhead',  // tooltip: marker at the end of the connection
  'map.link.swap': 'Reverse direction',  // tooltip
  'map.link.addLabel': 'Add label',  // menu item
  'map.link.delete': 'Delete connection',  // menu item
  'map.link.labelPrompt': 'Connection label',  // prompt
  'map.link.exitTop': 'Exit from top',  // tooltip: side of the topic the connection leaves from
  'map.link.exitRight': 'Exit from right',
  'map.link.exitBottom': 'Exit from bottom',
  'map.link.exitLeft': 'Exit from left',

  // ---- Board: tools (tooltips; shortcut keys in parentheses) ----
  'board.tool.hand': 'Hand (H or Space)',
  'board.tool.select': 'Selection (V or 1)',
  'board.tool.rectangle': 'Rectangle (R or 2)',
  'board.tool.diamond': 'Diamond (D or 3)',
  'board.tool.ellipse': 'Ellipse (O or 4)',
  'board.tool.arrow': 'Arrow (A or 5)',
  'board.tool.line': 'Line (L or 6)',
  'board.tool.freedraw': 'Draw (P or 7)',
  'board.tool.text': 'Text (T or 8)',
  'board.tool.note': 'Sticky note (N)',
  'board.tool.eraser': 'Eraser (E or 0)',
  'board.tool.more': 'More tools',
  'board.tool.image': 'Insert image',  // menu item
  'board.tool.bucket': 'Paint bucket',  // menu item
  'board.tool.lasso': 'Lasso selection',  // menu item
  'board.tool.laser': 'Laser pointer',  // menu item

  // ---- Board: style panel ----
  'board.props.stroke': 'Stroke',  // stroke color
  'board.props.background': 'Background',  // background color
  'board.props.noBackground': 'Transparent',  // tooltip of the transparent swatch
  'board.props.fill': 'Fill',
  'board.props.fillHachure': 'Hachure',
  'board.props.fillSolid': 'Solid',
  'board.props.width': 'Stroke width',  // of the stroke
  'board.props.widthThin': 'Thin',
  'board.props.widthMedium': 'Bold',
  'board.props.widthThick': 'Extra bold',
  'board.props.strokeStyle': 'Stroke style',
  'board.props.strokeSolid': 'Solid',
  'board.props.strokeDashed': 'Dashed',
  'board.props.strokeDotted': 'Dotted',
  'board.props.roughness': 'Sloppiness',  // how "hand-drawn" the stroke looks
  'board.props.roughArchitect': 'Architect',  // straight, precise stroke
  'board.props.roughArtist': 'Artist',  // slightly irregular
  'board.props.roughCartoonist': 'Cartoonist',  // very irregular
  'board.props.fontFamily': 'Font family',
  'board.props.fontHand': 'Hand-drawn',
  'board.props.fontNormal': 'Normal',
  'board.props.fontCode': 'Code',  // monospaced font
  'board.props.fontSize': 'Font size',
  'board.props.sizeS': 'S',  // abbreviation of "small" (button label)
  'board.props.sizeM': 'M',  // abbreviation of "medium"
  'board.props.sizeL': 'L',  // abbreviation of "large"
  'board.props.sizeXL': 'XL',  // abbreviation of "extra large"
  'board.props.textAlign': 'Text align',
  'board.props.alignLeft': 'Left',
  'board.props.alignCenter': 'Center',
  'board.props.alignRight': 'Right',
  'board.props.opacity': 'Opacity',
  'board.props.layers': 'Layers',  // stacking order
  'board.props.toBack': 'Send to back',
  'board.props.backward': 'Send backward',
  'board.props.forward': 'Bring forward',
  'board.props.toFront': 'Bring to front',
  'board.props.actions': 'Actions',
  'board.props.link': 'Link (Ctrl+K)',  // tooltip

  // ---- Board: bottom bar and messages ----
  'board.zoomOut': 'Zoom out (Ctrl −)',  // tooltip
  'board.zoomIn': 'Zoom in (Ctrl +)',  // tooltip
  'board.openError': 'Couldn’t open this board: its file is corrupted.',
  'board.image.insertError': 'Couldn’t insert the image: {error}',
  'board.link.prompt': 'Link URL (leave empty to remove)',  // prompt
  'board.link.invalid': 'Use an http or https URL.',

  // ---- Board: shortcuts help (the …Keys keys are the key column) ----
  'board.help.button': 'Shortcuts (?)',  // button tooltip
  'board.help.title': 'Board shortcuts',
  'board.help.panKeys': 'H / Space',
  'board.help.pan': 'Pan the canvas',
  'board.help.selectKeys': 'V or 1',
  'board.help.select': 'Selection',
  'board.help.rectangleKeys': 'R or 2',
  'board.help.rectangle': 'Rectangle',
  'board.help.diamondKeys': 'D or 3',
  'board.help.diamond': 'Diamond',
  'board.help.ellipseKeys': 'O or 4',
  'board.help.ellipse': 'Ellipse',
  'board.help.arrowKeys': 'A or 5',
  'board.help.arrow': 'Arrow',
  'board.help.lineKeys': 'L or 6',
  'board.help.line': 'Line',
  'board.help.freedrawKeys': 'P or 7',
  'board.help.freedraw': 'Draw',
  'board.help.image': 'Insert image (or paste with Ctrl+V, or drag the file onto the canvas)',
  'board.help.laser': 'Laser pointer: a trail that fades on its own (not saved)',
  'board.help.lasso': 'Lasso selection: freeform outline (Shift adds to the selection)',
  'board.help.bucket': 'Paint bucket: fills the shape’s background (or the line/text color)',
  'board.help.textKeys': 'T or 8',
  'board.help.text': 'Text (or double-click); Enter adds a line break, Esc or clicking outside finishes',
  'board.help.note': 'Sticky note: click to create it and start typing; text wraps inside it',
  'board.help.eraserKeys': 'E or 0',
  'board.help.eraser': 'Eraser',
  'board.help.undoRedo': 'Undo / redo',
  'board.help.duplicate': 'Duplicate',
  'board.help.clipboard': 'Copy / cut / paste (also across tabs and with other apps)',
  'board.help.selectAll': 'Select all',
  'board.help.link': 'Link on the element (click the icon to open it)',
  'board.help.delete': 'Delete',
  'board.help.nudgeKeys': 'Arrow keys',  // the keyboard arrow keys
  'board.help.nudge': 'Move 1 px (Shift: 10)',
  'board.help.layerStep': 'Bring forward / send backward',
  'board.help.layerEnds': 'Bring to front / send to back',
  'board.help.zoomKeys': 'Ctrl+wheel, Ctrl ±',  // wheel = the mouse wheel
  'board.help.zoom': 'Zoom',

  // ---- Login page ----
  'login.title': 'Log in · Brainstorm',  // tab title; "Brainstorm" is the app name, not translated
  'login.user': 'Username',  // field label
  'login.password': 'Password',  // field label
  'login.submit': 'Log in',  // button
  'login.wrongCredentials': 'Incorrect username or password.',
  'login.tooManyAttempts': 'Too many failed attempts. Wait a few minutes and try again.',
  'login.failed': 'Couldn’t log in (HTTP {status}).',
  'login.noConnection': 'Can’t reach the server.',
  'topbar.skills': 'Skills',
  'topbar.listSkills': 'All skills',
  'list.newSkill': 'New skill',
  'list.noSkills': 'No skills yet.',
  'doc.untitledSkill': 'Untitled skill',
  'doc.trashConfirmSkill': 'Move the skill "{title}" to the trash?',
  'list.createSkillError': 'Couldn’t create the skill.',
  'skill.template': '# {title}\n\n## When to use\n\n## Instructions\n',
  'skill.edit': 'Edit',
  'skill.split': 'Split',
  'skill.preview': 'Preview',
  'skill.saveVersion': 'Save version',
  'skill.versions': 'Versions',
  'skill.versionLabelPrompt': 'Version name (optional):',
  'skill.versionSaved': 'Version saved',
  'skill.versionError': 'Couldn’t save the version.',
  'skill.compare': 'Compare',
  'skill.closeCompare': 'Close comparison',
  'skill.restoreConfirm': 'Restore this version? The current text stays saved in the history.',
  'skill.diffTooLarge': 'Text too large to compare.',
  'skill.chars': '{n} characters',
  'skill.addTag': 'Add tag',
  'skill.removeTag': 'Remove tag {tag}',
  'skill.noVersions': 'No versions yet.',
  'topbar.settings': 'Settings',
  'topbar.settingsLlm': 'Configure LLM',
  'topbar.settingsBackup': 'Configure backup (Object Storage)',
  'settings.llm.title': 'Configure LLM',
  'settings.llm.hint': 'API keys for future features. They are stored only on the server: once saved, only the last characters are shown, and they never go into the backup.',
  'settings.llm.custom': 'Custom (OpenAI-compatible)',
  'settings.llm.key': 'API key',
  'settings.llm.keyPlaceholder': 'Paste the key',
  'settings.llm.model': 'Default model',
  'settings.llm.modelPlaceholder': 'Optional',
  'settings.llm.baseUrl': 'Base URL (http:// or https://)',
  'settings.llm.configured': 'Key saved',
  'settings.llm.notConfigured': 'No key',
  'settings.llm.removeConfirm': 'Remove the {name} key?',
  'settings.llm.removed': 'Key removed.',
  'settings.llm.default': 'Default',
  'settings.llm.defaultNeedsKey': 'Save a key before choosing it as the default',
  'settings.llm.defaultSaved': '{name} is now the default LLM.',
  'settings.secretSaved': 'Saved ({hint}) — leave empty to keep it',
  'settings.saved': 'Saved.',
  'settings.remove': 'Remove',
  'settings.error': 'Error: {detail}',
  'settings.busy': 'A backup or restore is already running.',
  'settings.backup.title': 'Object Storage backup',
  'settings.backup.hint': 'Automatic backup to Wasabi (or another S3-compatible storage): maps, boards, skills and attachments in a single .tar.gz file. API keys and storage keys are not included.',
  'settings.backup.region': 'Wasabi region',
  'settings.backup.regionPlaceholder': 'e.g. eu-central-2',
  'settings.backup.endpoint': 'Endpoint (https://)',
  'settings.backup.bucket': 'Bucket',
  'settings.backup.prefix': 'Prefix (folder in the bucket)',
  'settings.backup.accessKey': 'Access key',
  'settings.backup.secretKey': 'Secret key',
  'settings.backup.secretPlaceholder': 'Paste the secret key',
  'settings.backup.interval': 'Frequency',
  'settings.backup.every6h': 'Every 6 hours',
  'settings.backup.every12h': 'Every 12 hours',
  'settings.backup.every24h': 'Once a day',
  'settings.backup.every7d': 'Once a week',
  'settings.backup.keep': 'Keep the latest (backups)',
  'settings.backup.enabled': 'Automatic backup on (only when something changed)',
  'settings.backup.saved': 'Settings saved.',
  'settings.backup.invalid': 'Check the fields: the endpoint must start with https:// and the bucket may only use lowercase letters, digits, dots and hyphens.',
  'settings.backup.status': 'Status',
  'settings.backup.run': 'Back up now',
  'settings.backup.running': 'Backing up…',
  'settings.backup.notConfigured': 'Fill in the endpoint, bucket and both keys, then save, to use backups.',
  'settings.backup.never': 'No backup yet.',
  'settings.backup.lastSuccess': 'Last backup: {when}',
  'settings.backup.lastError': 'Last error ({when}): {error}',
  'settings.backup.list': 'Backups in the bucket',
  'settings.backup.loading': 'Loading…',
  'settings.backup.empty': 'No backups in the bucket yet.',
  'settings.backup.restoreConfirm': 'Restore the backup from {when}?\n\nThis replaces all current maps, boards and skills. A backup of the current state is made first.',
  'settings.backup.restoring': 'Restoring… (first a backup of the current state)',
};
