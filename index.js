// index.js  — backend Design Chat
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/**
 * POST /message
 * Corps JSON attendu :
 * {
 *   "message": "Texte de l'utilisateur",
 *   "email":   "optionnel@example.com"
 * }
 */
app.post("/message", async (req, res) => {
  const { message, email } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Le champ 'message' est requis." });
  }

  try {
    /* ---- 1) Appel Mistral -------------------------------------------------- */
    const mistral = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "mistral-tiny",
        messages: [
          { role: "system", content: "const systemPrompt = `Tu es un expert en design UX/UI et en pédagogie. Ton objectif est d’évaluer le niveau d’un apprenant qui suit un parcours de formation en conception centrée utilisateur. Pose-lui une série de questions simples, ouvertes et progressives pour estimer son niveau global (débutant, intermédiaire ou avancé). En fonction de ses réponses, propose-lui une playlist de vidéos pédagogiques adaptées à ses besoins pour renforcer ses connaissances. Sois bienveillant, clair et encourageant. Pose une première question maintenant, puis attends sa réponse avant de continuer.`;" },
          { role: "user", content: message }
        ]
      })
    });

    const data = await mistral.json();
    const reply =
      data?.choices?.[0]?.message?.content ??
      "Désolé, je n'ai pas pu générer de réponse.";

    /* ---- 2) Envoi d'email (facultatif) ------------------------------------ */
    if (email && process.env.SENDGRID_API_KEY) {
      const emailBody = `
Voici la réponse de l'IA :

${reply}

Merci d'avoir utilisé le chatbot Design !`;

      await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email }], subject: "Votre synthèse Design Chat" }],
          from: { email: process.env.EMAIL_FROM || "chat@tondomaine.com", name: "Design Chat AI" },
          content: [{ type: "text/plain", value: emailBody }]
        })
      });
    }

    /* ---- 3) Réponse au frontend ------------------------------------------- */
    return res.json({ reply });
  } catch (err) {
    console.error("Erreur serveur :", err);
    return res.status(500).json({ error: "Erreur interne du serveur." });
  }
});

/* ---- Route GET racine : simple check -------------------------------------- */
app.get("/", (req, res) => {
  res.send("✅ API Design Chat opérationnelle");
});

/* ---- Lancement du serveur ------------------------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
