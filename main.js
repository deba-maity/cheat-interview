require("dotenv").config();
const OpenAI = require("openai");
const overlay = require("./build/Release/overlay.node");
console.log(
  "🚀 Stealth overlay started. Type in the overlay to ask questions."
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

overlay.startOverlay(async (question) => {
  console.log("User asked:", question);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: question }],
    });

    const answer = response.choices[0].message.content.trim();
    console.log("AI:", answer);
    overlay.showAnswer(answer);
  } catch (err) {
    overlay.showAnswer("Error: " + err.message);
  }
});
