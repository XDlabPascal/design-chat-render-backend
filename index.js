import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(bodyParser.json());

// Fonction pour interroger Mistral (via ton proxy ou API personnelle)
async function askMistral(messages) {
  const prompt = `
Tu es un expert en design UX/UI. Tu vas poser 5 questions simples à un apprenant pour évaluer son niveau en conception centrée utilisateur.
Ensuite, tu résumeras le niveau global, rédigeras une synthèse de ses réponses, et proposeras une playlist de 10 vidéos YouTube en français adaptées à son niveau.

Conversation actuelle :
${messages.map(m => `${m.sender === 'user' ? 'Utilisateur' : 'IA'} : ${m.text}`).join('\n')}
`;

  const response = await fetch(process.env.MISTRAL_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "mistral-medium",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7
    })
  });

  const data = await response.json();
  const output = data.choices?.[0]?.message?.content || "Je n'ai pas pu répondre.";

  // Si on arrive à 5 réponses, basculer en mode "summary"
  const userMessages = messages.filter(m => m.sender === 'user');
  const isSummary = userMessages.length >= 5;

  if (isSummary) {
    return {
      phase: "summary",
      summary: {
        niveau: "Intermédiaire", // Optionnel : tu peux extraire cela de `output`
        synthese: output,
        videos: extractYouTubeLinks(output)
      }
    };
  }

  return {
    reply: output,
    phase: "chat"
  };
}

// Extraire les URLs YouTube depuis la réponse texte
function extractYouTubeLinks(text) {
  const urlRegex = /(https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[\w-]+)/g;
  return text.match(urlRegex) || [];
}

// Route principale de chat
app.post("/message", async (req, res) => {
  const { messages } = req.body;
  try {
    const result = await askMistral(messages);
    res.json(result);
  } catch (error) {
    console.error("Erreur Mistral:", error);
    res.status(500).json({ error: "Erreur IA" });
  }
});

// Route pour envoyer la synthèse par e-mail
app.post("/send-summary", async (req, res) => {
  const { email, summary } = req.body;

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", // Ou autre SMTP
      port: 587,
      secure: false,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
      }
    });

    const htmlBody = `
      <h2>🎓 Résultats de ton évaluation en design UX/UI</h2>
      <p><strong>Niveau estimé :</strong> ${summary.niveau}</p>
      <p><strong>Synthèse :</strong><br>${summary.synthese}</p>
      <h3>🎥 Playlist recommandée :</h3>
      <ul>
        ${summary.videos.map(link => `<li><a href="${link}">${link}</a></li>`).join("")}
      </ul>
    `;

    await transporter.sendMail({
      from: process.env.MAIL_USER,
      to: email,
      subject: "🎓 Synthèse de ton évaluation UX/UI",
      html: htmlBody
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Erreur email:", error);
    res.status(500).json({ error: "Erreur d'envoi d'email" });
  }
});

// Lancer le serveur
app.listen(PORT, () => {
  console.log(`✅ Serveur lancé sur http://localhost:${PORT}`);
});
