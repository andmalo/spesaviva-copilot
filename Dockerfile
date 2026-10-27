# Contenitore unico per il deploy (Render): ChromaDB, data agent e back end, che serve anche il front end.
# Solo il back end è esposto; data agent e ChromaDB ascoltano su 127.0.0.1 dentro il contenitore.

# --- 1. Front end compilato e dipendenze Node del back end ---------------------
FROM node:22-bookworm-slim AS node
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --omit=dev
COPY frontend frontend
# Il front end legge gli scenari dal file condiviso con il back end
COPY backend/scenari.json backend/scenari.json
RUN cd frontend && npm run build

# --- 2. Immagine finale: Python + Node --------------------------------------------
FROM python:3.13-slim-bookworm
WORKDIR /app
COPY --from=node /usr/local/bin/node /usr/local/bin/node

# Dipendenze Python, senza quelle che servono solo al notebook e ai test
COPY requirements.txt .
RUN python -m venv .venv \
 && grep -viE "^(jupyter|ipykernel|pytest)==" requirements.txt > /tmp/requisiti.txt \
 && .venv/bin/pip install --no-cache-dir -r /tmp/requisiti.txt

COPY --from=node /app/backend/node_modules backend/node_modules
COPY --from=node /app/frontend/dist frontend/dist
COPY package.json avvia.mjs ./
COPY backend backend
COPY data_agent data_agent
COPY data data

# Utente senza privilegi per il data agent: il codice scritto dall'LLM gira con questo utente
# e non può leggere variabili d'ambiente e memoria degli altri processi (dove c'è la chiave)
RUN groupadd -g 10001 agente && useradd -u 10001 -g 10001 -M -s /usr/sbin/nologin agente \
 && mkdir -p data_agent/charts chroma_data \
 && chown agente:agente data_agent/charts

ENV MODALITA=produzione \
    UID_DATA_AGENT=10001 \
    GID_DATA_AGENT=10001 \
    MPLCONFIGDIR=/tmp/matplotlib \
    PORT=10000
EXPOSE 10000
CMD ["node", "avvia.mjs", "produzione"]
