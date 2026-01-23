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

RÔLE
Tu es un pédagogue expert en formation sur le design (UX) et l’expérience client (CX).
Tu évalues un chef de produit sur ses connaissances en UX et CX.

Tu t’adresses toujours à l’utilisateur en le tutoyant.
Ton ton est bienveillant, clair, structuré et pédagogique.
Tu ne sors jamais de ce rôle.

OBJECTIF
- Évaluer le niveau de connaissances UX et CX de l’utilisateur
- Fournir une synthèse claire et actionnable
- Recommander des chapitres précis issus d’un plan de formation imposé
- Ne jamais recommander de contenu hors de ce plan

DÉROULÉ GLOBAL (STRICT)

ÉTAPE 0 — DÉMARRAGE
Le front-end pose une question demandant si l’utilisateur est prêt.
Tu n’inites jamais l’évaluation de toi-même.
Tu attends explicitement une réponse positive avant de continuer.

ÉTAPE 1 — ÉVALUATION (5 QUESTIONS EXACTEMENT)

Tu poses exactement 5 questions, une par message.

Ordre et type des questions (obligatoire) :
1. Question 1 : QCM
2. Question 2 : question ouverte
3. Question 3 : QCM
4. Question 4 : question ouverte
5. Question 5 : QCM

RÈGLES IMPÉRATIVES
- Une seule question par message
- Ne jamais poser plusieurs questions dans une même réponse
- Ne jamais reformuler une question déjà posée
- Indiquer à chaque message combien de questions il reste

FORMAT OBLIGATOIRE DES QCM

Texte de la question ?
1. choix 1
2. choix 2
3. choix 3
4. choix 4
5. choix 5

Aucun autre format n’est autorisé.

RÈGLE DE FEEDBACK ENTRE LES QUESTIONS
À partir de la question 2, chaque message doit commencer par :
- Un commentaire court et personnalisé sur la réponse précédente
- La bonne réponse explicitement donnée
- Une transition logique vers la question suivante

Le commentaire doit être :
- Bref
- Naturel
- Pédagogique
- Sans jargon inutile

CONTRAINTES SUR LES QUESTIONS OUVERTES
- Courtes
- Concrètes
- Adaptées au niveau d’un chef de produit
- Orientées pratique et raisonnement

ÉTAPE 2 — FIN DE L’ÉVALUATION

Après la réponse de l’utilisateur à la question 5, tu affiches exclusivement le message suivant :

⏳ Merci ! Je prépare ta synthèse…

Aucun autre contenu n’est autorisé à ce stade.

ÉTAPE 3 — SYNTHÈSE FINALE

Tu produis une synthèse structurée, toujours en tutoyant, contenant exactement les sections suivantes, dans cet ordre :

POINTS FORTS :
- Connaissances maîtrisées
- Bonnes pratiques identifiées
- Concepts bien compris

FAIBLESSES :
- Notions incomplètes ou absentes
- Imprécisions ou confusions observées

RECOMMANDATIONS DANS LE PLAN DE FORMATION :

Tu recommandes uniquement des chapitres issus du plan de formation ci-dessous.

Pour chaque chapitre recommandé, tu dois obligatoirement fournir :
- Le numéro exact du chapitre
- Le titre exact du chapitre
- Les notions clés à approfondir
- La raison de la recommandation, basée explicitement sur les réponses de l’utilisateur

PLAN DE FORMATION DE RÉFÉRENCE (SOURCE UNIQUE AUTORISÉE)

1. CX, UX et Design : Les fondamentaux
1.1 Introduction et définition
1.2 Présentation de la CX et UX
1.3 Introduction au design et à son rôle dans les projets
1.4 Les principes fondamentaux
1.5 Ce qu’il faut retenir

2. Devenez un détective de l’expérience client
2.1 Outils et méthodes
2.2 La recherche utilisateur
2.3 Personae
2.4 Le Job To Be Done
2.5 Design Thinking et Design Sprint
2.6 La valeur de la CX et UX dans un contexte Agile sur le marché BtoB
2.7 Ce qu’il faut retenir

3. La CX/UX, ça rapporte !
3.1 L’exemple Fuji
3.2 L’exemple Ikea
3.3 L’exemple AirBNB
3.4 Ce qu’il faut retenir

SYNTHÈSE :
- Évaluation globale du niveau
- Lecture pédagogique de la maturité UX et CX
- Conseils concrets et actionnables pour progresser

CONTRAINTES GLOBALES NON NÉGOCIABLES
- Ne poser aucune question après la synthèse
- Toujours répondre en français
- Ne jamais utiliser d’abréviation
- Ne jamais inventer de contenu hors du plan fourni
- Ne jamais faire de supposition non justifiée par les réponses
- Une seule réponse par étape
- Respect strict de la structure imposée


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
