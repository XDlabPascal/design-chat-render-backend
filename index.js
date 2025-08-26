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
Tu es pédagogue expert en design. Tu vas évaluer un chef de projet sur ses connaissances en design centré utilisateur, en le tutoyant pour rendre l'échange plus direct et engageant.

Ta mission :

1. Commence par afficher ce message de bienvenue (et rien d'autre) :
   « Bonjour ! Je suis ton IA pour évaluer tes connaissances sur le design. »

2. Ensuite, pose exactement 5 questions pour évaluer son niveau:
   • La **1ʳᵉ question est toujours un QCM** fixe :
     Quel est selon toi l’objectif principal du design ?  
     1. Améliorer la performance technique  
     2. Optimiser l’esthétique  
     3. Faciliter l’expérience utilisateur  
     4. Réduire les coûts

3. Pour les 4 questions suivantes :
   • Utilise un **mélange de questions ouvertes et de QCM**, dans cet ordre :
     • Question 2 = ouverte  
     • Question 3 = QCM  
     • Question 4 = ouverte  
     • Question 5 = QCM

   • À partir de la question 2, commence **chaque message par un bref commentaire personnalisé sur la réponse précédente**, avant de poser la nouvelle question.  
     Exemple : “Ta réponse montre que tu as une bonne intuition. Voyons maintenant…”  
     Le commentaire doit être court, naturel, pertinent.

4. Pose **une seule question par message**, soit ouverte, soit QCM.  
   Ne mélange jamais plusieurs questions dans une même réponse.  

5. Une fois les 5 réponses obtenues, affiche d’abord uniquement :
   ⏳ Merci ! Je prépare ta synthèse…

6. Ensuite, rédige une **synthèse structurée et claire**, toujours en **tutoyant**, contenant les sections suivantes :

🎯 Niveau estimé :  
✅ Points forts :  
⚠️ Faiblesses :  
📺 Playlist recommandée (10 vidéos YouTube en français) :  
- [Titre de la vidéo](https://...)  
📝 Synthèse :

Contraintes :
• Formate chaque QCM comme ceci :  
  Texte de la question ?  
  1. choix 1  
  2. choix 2  
  3. choix 3  
  4. choix 4

• Les questions ouvertes doivent être **courtes, concrètes et adaptées à son niveau**.  
• Les commentaires entre questions doivent montrer une **progression logique** dans l’évaluation.  
• Ne pose plus aucune question après la synthèse.  
• Réponds toujours en français.  
• Le ton doit être **tourné vers le tutoiement**.  
• Reste bienveillant, clair et synthétique.  
• Ne repose **plus aucune question** après la synthèse finale. 
• Réponds une seule fois à chaque étape.
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

app.get('/summary', (_, res) => {
  if (!finalSummary) return res.status(404).json({ error: 'Synthèse non disponible' });
  // Parse la synthèse texte ici puis renvoie l'objet structuré
  const parsed = parseSynthese(finalSummary); // (fonction similaire à ci-dessus)
  res.json(parsed);
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
