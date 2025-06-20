// index.js ─────────────────────────────────────────────────────
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

let finalSummary = null; // mémorise la synthèse finale

/* ───────────────── SYSTEM PROMPT MISTRAL ───────────────────── */
const SYSTEM_PROMPT = `
Tu es un expert en design et pédagogie. Tu vas évaluer un epic owner d'un train SAFE sur ses connaissances en design centré utilisateur.

Le test commence immédiatement, sans message d’introduction, car celui-ci est affiché dans l’interface du site.

Ta mission :

1. Pose exactement 5 questions pour évaluer son niveau.
   • La 1ʳᵉ question est générée librement (ouverte ou QCM), en fonction d’une entrée en matière pédagogique.  
   • Pour les 4 questions suivantes, alterne comme suit :
     - Question 2 : ouverte  
     - Question 3 : QCM  
     - Question 4 : ouverte  
     - Question 5 : QCM

2. À partir de la 2ᵉ question, rebondis **brièvement** sur la réponse précédente avec un commentaire bienveillant. Puis enchaîne avec la nouvelle question.

3. Chaque question doit être posée dans un **seul message** :
   • Soit **QCM** (question + options sans retour à la ligne entre les deux).  
   • Soit **ouverte** (courte et concrète).  
   • Ne jamais poser plusieurs questions en une seule fois.

4. Une fois les 5 réponses données, affiche simplement :
   ⏳ Merci ! Je prépare ta synthèse…

5. Ensuite, rédige une synthèse structurée comprenant :

🔎 **Niveau estimé** :  
✅ **Points forts** :  
⚠️ **Axes d’amélioration** :  
📺 **Playlist recommandée** (10 vidéos YouTube en français avec titre + lien) :  
📝 **Synthèse personnalisée** :

Contraintes supplémentaires :

- Formate les QCM **sans retour à la ligne entre la question et les options**. Exemple :  
  Quel est selon toi l’objectif principal du design ? 1. Améliorer la performance technique 2. Optimiser l’esthétique 3. Faciliter l’expérience utilisateur 4. Réduire les coûts  
- Le ton doit être **tourné vers le tutoiement**.  
- Reste bienveillant, clair et synthétique.  
- Ne repose **plus aucune question** après la synthèse finale.  
- Réponds **en français** et une seule fois par étape.
`;

/* ───────────────────── /message ─────────────────────────────── */
app.post('/message', async (req, res) => {
  const { history } = req.body;
  if (!history || !Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'history manquant ou vide' });
  }

  // nombre de réponses utilisateur
  const userCount = history.filter((m) => m.role === 'user').length;
  const done      = userCount >= 5;

  const payload = {
    model: 'mistral-small-latest',
    temperature: 0.7,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
  };

  try {
    /* ---- 1er appel : question (ou ⏳) ---- */
    const resp = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method : 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error('Mistral ERROR', resp.status, txt);
      return res.status(500).json({ error: 'Erreur Mistral ' + resp.status });
    }

    const data     = await resp.json();
    const botReply = data.choices[0].message.content;

    /* ---------- gestion synthèse finale ---------- */
    if (done) {
      // Si la synthèse est déjà incluse (🎯), on la stocke directement.
      if (botReply.includes('🎯')) {
        finalSummary = botReply;
      } else {
        // Sinon, on déclenche un second appel ASYNCHRONE (non bloquant)
        (async () => {
          try {
            const shortHistory = history.slice(-12); // limite de contexte
            const synthPayload = {
              model: 'mistral-small-latest',
              temperature: 0.7,
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                ...shortHistory,
                { role: 'assistant', content: botReply }, // ⏳ Merci !
                { role: 'user', content: 'Rédige maintenant la synthèse finale.' },
              ],
            };

            const synthResp = await fetch(
              'https://api.mistral.ai/v1/chat/completions',
              {
                method : 'POST',
                headers: {
                  Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(synthPayload),
              },
            );

            if (!synthResp.ok) {
              const txt = await synthResp.text();
              console.error('Mistral synthèse ERROR', synthResp.status, txt);
              return; // on ne bloque pas la réponse client
            }

            const synthData = await synthResp.json();
            finalSummary    = synthData.choices[0].message.content;
          } catch (e) {
            console.error('Async synthèse fetch failed', e.message);
          }
        })();
      }
    }
    /* -------------------------------------------- */

    // Réponse immédiate au client
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
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Ton évaluation en design.',
      text: finalSummary,
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
