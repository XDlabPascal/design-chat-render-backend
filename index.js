// index.js ────────────────────��────────────────────────────────
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { randomBytes } from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';
const QUESTIONS_COUNT = Number(process.env.QUESTIONS_COUNT || 5);
const USE_REDIS = Boolean(process.env.REDIS_URL);

let finalSummary = null; // mémoire fallback (local only)

// Si REDIS_URL présent, on l'utilise pour stocker l'état des jobs (recommandé en prod)
let redis = null;
if (USE_REDIS) {
  try {
    const Redis = (await import('ioredis')).default; // dynamic import to avoid crash if lib missing
    redis = new Redis(process.env.REDIS_URL);
    redis.on('error', (e) => console.error('Redis error:', e));
    console.log('✅ Redis client initialisé');
  } catch (e) {
    console.error('❌ Impossible d\'initialiser Redis :', e);
    redis = null;
  }
}

app.use(cors({ origin: FRONTEND_URL === '*' ? true : FRONTEND_URL }));
app.use(bodyParser.json());

// Logging middleware simple
app.use((req, res, next) => {
  console.log(`[HTTP] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

/* ───────────────── SYSTEM PROMPT MISTRAL ───────────────────── */
const SYSTEM_PROMPT = `
Tu es un pédagogue expert en formation sur le design (UX), et sur l'expérience client (CX). Tu dois évaluer un chef de produit sur ses connaissances en design et expérience client, en le tutoyant pour rendre l'échange plus direct et engageant.

Ta mission :

1. Tout d'abord, le front end du chat va poser une 1ère question pour savoir si l’utilisateur est prêt.

1. Ensuite, pose exactement 5 questions pour évaluer son niveau:
   • Utilise un **mélange de questions ouvertes et de QCM**, dans cet ordre :
     • Question 1 = QCM  
     • Question 2 = question ouverte  
     • Question 3 = QCM  
     • Question 4 = question ouverte  
     • Question 5 = QCM
          
   • À partir de la question 1, commence **chaque message par un bref commentaire personnalisé avec donne la bonne réponse à la question précédente**, avant de poser la nouvelle question.  
     Exemple : “Ta réponse montre que tu as une bonne intuition. Voyons maintenant…”  
     Le commentaire doit être court, naturel, pertinent.

2. Pose **une seule question par message**, soit ouverte, soit QCM.  
   Ne mélange jamais plusieurs questions dans une même réponse.  

3. Après que l'utilisateur ai donné la réponse à à la question 5, affiche d’abord uniquement :
   ⏳ Merci ! Je prépare ta synthèse…

4. Ensuite, rédige une **synthèse structurée et claire**, toujours en **tutoyant**, contenant les sections suivantes :

### Points forts :  
### Faiblesses :  
### Playlist recommandée (10 vidéos YouTube en français) :  
- [Titre de la vidéo](https://...)  
### Synthèse :

Contraintes :
• Formate chaque QCM comme ceci :  
  Texte de la question ?  
  1. choix 1  
  2. choix 2  
  3. choix 3  
  4. choix 4
  5. choix 5

• Les questions ouvertes doivent être courtes, concrètes et adaptées à son niveau**.  
• Les commentaires entre questions doivent montrer une progression logique dans l’évaluation.  
• Ne pose plus aucune question après la synthèse.  
• N'utilise jamais d'abréviation. 
• Réponds toujours en français.  
• Le ton doit être tourné vers le tutoiement**.  
• Reste bienveillant, clair et synthétique.  
• Ne repose plus aucune question après la synthèse finale. 
• Réponds une seule fois à chaque étape.
• Ecris combien il reste de questions.
`;

/* ───────────────────── /message ─────────────────────────────── */
app.post('/message', async (req, res) => {
  const { history } = req.body;
  if (!history || !Array.isArray(history) || history.length === 0) {
    return res.status(400).json({ error: 'history manquant ou vide' });
  }

  // nombre de réponses utilisateur
  const userCount = history.filter((m) => m.role === 'user').length;
  // on considère la fin quand on a atteint QUESTIONS_COUNT réponses utilisateur
  const done = userCount >= QUESTIONS_COUNT;

  const payload = {
    model: 'mistral-small-latest',
    temperature: 0.7,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
  };

  try {
    // Appel à Mistral (ou autre LLM)
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
    const botReply = data.choices?.[0]?.message?.content ?? '';

    // Si on a atteint la fin (done) : générer la synthèse (async) si nécessaire
    if (done) {
      // Si la synthèse est déjà incluse dans la réponse (selon marker 🎯), on la stocke directement
      if (botReply.includes('🎯')) {
        finalSummary = botReply;
      } else {
        // On déclenche la génération en background.
        // Deux modes :
        // - Si Redis configuré : créer un jobId, stocker l'état dans Redis (processing) et générer en background.
        // - Sinon (fallback) : générer en background puis stocker dans finalSummary (mémoire).
        if (USE_REDIS && redis) {
          const jobId = randomBytes(12).toString('hex');
          await redis.set(`job:${jobId}`, JSON.stringify({ status: 'processing', summary: null }));

          (async () => {
            try {
              // limiter le contexte si nécessaire
              const shortHistory = history.slice(-12);
              const synthPayload = {
                model: 'mistral-small-latest',
                temperature: 0.7,
                messages: [
                  { role: 'system', content: SYSTEM_PROMPT },
                  ...shortHistory,
                  { role: 'assistant', content: botReply },
                  { role: 'user', content: 'Rédige maintenant la synthèse finale.' },
                ],
              };

              const synthResp = await fetch('https://api.mistral.ai/v1/chat/completions', {
                method : 'POST',
                headers: {
                  Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(synthPayload),
              });

              if (!synthResp.ok) {
                const txt = await synthResp.text();
                console.error('Mistral synthèse ERROR', synthResp.status, txt);
                await redis.set(`job:${jobId}`, JSON.stringify({ status: 'error', summary: null, error: txt }));
                return;
              }

              const synthData = await synthResp.json();
              const summaryText = synthData.choices?.[0]?.message?.content ?? null;

              if (summaryText) {
                await redis.set(`job:${jobId}`, JSON.stringify({ status: 'done', summary: summaryText }));
                // pour compatibilité locale on met aussi finalSummary (mais ATTENTION multi-instance)
                finalSummary = summaryText;
              } else {
                await redis.set(`job:${jobId}`, JSON.stringify({ status: 'error', summary: null, error: 'empty summary' }));
              }
            } catch (e) {
              console.error('Async synthèse fetch failed', e);
              await redis.set(`job:${jobId}`, JSON.stringify({ status: 'error', summary: null, error: e.message }));
            }
          })();

          // on retourne jobId pour que le front puisse le poller (optionnel)
          return res.json({ reply: botReply, done: true, jobId });
        } else {
          // fallback : génération asynchrone en mémoire (comme avant) — attention: pas fiable si plusieurs instances
          (async () => {
            try {
              const shortHistory = history.slice(-12);
              const synthPayload = {
                model: 'mistral-small-latest',
                temperature: 0.7,
                messages: [
                  { role: 'system', content: SYSTEM_PROMPT },
                  ...shortHistory,
                  { role: 'assistant', content: botReply },
                  { role: 'user', content: 'Rédige maintenant la synthèse finale.' },
                ],
              };

              const synthResp = await fetch('https://api.mistral.ai/v1/chat/completions', {
                method : 'POST',
                headers: {
                  Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(synthPayload),
              });

              if (!synthResp.ok) {
                const txt = await synthResp.text();
                console.error('Mistral synthèse ERROR', synthResp.status, txt);
                return;
              }

              const synthData = await synthResp.json();
              finalSummary = synthData.choices?.[0]?.message?.content ?? null;
            } catch (e) {
              console.error('Async synthèse fetch failed', e);
            }
          })();
        }
      }
    }

    // Réponse immédiate au client (si Redis utilisé et done true, on peut aussi renvoyer jobId plus haut)
    return res.json({ reply: botReply, done });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur / fetch' });
  }
});

/* ───────────────────── /summary ─────────────────────────────── */
// IMPORTANT: toujours renvoyer 200 avec { summary: null } quand synthèse pas prête.
// Si Redis est utilisé et qu'un jobId est fourni, on renvoie l'état du job.
app.get('/summary', async (req, res) => {
  try {
    const jobId = req.query.jobId;

    if (USE_REDIS && redis) {
      if (jobId) {
        const data = await redis.get(`job:${jobId}`);
        if (!data) {
          // job absent ou pas encore initialisé
          return res.json({ summary: null });
        }
        const parsed = JSON.parse(data);
        if (parsed.status === 'processing') return res.json({ summary: null });
        if (parsed.status === 'done') return res.json({ summary: parsed.summary });
        // status error -> renvoyer 500 avec message d'erreur
        return res.status(500).json({ error: parsed.error || 'Erreur interne job' });
      } else {
        // pas de jobId : renvoyer fallback global (compatibilité)
        return res.json({ summary: finalSummary || null });
      }
    }

    // fallback sans Redis : retour en mémoire (dev / mono-instance)
    return res.json({ summary: finalSummary || null });
  } catch (err) {
    console.error('Error in /summary:', err);
    return res.status(500).json({ error: 'internal' });
  }
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
app.get('/', (req, res) => {
  res.send('✅ Backend Design-Chat opérationnel');
});

app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT} (port ${PORT})`);
});
