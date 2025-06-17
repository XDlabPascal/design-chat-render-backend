// index.js — backend Design-Chat (option 2 : fetch natif)
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

/* ───────────────── PROMPT système ───────────────── */
const systemPrompt = `
Tu es un expert en design UX/UI et en pédagogie.

OBJECTIF
--------
Évaluer le niveau global d’un apprenant en conception centrée utilisateur,
puis lui recommander des ressources adaptées à son niveau.

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
- Donne UNIQUEMENT des liens YouTube en français (ou sous-titres FR).
- Format : « <Titre> – <URL> ».

DÉBUT DE LA CONVERSATION
------------------------
Commence immédiatement avec cette première question :
« Pour commencer, peux-tu expliquer ce que signifie pour toi l’expérience utilisateur (UX) ? »
`;

/* ───────────────── APPEL Mistral ───────────────── */
async function askMistral(history) {
  const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization : `Bearer ${process.env.MISTRAL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model   : 'mistral-medium',
      messages: history,
      temperature: 0.7
    })
  });

  if (!resp.ok) {
    throw new Error(`Mistral : ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.choices[0].message.content;
}

/* ───────────────── Utilitaires ───────────────── */
function extractYouTube(text) {
  const re = /(https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]+)/g;
  return text.match(re) || [];
}

/* ───────────────── Routes ───────────────── */
app.post('/message', async (req, res) => {
  const { messages = [], email = '' } = req.body;

  try {
    // Construit l’historique pour Mistral
    const hist = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text }))
    ];

    const answer = await askMistral(hist);

    // Nombre de réponses utilisateur déjà envoyées
    const userTurns = messages.filter(m => m.sender === 'user').length;

    if (userTurns >= 5) {
      // Synthèse + playlist
      const summary = {
        synthese: answer,
        niveau  : answer.includes('débutant') ? 'Débutant' :
                  answer.includes('intermédiaire') ? 'Intermédiaire' : 'Avancé',
        videos  : extractYouTube(answer)
      };
      return res.json({ phase: 'summary', summary });
    }

    // Sinon on continue le chat
    res.json({ phase: 'chat', reply: answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur IA' });
  }
});

app.post('/send-summary', async (req, res) => {
  const { email, summary } = req.body;
  if (!email) return res.status(400).json({ error: 'email manquant' });

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth   : { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    const html = `
      <h2>🎯 Niveau estimé : ${summary.niveau}</h2>
      <p>${summary.synthese.replace(/\n/g, '<br>')}</p>
      <h3>🎥 Playlist recommandée :</h3>
      <ul>${summary.videos.map(v => `<li><a href="${v}">${v}</a></li>`).join('')}</ul>
    `;

    await transporter.sendMail({
      from   : process.env.EMAIL_USER,
      to     : email,
      subject: 'Votre synthèse UX/UI',
      html
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Email :', err);
    res.status(500).json({ error: 'Erreur e-mail' });
  }
});

app.get('/', (_, res) => res.send('✅ API Design-Chat opérationnelle'));

app.listen(PORT, () => console.log(`✅ Serveur lancé sur port ${PORT}`));
