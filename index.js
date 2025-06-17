// index.js — backend Design-Chat (Render)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";            // npm i node-fetch
import { v4 as uuid } from "uuid";         // npm i uuid
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

/* ------------------------------------------------------------------ */
/* 1. PROMPT SYSTÈME OPTIMISÉ                                          */
/* ------------------------------------------------------------------ */
const systemPrompt = `
Tu es un expert en design UX/UI et en pédagogie.

OBJECTIF
--------
Évaluer le niveau global d’un apprenant en conception centrée utilisateur, puis lui recommander des ressources vidéo adaptées.

RÈGLES DU DIALOGUE
------------------
1. Pose EXACTEMENT 5 questions simples, ouvertes et progressives.  
2. Pose UNE seule question à la fois ; attends la réponse avant de poursuivre.  
3. Ne donne aucun indice de correction avant la fin des 5 questions.  
4. Si la réponse est vide ou hors-sujet, reformule ou clarifie la question.

FORMAT FINAL (après la 5ᵉ réponse)
-----------------------------------
Quand tu as reçu la 5ᵉ réponse, réponds en suivant strictement ce gabarit :

**SYNTHÈSE DU NIVEAU**  
- Niveau global : <débutant | intermédiaire | avancé>  
- Points forts : <liste concise>  
- Points à améliorer : <liste concise>

**PLAYLIST RECOMMANDÉE**  
1. <Titre vidéo 1> – <URL 1>  
2. <Titre vidéo 2> – <URL 2>  
3. <Titre vidéo 3> – <URL 3>  

DÉBUT DE LA CONVERSATION
------------------------
Commence maintenant avec la première question :
« Pour commencer, peux-tu expliquer ce que tu entends par “expérience utilisateur” ? »
`;

/* ------------------------------------------------------------------ */
/* 2. MÉMOIRE DE SESSION EN MÉMOIRE (clé = email)                      */
/* ------------------------------------------------------------------ */
const sessions = new Map(); // { email: { id, history: [...] } }

/* ------------------------------------------------------------------ */
/* 3. APPEL À L’API MISTRAL                                            */
/* ------------------------------------------------------------------ */
async function callMistral(history) {
  const resp = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "mistral-small-latest",
      messages: history,
      temperature: 0.7
    })
  });

  if (!resp.ok) {
    throw new Error(`Mistral API error : ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.choices[0].message.content;
}

/* ------------------------------------------------------------------ */
/* 4. ENVOI D’UN MAIL VIA SENDGRID                                     */
/* ------------------------------------------------------------------ */
async function sendEmail(to, content) {
  await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }], subject: "Votre synthèse Design-Chat" }],
      from: { email: process.env.EMAIL_FROM || "chat@exemple.com", name: "Design Chat AI" },
      content: [{ type: "text/plain", value: content }]
    })
  });
}

/* ------------------------------------------------------------------ */
/* 5. ENDPOINT PRINCIPAL                                               */
/* ------------------------------------------------------------------ */
app.post("/message", async (req, res) => {
  const { message, email } = req.body;
  if (!message || !email) return res.status(400).json({ error: "message et email requis" });

  // récupère ou crée la session
  let session = sessions.get(email);
  if (!session) {
    session = {
      id: uuid(),
      history: [{ role: "system", content: systemPrompt }]
    };
    sessions.set(email, session);
  }

  // ajoute le message utilisateur à l’historique
  session.history.push({ role: "user", content: message });

  try {
    // appelle Mistral avec tout l’historique
    const assistantReply = await callMistral(session.history);
    session.history.push({ role: "assistant", content: assistantReply });

    // envoie la réponse au frontend
    res.json({ reply: assistantReply });

    // si la réponse contient la synthèse, envoie le mail et supprime la session
    if (assistantReply.includes("**SYNTHÈSE DU NIVEAU**")) {
      await sendEmail(email, assistantReply);
      sessions.delete(email);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ reply: "Erreur serveur ou IA inaccessible." });
  }
});

/* Route GET simple pour vérif */
app.get("/", (_, res) => res.send("✅ API Design-Chat opérationnelle"));

/* ------------------------------------------------------------------ */
app.listen(process.env.PORT || 3000, () => {
  console.log("✅ Serveur lancé");
});
