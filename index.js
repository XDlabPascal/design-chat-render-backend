import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch'; // installe via `npm install node-fetch`

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(bodyParser.json());

// 🧠 Prompt de rôle injecté
const systemPrompt = `
Tu es un expert en design UX/UI et en pédagogie.
Ton objectif est d’évaluer le niveau d’un apprenant qui suit un parcours de formation en conception centrée utilisateur.
Pose-lui une série de questions simples, ouvertes et progressives pour estimer son niveau global (débutant, intermédiaire ou avancé).
En fonction de ses réponses, propose-lui une playlist de vidéos pédagogiques adaptées à ses besoins pour renforcer ses connaissances.
Sois bienveillant, clair et encourageant.
Pose une première question maintenant, puis attends sa réponse avant de continuer.
`;

app.post('/message', async (req, res) => {
  const userMessage = req.body.message;

  try {
    const response = await fetch('http://localhost:11434/api/generate', { // adapte l'URL si nécessaire
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'mistral', // nom du modèle chargé dans Ollama, LM Studio, etc.
        prompt: `${systemPrompt}\n\nUtilisateur : ${userMessage}\nIA :`, // injecte le prompt ici
        stream: false
      })
    });

    const data = await response.json();

    res.json({ reply: data.response || 'Réponse non disponible.' });
  } catch (error) {
    console.error('Erreur lors de l’appel au modèle :', error);
    res.status(500).json({ reply: 'Erreur serveur ou IA inaccessible.' });
  }
});

app.get('/', (req, res) => {
  res.send('Backend Design Chat opérationnel !');
});

app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
