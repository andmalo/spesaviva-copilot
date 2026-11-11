// Rotte di servizio: grafici del data agent, scenari della demo e stato dei servizi.
const express = require("express");

const { indirizzoDataAgent, NOME_GRAFICO } = require("../strumenti");
const { creaClient } = require("../rag/config");
const { SCENARI } = require("../scenari");

const router = express.Router();

// Grafici del data agent, presi dal servizio interno (solo i nomi nel formato generato dal codice)
router.get("/api/grafici/:nome", async (req, res) => {
  if (!NOME_GRAFICO.test(req.params.nome)) return res.status(404).end();
  try {
    const risposta = await fetch(`${indirizzoDataAgent()}/charts/${req.params.nome}`, { signal: AbortSignal.timeout(10_000) });
    if (!risposta.ok) return res.status(404).end();
    res.type("png").send(Buffer.from(await risposta.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
});

// Scenari della demo disponibili (il front end mostra il menu e invia solo l'id)
router.get("/api/scenari", (req, res) => {
  res.json(SCENARI);
});

// Stato del server e dei servizi da cui dipende
router.get("/api/health", async (req, res) => {
  const controlli = await Promise.allSettled([
    creaClient().heartbeat(),
    fetch(`${indirizzoDataAgent()}/health`, { signal: AbortSignal.timeout(5000) }).then((r) => {
      if (!r.ok) throw new Error("stato non valido");
    }),
  ]);
  const chromadb = controlli[0].status === "fulfilled" ? "ok" : "non raggiungibile";
  const dataAgent = controlli[1].status === "fulfilled" ? "ok" : "non raggiungibile";
  const tuttoOk = chromadb === "ok" && dataAgent === "ok";

  res.status(tuttoOk ? 200 : 503).json({
    stato: tuttoOk ? "ok" : "degradato",
    server: "ok",
    chromadb,
    dataAgent,
  });
});

module.exports = { rotteServizi: router };
