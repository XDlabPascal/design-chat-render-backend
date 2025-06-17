import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch'; // Assure-toi que node-fetch est installé

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Exemple d'URL et clé d'API Mistral (à adapter)
const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

// Fonction pour construire le prompt
function buildPrompt(userMessage) {
  return `
Tu es un expert en design UX/UI. Tu veux évaluer le niveau d'un apprenant en posant 5 questions simples, puis tu lui proposes une playlist de 10 vidéos YouTube en français pour progresser. 
Enfin, tu prépares une synthèse claire avec :
- le niveau global (Débutant, Intermédiaire, Avancé),
- les points forts,
- les points faibles,
- la liste des 10 vidéos.

Voici la réponse de l’apprenant : "${userMessage}"

Format de réponse JSON strict, avec clés : niveau, pointsForts, pointsFaibles, videos (tableau de liens).

Donne uniquement la réponse JSON, rien d’autre.
`;
}

app.post('/message', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "Pas de message reçu." });

  try {
    const prompt = buildPrompt(message);

    // Envoi à Mistral (modèle, headers, etc. à adapter selon l’API)
    const apiResponse = await fetch(MISTRAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: "mistral-7b-chat",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
        temperature: 0.7
      }),
    });

    const data = await apiResponse.json();

    if (!data.choices || data.choices.length === 0) {
      return res.status(500).json({ error: "Réponse inattendue de l'IA." });
    }

    const content = data.choices[0].message.content.trim();

    // Parse JSON renvoyé par l'IA
    let synthese;
    try {
      synthese = JSON.parse(content);
    } catch (e) {
      // Si l’IA ne renvoie pas un JSON parfait, renvoyer en texte simple
      return res.json({ reply: content });
    }

    // Envoie la synthèse complète au front
    res.json({ synthese });

  } catch (error) {
    console.error("Erreur serveur :", error);
    res.status(500).json({ error: "Erreur serveur ou IA inaccessible." });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
