# Galho

Mapas mentais e quadros de desenho para uso pessoal, rodando na sua máquina.

## Rodar com Docker

```bash
docker compose up -d --build
```

Abra http://127.0.0.1:8000. Os dados ficam em `./data` (mapas, quadros, anexos, histórico,
lixeira e pastas). Para parar: `docker compose down`. Depois de mudar o código, rode o
`docker compose up -d --build` de novo.

Outra porta: troque `127.0.0.1:8000:8000` por, por exemplo, `127.0.0.1:8080:8000` no
`docker-compose.yml`.

## Rodar sem Docker

Só precisa do Python 3:

```bash
python app.py        # http://127.0.0.1:8000  (ou: python app.py 8080)
```

Nesse modo o servidor reinicia sozinho quando `app.py` muda, e a página recarrega quando
`static/` muda.

Variáveis opcionais: `GALHO_HOST` (padrão `127.0.0.1`) e `GALHO_DATA` (padrão `./data`).

## Testes

```bash
python -m unittest test_app        # servidor
node --test tests/*.test.mjs       # lógica dos mapas, quadros e pastas
node tests/e2e.mjs                 # ponta a ponta no Chrome headless (~2 min)
```
