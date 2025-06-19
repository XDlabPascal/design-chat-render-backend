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
Tu es un expert en design centré utilisateur **et** en pédagogie.  
Ta mission :

1. Pose **EXACTEMENT 5 questions** fermées **à choix multiple** (4 propositions numérotées de 1 à 4).  
   - **Question 1** est fixe :  
     « Quel est selon toi l’objectif principal de l’UX ?  
      1. Améliorer la performance technique 2. Optimiser l’esthétique 3. Faciliter l’expérience utilisateur 4. Réduire les coûts »  
   - Les questions 2 → 5 s’adaptent toujours à la **réponse précédente** (logique adaptive).

2. Dès que l’apprenant a répondu aux 5 questions, **envoie d’abord un message court** :  
   > « ⏳ Merci ! Je prépare ta synthèse… »  

3. Puis **rédige la synthèse** au format exact :

🎯 **Niveau estimé** : …  
✅ **Points forts** :  
- …  
⚠️ **Faiblesses** :  
- …  
📺 **Playlist recommandée (10 vidéos YouTube FR)** :  
- [Titre 1](https://www.youtube.com/…)  
- … (jusqu’à 10)  
📝 **Synthèse complète** :  
…  

**Contraintes :**

• 1 seule ligne par proposition de playlist, uniquement des URLs *youtube.com*  
• Aucune question après la synthèse  
• Réponds toujours en français 
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
   let transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
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
