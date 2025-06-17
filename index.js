import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(bodyParser.json());

const systemPrompt = `
Tu es un expert en design UX/UI et en pédagogie.

OBJECTIF :
Évaluer le niveau global d’un apprenant en conception centrée utilisateur
et lui recommander des ressources adaptées à son niveau.

CONDUITE À TENIR :
- Pose 5 questions simples (1 par 1), ouvertes, progressives.
- N’évalue pas à chaque réponse.
- À la 6e interaction (après les 5 réponses), fais une synthèse complète.

AU MOMENT DE LA SYNTHÈSE (après les 5 réponses) :
Rédige une synthèse claire sous le format suivant :

Niveau global : <Débutant / Intermédiaire / Avancé>

Points forts :
- ...

Points à améliorer :
- ...

Playlist recommandée (10 vidéos YouTube en français) :
1. "<Titre>" – <URL>
...
10. "<Titre>" – <URL>

IMPORTANT :
- Donne seulement des vidéos pertinentes en français ou sous-titrées en français.
- Ne redis pas les réponses de l’utilisateur.
- Structure bien la réponse avec des retours à la ligne clairs.

DÉBUT DE LA CONVERSATION :
Pose cette première question : "Pour commencer, peux-tu expliquer ce que signifie pour toi l’expérience utilisateur (UX) ?"
`;

function extractYouTubeList(text) {
  const lines = text.split('\n');
  return lines
    .filter(line => line.includes('youtube.com') || line.includes('youtu.be'))
    .map(line => line.trim());
}

app.post('/message', async (req, res) => {
  const { history } = req.body;

  try {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mistral-large-latest',
        messages: [
          { role: 'system', content: systemPrompt },
          ...history
        ]
      })
    });

    const data = await response.json();
    const answer = data.choices[0].message.content;

    res.json({
      reply: answer,
      summary: {
        niveau: /Niveau global\s*:\s*(.*)/i.exec(answer)?.[1] || '',
        forces: /Points forts\s*:\s*([\s\S]*?)\n\s*Points/i.exec(answer)?.[1]?.trim() || '',
        faiblesses: /Points à améliorer\s*:\s*([\s\S]*?)\n\s*Playlist/i.exec(answer)?.[1]?.trim() || '',
        videos: extractYouTubeList(answer),
        complet: answer
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur ou IA inaccessible.' });
  }
});

app.post('/send-summary', async (req, res) => {
  const { email, summary } = req.body;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const mailOptions = {
    from: 'IA UX <' + process.env.SMTP_USER + '>',
    to: email,
    subject: `Synthèse UX/UI – Niveau ${summary.niveau}`,
    text: `Bonjour,

Voici votre synthèse personnalisée suite à votre évaluation UX/UI :

Niveau global : ${summary.niveau}

Points forts :
${summary.forces}

Points à améliorer :
${summary.faiblesses}

Playlist recommandée :
${summary.videos.join('\n')}

Bonne progression !`
  };

  try {
    await transporter.sendMail(mailOptions);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur envoi email' });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
