// UI texts in Japanese (ja), translated from pt-BR.js (the base dictionary).
// Keys: area.meaning. {name} is replaced at runtime and must appear unchanged in the translation.
// Key names (Ctrl, Shift, Alt, Tab, Esc, Del, Delete, Enter) are not translated.
export default {
  // ---- Common (same text in several places) ----
  'common.undo': '元に戻す (Ctrl+Z)',  // button tooltip
  'common.redo': 'やり直す (Ctrl+Shift+Z)',  // button tooltip
  'common.close': '閉じる',  // tooltip of the × button
  'common.save': '保存',  // button
  'common.delete': '削除',  // button (folder, document, topic, board element)
  'common.duplicate': '複製',  // button / menu item
  'common.move': '移動',  // button: opens the "Move to" menu
  'common.rename': '名前を変更',  // button
  'common.restore': '復元',  // button (trash and version history)
  'common.moreOptions': 'その他のオプション',  // tooltip of the "…" button
  'common.link': 'リンク',  // web address attached to a topic or element
  'common.clickToRename': 'クリックして名前を変更',  // tooltip on the document or folder title
  'common.imageTypeError': 'PNG、JPG、GIF、WEBP のいずれかの画像を使用してください。',
  'key.space': 'スペース',  // name of the Space bar key

  // ---- Language selector ----
  'lang.select': '言語',  // tooltip and accessible label of the selector

  // ---- Top bar ----
  'topbar.docOptions': 'マップのオプション',  // tooltip of the "…" button next to the title (also for boards)
  'topbar.present': 'プレゼンテーション',  // tooltip: presentation mode
  'topbar.logout': 'ログアウト',  // tooltip: end the session
  'topbar.maps': 'マップ',
  'topbar.boards': 'ボード',
  'topbar.listMaps': 'マップ一覧',
  'topbar.listBoards': 'ボード一覧',

  // ---- Autosave status (text in the top bar) ----
  'status.saved': '保存済み',
  'status.saving': '保存中…',
  'status.conflict': '別のタブで文書が変更されました — 再読み込みしてください',
  'status.trashed': '別のタブで文書がゴミ箱に移動されました',
  'status.saveError': '保存エラー — 再試行しています',  // "save error, retrying"

  // ---- Documents (mind map or board) ----
  'doc.centralTopic': '中心トピック',  // text of the central topic of a new map
  'doc.untitledBoard': '無題のボード',  // title of a new board
  'doc.untitled': '（無題）',  // shown in the list for a document without a title
  'doc.copySuffix': ' のコピー',  // appended to the title when duplicating ("X のコピー", as in Google Drive / Finder); keep the leading space
  'doc.moveToTrash': 'ゴミ箱に移動',  // menu item
  'doc.trashConfirmMap': 'マップ「{title}」を削除しますか？ゴミ箱に移動され、そこから復元できます。',
  'doc.trashConfirmBoard': 'ボード「{title}」を削除しますか？ゴミ箱に移動され、そこから復元できます。',
  'doc.unsavedLeaveConfirm': 'このドキュメントには保存されていない変更があります（保存エラー）。変更を破棄して移動しますか？',
  'doc.duplicateError': 'マップを複製できませんでした。',  // also used for boards

  // ---- Document list (home page) ----
  'list.root': 'マイマップ',  // page title and name of the root folder (breadcrumb and "Move to" menu)
  'list.newFolder': '新規フォルダ',  // button
  'list.newBoard': '新規ボード',  // button
  'list.newMap': '新規マップ',  // button
  'list.searchPlaceholder': 'マップ、ボード、スキル、フォルダを検索',  // placeholder of the search field
  'list.sortBy': '並べ替え',  // tooltip of the sort selector
  'list.sortRecent': '更新日時（新しい順）',  // "modified recently first"
  'list.sortOldest': '更新日時（古い順）',  // "modified longest ago first"
  'list.sortAz': '名前（A–Z）',
  'list.sortZa': '名前（Z–A）',
  'list.empty': 'マップはまだありません。最初のマップを作成しましょう。',
  'list.noMaps': 'マップはまだありません。',
  'list.noBoards': 'ボードはまだありません。',
  'list.emptyFolder': 'このフォルダは空です。',
  'list.searchNoResults': '「{query}」に一致する項目はありません。',
  'list.createMapError': 'マップを作成できませんでした。',
  'list.createBoardError': 'ボードを作成できませんでした。',

  // ---- Folders ----
  'folder.moveTo': '移動先',  // title of the menu listing destination folders
  'folder.newPrompt': '新しいフォルダの名前',  // prompt when creating
  'folder.renamePrompt': 'フォルダ名',  // prompt when renaming
  'folder.deleteConfirm': 'フォルダ「{name}」を削除しますか？中にあるもの（マップ、ボード、サブフォルダ）は上の階層のフォルダに移動されます。',
  'folder.saveError': 'フォルダを保存できませんでした。',

  // ---- Trash ----
  'trash.title': 'ゴミ箱 ({n})',  // {n}: number of documents
  'trash.deletedAt': '{date} に削除',  // {date}: date and time, already formatted
  'trash.purge': '完全に削除',  // button: permanent deletion
  'trash.purgeConfirm': '完全に削除しますか？この操作は元に戻せません。',
  'trash.restoreConflict': '同じ ID のマップがすでに存在するため、復元できませんでした。',

  // ---- Version history ----
  'history.title': 'バージョン履歴',  // button tooltip and panel title
  'history.hint': '編集中は2分ごとに保存・最新50件',  // "a copy every 2 min of editing · last 50"
  'history.empty': '以前のバージョンはまだありません。',
  'history.entryOne': '{title}・1 トピック',  // version with a single topic
  'history.entryMany': '{title}・{n} トピック',  // {n}: number of topics (0 or more than 1)
  'history.restoreConfirm': 'このバージョンを復元しますか？（Ctrl+Z で元に戻せます）',
  'history.loadError': 'このバージョンを読み込めませんでした。',

  // ---- Export ----
  'export.title': 'エクスポート',  // button tooltip
  'export.png': '画像 (PNG)',
  'export.pdf': 'PDF（印刷 / 保存）',
  'export.svg': 'ベクター (SVG)',
  'export.md': 'テキスト (Markdown)',
  'export.error': 'エクスポートできませんでした：{error}',
  'export.fileFallback': 'マップ',  // exported file name when the title has no letters or digits

  // ---- Technical errors (inserted into {error} of other messages) ----
  'error.fileTooLarge': 'ファイルが 20 MB を超えています',
  'error.invalidImage': '無効な画像です',

  // ---- Presentation ----
  'present.prev': '前へ (←)',  // tooltip
  'present.next': '次へ（→ または スペース）',  // tooltip
  'present.exit': '終了 (Esc)',  // tooltip: leave the presentation

  // ---- Zoom (map and board) ----
  'zoom.out': 'ズームアウト',  // tooltip
  'zoom.in': 'ズームイン',  // tooltip
  'zoom.reset': 'ズーム 100%',  // tooltip of the button that shows the current zoom
  'zoom.fit': '画面に合わせる',  // tooltip

  // ---- Map: bar above the selected topic (button tooltips) ----
  'map.toolbar.style': '色と形',  // "colour and shape"
  'map.toolbar.text': 'テキストのスタイル',
  'map.toolbar.image': '画像',
  'map.toolbar.attachments': '添付ファイル',
  'map.toolbar.comments': 'コメント (Alt+Shift+C)',
  'map.toolbar.delete': '削除 (Del)',
  'map.connect': '他のトピックと接続',  // tooltip and menu item: create a connection (arrow) to another topic
  'map.addChild': '子トピックを追加 (Tab)',  // tooltip of the "+" button
  'map.addSibling': '兄弟トピックを追加 (Enter)',  // tooltip of the "+" button ("sibling topic")
  'map.hint.child': '子',  // short hint next to the Tab key: creates a child topic ("child")
  'map.hint.sibling': '兄弟',  // short hint next to the Enter key: creates a sibling topic ("sibling")
  'map.outline': 'アウトライン (Alt+Shift+O)',  // tooltip: view the map as an editable list
  'map.openError': 'このマップを開けませんでした。ファイルが破損しています。',

  // ---- Map: topic menu ----
  'map.menu.child': '子トピックを追加',
  'map.menu.sibling': '兄弟トピックを追加',
  'map.menu.collapse': '折りたたむ / 展開',  // menu item and tooltip of the marker in the outline
  'map.menu.focus': 'このブランチにフォーカス',
  'map.menu.showBranchAs': 'ブランチの表示形式',  // followed by the layout options ("show branch as")
  'map.menu.copyBranch': 'ブランチをコピー',
  'map.menu.cutBranch': 'ブランチを切り取り',
  'map.menu.pasteBranch': 'ブランチを貼り付け',

  // ---- Map: layout ----
  'map.layout.title': 'レイアウト',  // tooltip of the selector
  'map.layout.map': 'マップ',  // mind map (branches on both sides)
  'map.layout.org': '組織図',  // "org chart"
  'map.layout.list': 'リスト',

  // ---- Map: focus mode ----
  'map.focus.label': 'フォーカス：',  // followed by the name of the focused branch
  'map.focus.exit': 'フォーカスを解除',  // button ("exit focus")

  // ---- Map: topic image ----
  'map.image.drop': 'ここに画像をドロップ、またはクリックして選択',
  'map.image.formats': 'PNG、JPG、GIF、WEBP・最大 20 MB',
  'map.image.remove': '画像を削除',
  'map.image.addError': '画像を追加できませんでした：{error}',

  // ---- Map: topic attachments ----
  'map.attach.title': '添付ファイル',  // panel title
  'map.attach.add': 'ファイルを追加',
  'map.attach.hint': 'ドロップまたはクリック・1 ファイル最大 20 MB',  // "drop here or click · up to 20 MB each"
  'map.attach.remove': '添付ファイルを削除',  // tooltip of the × button
  'map.attach.uploadError': 'ファイルをアップロードできませんでした：{error}',

  // ---- Map: topic comments ----
  'map.comment.placeholder': 'コメントを追加',  // placeholder of the field
  'map.comment.send': '送信 (Enter)',  // tooltip
  'map.comment.delete': 'コメントを削除',  // tooltip of the × button

  // ---- Map: topic text style ----
  'map.text.bold': '太字 (Ctrl+B)',  // tooltip
  'map.text.italic': '斜体 (Ctrl+I)',  // tooltip
  'map.text.size': 'サイズ',
  'map.text.small': '小',
  'map.text.medium': '中',
  'map.text.large': '大',
  'map.text.color': '文字色',

  // ---- Map: topic link ----
  'map.url.placeholder': 'URL (https://…)',  // placeholder of the field: web address
  'map.url.invalid': 'http:// または https:// で始まる URL を入力してください',
  'map.url.remove': 'リンクを削除',

  // ---- Map: "Colour and shape" panel ----
  'map.style.tabShape': '形',  // tab ("shape")
  'map.style.tabBorder': '枠線',  // tab ("border")
  'map.style.tabLine': '線',  // tab: the line connecting the topic to its parent
  'map.style.themeColors': 'テーマの色',
  'map.style.customColors': 'カスタムの色',
  'map.style.pickColor': '色を選択',  // tooltip of the "+" button
  'map.style.auto': '自動',  // swatch tooltip: automatic colour (the branch's)
  'map.style.noFill': '塗りつぶしなし',  // swatch tooltip
  'map.style.boundary': '囲み線で表示',  // on/off switch: dashed area around the branch ("show as boundary")
  'map.style.borderColor': '枠線の色',
  'map.style.lineColor': '親への線の色',  // "colour of the line to the parent"
  'map.style.width': '太さ',  // of the border or line
  'map.style.thin': '細い',
  'map.style.medium': '普通',
  'map.style.thick': '太い',
  'map.style.style': 'スタイル',  // of the border or line: solid, dashed, dotted
  'map.style.solid': '実線',
  'map.style.dashed': '破線',
  'map.style.dotted': '点線',

  // ---- Map: topic shape (tooltips) ----
  'map.shape.underline': '下線',  // just an underline, no box
  'map.shape.rect': '四角形',
  'map.shape.rounded': '角丸',  // rounded rectangle
  'map.shape.pill': '楕円',
  'map.shape.cloud': '雲',

  // ---- Map: connections between topics (free arrows) ----
  'map.link.color': '色',  // tooltip
  'map.link.startMarker': '始点の形',  // tooltip: marker at the start of the connection
  'map.link.endMarker': '終点の形',  // tooltip: marker at the end of the connection
  'map.link.swap': '向きを反転',  // tooltip
  'map.link.addLabel': 'ラベルを追加',  // menu item
  'map.link.delete': '接続を削除',  // menu item
  'map.link.labelPrompt': '接続のラベル',  // prompt
  'map.link.exitTop': '上から出す',  // tooltip: side of the topic the connection leaves from ("exit from top")
  'map.link.exitRight': '右から出す',
  'map.link.exitBottom': '下から出す',
  'map.link.exitLeft': '左から出す',

  // ---- Board: tools (tooltips; shortcut keys in parentheses) ----
  'board.tool.hand': '手のひら（H または スペース）',  // hand / pan tool
  'board.tool.select': '選択（V または 1）',
  'board.tool.rectangle': '矩形（R または 2）',
  'board.tool.diamond': 'ひし形（D または 3）',
  'board.tool.ellipse': '楕円（O または 4）',
  'board.tool.arrow': '矢印（A または 5）',
  'board.tool.line': '線（L または 6）',
  'board.tool.freedraw': '鉛筆（P または 7）',
  'board.tool.text': 'テキスト（T または 8）',
  'board.tool.note': '付箋 (N)',
  'board.tool.eraser': '消しゴム（E または 0）',
  'board.tool.more': 'その他のツール',
  'board.tool.image': '画像を挿入',  // menu item
  'board.tool.bucket': '塗りつぶしツール',  // menu item (paint bucket)
  'board.tool.lasso': 'なげなわ選択',  // menu item
  'board.tool.laser': 'レーザーポインター',  // menu item

  // ---- Board: style panel ----
  'board.props.stroke': '線',  // stroke colour
  'board.props.background': '背景',  // background colour
  'board.props.noBackground': '背景なし',  // tooltip of the transparent swatch
  'board.props.fill': '塗りつぶし',
  'board.props.fillHachure': '斜線',  // hachure fill
  'board.props.fillSolid': 'ベタ塗り',  // solid fill
  'board.props.width': '線の太さ',  // stroke width
  'board.props.widthThin': '細い',
  'board.props.widthMedium': '普通',
  'board.props.widthThick': '太い',
  'board.props.strokeStyle': '線の種類',
  'board.props.strokeSolid': '実線',
  'board.props.strokeDashed': '破線',
  'board.props.strokeDotted': '点線',
  'board.props.roughness': 'ばらつき',  // sloppiness: how hand-drawn the stroke looks
  'board.props.roughArchitect': '建築家',  // straight, precise stroke ("architect")
  'board.props.roughArtist': 'アーティスト',  // slightly irregular
  'board.props.roughCartoonist': '漫画家',  // very irregular ("cartoonist")
  'board.props.fontFamily': 'フォントの種類',
  'board.props.fontHand': '手書き風',  // handwritten
  'board.props.fontNormal': '標準',
  'board.props.fontCode': 'コード',  // monospaced font
  'board.props.fontSize': 'フォントサイズ',
  'board.props.sizeS': 'S',  // abbreviation of "small" (button label)
  'board.props.sizeM': 'M',  // abbreviation of "medium"
  'board.props.sizeL': 'L',  // abbreviation of "large"
  'board.props.sizeXL': 'XL',  // abbreviation of "extra large"
  'board.props.textAlign': 'テキストの配置',
  'board.props.alignLeft': '左揃え',
  'board.props.alignCenter': '中央揃え',
  'board.props.alignRight': '右揃え',
  'board.props.opacity': '透明度',
  'board.props.layers': 'レイヤー',  // stacking order
  'board.props.toBack': '最背面へ移動',
  'board.props.backward': '背面へ移動',
  'board.props.forward': '前面へ移動',
  'board.props.toFront': '最前面へ移動',
  'board.props.actions': '操作',  // "actions"
  'board.props.link': 'リンク (Ctrl+K)',  // tooltip

  // ---- Board: bottom bar and messages ----
  'board.zoomOut': 'ズームアウト (Ctrl −)',  // tooltip
  'board.zoomIn': 'ズームイン (Ctrl +)',  // tooltip
  'board.openError': 'このボードを開けませんでした。ファイルが破損しています。',
  'board.image.insertError': '画像を挿入できませんでした：{error}',
  'board.link.prompt': 'リンクの URL（空欄にすると削除）',  // prompt
  'board.link.invalid': 'http または https の URL を入力してください。',

  // ---- Board: shortcut help (the …Keys keys are the key column) ----
  'board.help.button': 'ショートカット (?)',  // button tooltip
  'board.help.title': 'ボードのショートカット',
  'board.help.panKeys': 'H / スペース',
  'board.help.pan': '画面を移動',  // pan the canvas
  'board.help.selectKeys': 'V または 1',
  'board.help.select': '選択',
  'board.help.rectangleKeys': 'R または 2',
  'board.help.rectangle': '矩形',
  'board.help.diamondKeys': 'D または 3',
  'board.help.diamond': 'ひし形',
  'board.help.ellipseKeys': 'O または 4',
  'board.help.ellipse': '楕円',
  'board.help.arrowKeys': 'A または 5',
  'board.help.arrow': '矢印',
  'board.help.lineKeys': 'L または 6',
  'board.help.line': '線',
  'board.help.freedrawKeys': 'P または 7',
  'board.help.freedraw': '鉛筆',
  'board.help.image': '画像を挿入（Ctrl+V で貼り付け、またはファイルをボードにドラッグ）',
  'board.help.laser': 'レーザーポインター：軌跡は自動で消えます（保存されません）',
  'board.help.lasso': 'なげなわ選択：自由な線で囲んで選択（Shift で選択に追加）',
  'board.help.bucket': '塗りつぶしツール：図形の背景を塗ります（線やテキストの場合はその色）',
  'board.help.textKeys': 'T または 8',
  'board.help.text': 'テキスト（またはダブルクリック）。Enter で改行、Esc または外側をクリックで確定',
  'board.help.note': '付箋：クリックで作成してすぐに編集。テキストは付箋内で折り返されます',
  'board.help.eraserKeys': 'E または 0',
  'board.help.eraser': '消しゴム',
  'board.help.undoRedo': '元に戻す / やり直す',
  'board.help.duplicate': '複製',
  'board.help.clipboard': 'コピー / 切り取り / 貼り付け（タブ間や他のアプリとの間でも可能）',
  'board.help.selectAll': 'すべて選択',
  'board.help.link': '要素にリンク（アイコンをクリックで開く）',
  'board.help.delete': '削除',
  'board.help.nudgeKeys': '矢印キー',  // the keyboard arrow keys
  'board.help.nudge': '1 px 移動（Shift：10 px）',
  'board.help.layerStep': '前面へ / 背面へ移動',  // one layer forward / backward
  'board.help.layerEnds': '最前面へ / 最背面へ移動',
  'board.help.zoomKeys': 'Ctrl+ホイール、Ctrl ±',  // ホイール = mouse wheel
  'board.help.zoom': 'ズーム',

  // ---- Login page ----
  'login.title': 'ログイン · Brainstorm',  // tab title; "Brainstorm" is the app name, not translated
  'login.user': 'ユーザー名',  // field label
  'login.password': 'パスワード',  // field label
  'login.submit': 'ログイン',  // button
  'login.wrongCredentials': 'ユーザー名またはパスワードが正しくありません。',
  'login.tooManyAttempts': 'ログインの失敗が多すぎます。数分待ってから再度お試しください。',
  'login.failed': 'ログインできませんでした（HTTP {status}）。',
  'login.noConnection': 'サーバーに接続できません。',
  'topbar.skills': 'スキル',
  'topbar.listSkills': 'スキル一覧',
  'list.newSkill': '新しいスキル',
  'list.noSkills': 'スキルはまだありません。',
  'doc.untitledSkill': '無題のスキル',
  'doc.trashConfirmSkill': 'スキル「{title}」をゴミ箱に移動しますか？',
  'list.createSkillError': 'スキルを作成できませんでした。',
  'skill.template': '# {title}\n\n## 使うタイミング\n\n## 手順\n',
  'skill.edit': '編集',
  'skill.split': '分割',
  'skill.preview': 'プレビュー',
  'skill.saveVersion': 'バージョンを保存',
  'skill.versions': 'バージョン',
  'skill.versionLabelPrompt': 'バージョン名（任意）：',
  'skill.versionSaved': 'バージョンを保存しました',
  'skill.compare': '比較',
  'skill.closeCompare': '比較を閉じる',
  'skill.restoreConfirm': 'このバージョンを復元しますか？現在のテキストは履歴に保存されます。',
  'skill.diffTooLarge': 'テキストが大きすぎて比較できません。',
  'skill.chars': '{n} 文字',
  'skill.addTag': 'タグを追加',
  'skill.removeTag': 'タグ {tag} を削除',
  'skill.noVersions': 'バージョンはまだありません。',
  'topbar.settings': '設定',
  'topbar.settingsLlm': 'LLM の設定',
  'topbar.settingsBackup': 'バックアップの設定（オブジェクトストレージ）',
  'settings.llm.title': 'LLM の設定',
  'settings.llm.hint': '今後の機能で使う API キーです。キーはサーバーにだけ保存され、保存後は末尾の数文字しか表示されません。バックアップにも含まれません。',
  'settings.llm.custom': 'カスタム（OpenAI 互換）',
  'settings.llm.key': 'API キー',
  'settings.llm.keyPlaceholder': 'キーを貼り付け',
  'settings.llm.model': '既定のモデル',
  'settings.llm.modelPlaceholder': '任意',
  'settings.llm.baseUrl': 'ベース URL（http:// または https://）',
  'settings.llm.configured': 'キー保存済み',
  'settings.llm.notConfigured': 'キーなし',
  'settings.llm.removeConfirm': '{name} のキーを削除しますか？',
  'settings.llm.removed': 'キーを削除しました。',
  'settings.llm.default': 'デフォルト',
  'settings.llm.defaultNeedsKey': 'デフォルトにするには先にキーを保存してください',
  'settings.llm.defaultSaved': '{name} がデフォルトの LLM になりました。',
  'settings.secretSaved': '保存済み（{hint}）— 変更しないなら空のまま',
  'settings.saved': '保存しました。',
  'settings.remove': '削除',
  'settings.error': 'エラー: {detail}',
  'settings.busy': 'バックアップまたは復元がすでに実行中です。',
  'settings.backup.title': 'オブジェクトストレージへのバックアップ',
  'settings.backup.hint': 'Wasabi（または S3 互換ストレージ）へ自動でバックアップします。マップ、ボード、スキル、添付ファイルを 1 つの .tar.gz にまとめます。API キーとストレージのキーは含まれません。',
  'settings.backup.region': 'Wasabi のリージョン',
  'settings.backup.regionPlaceholder': '例: ap-northeast-1',
  'settings.backup.endpoint': 'エンドポイント（https://）',
  'settings.backup.bucket': 'バケット',
  'settings.backup.prefix': 'プレフィックス（バケット内のフォルダー）',
  'settings.backup.accessKey': 'アクセスキー',
  'settings.backup.secretKey': 'シークレットキー',
  'settings.backup.secretPlaceholder': 'シークレットキーを貼り付け',
  'settings.backup.interval': '頻度',
  'settings.backup.every6h': '6 時間ごと',
  'settings.backup.every12h': '12 時間ごと',
  'settings.backup.every24h': '1 日 1 回',
  'settings.backup.every7d': '週 1 回',
  'settings.backup.keep': '保持する件数（最新から）',
  'settings.backup.enabled': '自動バックアップを有効にする（変更があったときだけ）',
  'settings.backup.saved': '設定を保存しました。',
  'settings.backup.invalid': '入力内容を確認してください。エンドポイントは https:// で始まり、バケット名には小文字の英字・数字・ピリオド・ハイフンだけが使えます。',
  'settings.backup.status': '状況',
  'settings.backup.run': '今すぐバックアップ',
  'settings.backup.running': 'バックアップ中…',
  'settings.backup.notConfigured': 'エンドポイント、バケット、2 つのキーを入力して保存すると、バックアップを使えます。',
  'settings.backup.never': 'まだバックアップはありません。',
  'settings.backup.lastSuccess': '前回のバックアップ: {when}',
  'settings.backup.lastError': '直近のエラー（{when}）: {error}',
  'settings.backup.list': 'バケット内のバックアップ',
  'settings.backup.loading': '読み込み中…',
  'settings.backup.empty': 'バケットにはまだバックアップがありません。',
  'settings.backup.restoreConfirm': '{when} のバックアップを復元しますか？\n\n現在のマップ、ボード、スキルはすべて置き換えられます。復元の前に現在の状態をバックアップします。',
  'settings.backup.restoring': '復元中…（まず現在の状態をバックアップ）',
};
