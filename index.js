import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import nodemailer from 'nodemailer';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(bodyParser.json());

let conversationHistory = [];
let evaluationComplete = false;
let finalSummary = null;

const initialPrompt = `
Tu es un expert en design UX/UI. Tu dois évaluer le niveau d’un apprenant qui suit un parcours de formation.
1. Pose-lui 5 questions simples pour identifier son niveau.
2. En te basant sur ses réponses, génère une synthèse pédagogique : niveau global, points forts, faiblesses.
3. Recommande-lui une playlist de 10 vidéos YouTube en français pour progresser.
À la fin, rédige une synthès structurée dans ce format :

🎯 Niveau estimé : 
✅ Points forts :
⚠️ Faiblesses :
📺 Playlist recommandée :
- [Titre](Lien)
📝 Synthèse :
`;

app.post('/message', async (req, res) => {
  const userMessage = req.body.message;
  if (!userMessage) return res.status(400).send({ error: 'Message requis' });

  conversationHistory.push({ role: 'user', content: userMessage });

const payload = {
  model: 'mistral-small-latest',   // ou medium / large -latest
  messages: [
    { role: 'system', content: initialPrompt },
    ...conversationHistory
  ],
  temperature: 0.7
};

  try {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
if (!response.ok) {
  const errorText = await response.text();
  console.error('🛑 Mistral API ERROR:', response.status, errorText);
  return res.status(500).json({ error: 'Erreur Mistral: ' + response.status });
}
    const data = await response.json();
    const botReply = data.choices[0].message.content;

    conversationHistory.push({ role: 'assistant', content: botReply });

    // Si la synthèse complète est incluse
    if (
      botReply.includes('🎯 Niveau estimé') &&
      botReply.includes('📺 Playlist recommandée') &&
      botReply.includes('📝 Synthèse')
    ) {
      evaluationComplete = true;
      finalSummary = botReply;
    }

    res.send({ reply: botReply });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: 'Erreur serveur ou IA inaccessible.' });
  }
});

app.get('/summary', (req, res) => {
  if (evaluationComplete && finalSummary) {
    res.send({ summary: finalSummary });
  } else {
    res.status(404).send({ error: 'Synthèse non disponible.' });
  }
});

app.post('/send-email', async (req, res) => {
  const { email } = req.body;
  if (!email || !finalSummary) {
    return res.status(400).send({ error: 'Email ou synthèse manquante' });
  }

  try {
    let transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Synthèse de votre évaluation UX/UI',
      text: finalSummary,
    });

    res.send({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'Erreur envoi email' });
  }
});
app.get('/', (_, res) => {
  res.send('✅ Backend Design-Chat opérationnel');
});
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
