# Galho: só a biblioteca padrão do Python, nenhuma dependência para instalar
FROM python:3.13-slim

ENV BRAINSTORM_HOST=0.0.0.0 \
    BRAINSTORM_DATA=/data \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY app.py store.py s3.py backup.py ./
COPY static ./static

# roda sem root; o docker-compose troca o usuário pelo seu (arquivos de ./data ficam seus)
RUN useradd --uid 1000 --create-home galho && mkdir /data && chown galho /data
USER galho

VOLUME /data
EXPOSE 8000
CMD ["python", "app.py", "8000"]
