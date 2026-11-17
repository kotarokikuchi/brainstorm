# Brainstorm

Mapas mentais e quadros de desenho para uso pessoal, rodando na sua máquina.

## Rodar com Docker

```bash
docker compose up -d --build
```

Abra http://127.0.0.1:8000. Os dados ficam em `./data` (mapas, quadros, anexos, histórico,
lixeira e pastas). Para parar: `docker compose down`. Depois de mudar o código, rode o
`docker compose up -d --build` de novo.

Se `docker ps` mostrar a coluna PORTS vazia, a porta 8000 estava ocupada quando o container
subiu (por exemplo, pelo `python app.py`). Pare o outro servidor e rode
`docker compose up -d --force-recreate`.

Outra porta: troque `127.0.0.1:8000:8000` por, por exemplo, `127.0.0.1:8080:8000` no
`docker-compose.yml`.

## Onde ficam os dados

```
data/
├── brainstorm.db     ← mapas, quadros, histórico, lixeira e pastas (SQLite)
└── attachments/      ← imagens e anexos, uma pasta por documento
```

Para arquivar num storage externo, basta guardar esses dois itens. Com o app rodando, copie o
banco com segurança assim (o arquivo `.db` sozinho pode estar no meio de uma gravação):

```bash
python3 -c "import sqlite3; sqlite3.connect('data/brainstorm.db').backup(sqlite3.connect('backup.db'))"
cp -r data/attachments backup-attachments
```

Ou pare o app (`docker compose down`) e copie a pasta `data/` inteira.

Para deixar os anexos direto num disco externo, use `GALHO_FILES=/caminho/do/disco` (no Docker,
veja o comentário no `docker-compose.yml`).

Na primeira vez que a versão com banco sobe, os dados do formato antigo (um `.json` por documento)
são importados sozinhos; os arquivos antigos ficam guardados em `data/legacy-<data>/`.

## Rodar sem Docker

Só precisa do Python 3:

```bash
python app.py        # http://127.0.0.1:8000  (ou: python app.py 8080)
```

Nesse modo o servidor reinicia sozinho quando `app.py` muda, e a página recarrega quando
`static/` muda.

Variáveis opcionais: `GALHO_HOST` (padrão `127.0.0.1`), `GALHO_DATA` (padrão `./data`) e
`GALHO_FILES` (padrão `<GALHO_DATA>/attachments`).

## Testes

```bash
python -m unittest test_app        # servidor
node --test tests/*.test.mjs       # lógica dos mapas, quadros e pastas
node tests/e2e.mjs                 # ponta a ponta no Chrome headless (~2 min)
```
