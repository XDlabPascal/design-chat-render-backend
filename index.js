import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.post("/message", async (req, res) => {
  const { message, email } = req.body;

  if (!message || !email) {
    return res.status(400).json({ error: "Message et email requis" });
  }

  try {
    const mistralResponse = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "mistral-tiny",
        messages: [
          { role: "system", content: "Tu es un expert en design. Pose des questions à l'utilisateur pour évaluer ses connaissances." },
          { role: "user", content: message }
        ]
      })
    });

    const data = await mistralResponse.json();
    const reply = data.choices?.[0]?.message?.content || "Je n’ai pas pu générer de réponse.";

    // --- À partir de la ligne où commence emailBody ---
const emailBody = `
Voici la synthèse de votre échange avec l'IA :

Question : ${message}
Réponse : ${reply}

👉 Voici quelques vidéos recommandées pour progresser :
- https://vimeo.com/123456
- https://vimeo.com/234567
- https://vimeo.com/345678
`;

    await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }], subject: "Votre synthèse IA de compétences en design" }],
        from: { email: "chat@tondomaine.com", name: "Design Chat AI" },
        content: [{ type: "text/plain", value: emailBody }]
      })
    });

    res.json({ success: true, reply });
  } catch (error) {
    console.error("Erreur:", error);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

app.get("/", (req, res) => {
  res.send("API Design Chat prête ✅");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(\`Serveur lancé sur http://localhost:\${PORT}\`);
});
