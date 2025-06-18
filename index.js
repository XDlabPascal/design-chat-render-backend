// index.js ─────────────────────────────────────────────────────
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const app  = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(bodyParser.json());

let finalSummary = null;        // mémorise la synthèse finale

/* ───────────────── SYSTEM PROMPT MISTRAL ───────────────────── */
const SYSTEM_PROMPT = `
Tu es un expert en design UX/UI.
Ta mission :
1.  Pose EXACTEMENT 5 questions simples pour évaluer le niveau de l'apprenant.
    * La 1ᵉʳᵉ question est fixe.
    * Chaque question suivante doit tenir compte de la réponse précédente.
2.  Quand tu as déjà posé 5 questions ET reçu 5 réponses,
    rédige une synthèse structurée :

🎯 Niveau estimé :
✅ Points forts :
⚠️ Faiblesses :
📺 Playlist recommandée (10 vidéos YouTube en français) :
- [Titre](https://...)
📝 Synthèse :

• Ne pose plus de questions après la synthèse.
• Réponds toujours en français.
`;

/* ───────────────────── /message ─────────────────────────────── */
app.post('/message', async (req, res) => {
  const { history } = req.body;
  if (!history || !Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'history manquant ou vide' });
  }

  // Compte le nombre de réponses utilisateur déjà données
  const userCount = history.filter(m => m.role === 'user').length;
  const done      = userCount >= 5;

  // Construit le payload pour Mistral
  const payload = {
    model: 'mistral-small-latest',
    temperature: 0.7,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history
    ]
  };

  try {
    const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method : 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
        'Content-Type' : 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error('Mistral ERROR', resp.status, txt);
      return res.status(500).json({ error: 'Erreur Mistral ' + resp.status });
    }

    const data     = await resp.json();
    const botReply = data.choices[0].message.content;

    // Si c'est la synthèse, mémorise-la
    if (done) finalSummary = botReply;

    res.json({ reply: botReply, done });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur / fetch' });
  }
});

/* ───────────────────── /summary ─────────────────────────────── */
app.get('/summary', (_, res) => {
  if (finalSummary) return res.json({ summary: finalSummary });
  res.status(404).json({ error: 'Synthèse non disponible' });
});

/* ──────────────────── /send-email ───────────────────────────── */
app.post('/send-email', async (req, res) => {
  const { email } = req.body;
  if (!email || !finalSummary) {
    return res.status(400).json({ error: 'Email ou synthèse absente' });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,   // adresse Gmail
        pass: process.env.EMAIL_PASS    // mot de passe d’application
      }
    });

    await transporter.sendMail({
      from   : process.env.EMAIL_USER,
      to     : email,
      subject: 'Votre synthèse UX/UI',
      text   : finalSummary
    });

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Envoi email échoué' });
  }
});

/* ───────────────────── endpoint racine ──────────────────────── */
app.get('/', (_, res) => {
  res.send('✅ Backend Design-Chat opérationnel');
});

app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
