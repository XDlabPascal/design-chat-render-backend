import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';
import nodemailer from 'nodemailer';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(bodyParser.json());

const mistralEndpoint = 'https://api.mistral.ai/v1/chat/completions';
const mistralApiKey = process.env.MISTRAL_API_KEY;

const systemPrompt = `
Tu es un expert en design UX/UI et en pédagogie.

OBJECTIF  
--------
Évaluer le niveau global d’un apprenant en conception centrée utilisateur, puis lui recommander des ressources adaptées à son niveau.

RÈGLES DU DIALOGUE  
------------------  
1. Pose EXACTEMENT 5 questions simples, ouvertes et progressives.  
2. Pose UNE seule question à la fois ; attends la réponse avant de poursuivre.  
3. Ne donne aucun indice de correction avant la fin des 5 questions.  
4. Si la réponse est vide ou hors-sujet, reformule ou clarifie la question.

À LA FIN DES 5 QUESTIONS  
------------------------  
Quand tu as reçu les 5 réponses, génère :  

**1. UNE SYNTHÈSE DU NIVEAU :**  
- Niveau global : <débutant | intermédiaire | avancé>  
- Points forts : <liste concise>  
- Points à améliorer : <liste concise>  

**2. UNE PLAYLIST DE 10 VIDÉOS YOUTUBE EN FRANÇAIS :**  
- Donne UNIQUEMENT des vidéos YouTube.  
- Le contenu doit être clair, pédagogique, et destiné à des designers UX/UI.  
- Priorise les vidéos en langue française ou avec sous-titres français.  
- Présente chaque vidéo ainsi :
  - <Titre de la vidéo> – <URL YouTube>

DÉBUT DE LA CONVERSATION  
------------------------  
Commence immédiatement avec cette première question :  
« Pour commencer, peux-tu expliquer ce que signifie pour toi l’expérience utilisateur (UX) ? »
`;

app.post('/message', async (req, res) => {
  const { message, email } = req.body;

  try {
    const response = await fetch(mistralEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mistralApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'mistral-medium',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        temperature: 0.7,
      })
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'Réponse indisponible.';

    if (email && reply.includes('Niveau global')) {
      await sendSummaryByEmail(email, reply);
    }

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ reply: "Erreur serveur ou IA inaccessible." });
  }
});

async function sendSummaryByEmail(to, content) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER, // adresse Gmail
      pass: process.env.EMAIL_PASS  // mot de passe ou app password
    }
  });

  await transporter.sendMail({
    from: `"Coach IA Design" <${process.env.EMAIL_USER}>`,
    to,
    subject: "Synthèse et ressources pour progresser en design UX",
    text: content
  });
}

app.get('/', (req, res) => {
  res.send("Serveur IA Design prêt.");
});

app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
