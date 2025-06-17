// index.js — backend Design Chat (Render)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const systemPrompt = `
Tu es un expert en design UX/UI et en pédagogie.
Ton objectif est d’évaluer le niveau d’un apprenant qui suit un parcours de formation en conception centrée utilisateur.
Pose-lui une série de questions simples, ouvertes et progressives pour estimer son niveau global (débutant, intermédiaire ou avancé).
En fonction de ses réponses, propose-lui une playlist de vidéos pédagogiques adaptées à ses besoins pour renforcer ses connaissances.
Sois bienveillant, clair et encourageant.
Pose une première question maintenant, puis attends sa réponse avant de continuer.
`;

app.post("/message", async (req, res) => {
  const { message, email } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Le champ 'message' est requis." });
  }

  try {
    /* ---- Appel API Mistral Cloud ---- */
    const resp = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "mistral-small-latest",      // ou tiny / medium / large selon ton plan
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message }
        ],
        temperature: 0.7
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Mistral API error:", errText);
      return res.status(500).json({ error: "Appel Mistral échoué" });
    }

    const data = await resp.json();
    const reply =
      data.choices?.[0]?.message?.content ??
      "Désolé, je n'ai pas pu générer de réponse.";

    /* ---- (Optionnel) Envoi d'e-mail via SendGrid ---- */
    // … garde ton code SendGrid ici si tu envoies la synthèse par mail …

    return res.json({ reply });
  } catch (err) {
    console.error("Erreur backend:", err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
});

/* Route GET racine (vérification rapide) */
app.get("/", (req, res) => {
  res.send("✅ API Design Chat opérationnelle");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur port ${PORT}`);
});
