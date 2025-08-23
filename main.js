require("dotenv").config();
const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  desktopCapturer,
  clipboard,
  Notification, // ✅ Fix: import Notification
  screen,
} = require("electron");
const OpenAI = require("openai");
const Tesseract = require("tesseract.js");
const record = require("node-record-lpcm16").record;
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const overlay = require("./build/Release/overlay.node");
const screenshot = require("screenshot-desktop"); // ✅ Fix: import screenshot
const envPath = path.join(process.resourcesPath, ".env");
dotenv.config({ path: envPath });
let cornerIndex = 0;
let darkMode = false;

app.whenReady().then(() => {
  // Hide dock/taskbar
  if (process.platform === "darwin") {
    app.dock.hide();
  }

  // Register all global shortcuts
  registerShortcuts();

  // Prevent quitting when no BrowserWindow (keep overlay alive)
  app.on("window-all-closed", (e) => {
    e.preventDefault();
  });
});

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
});

// Overlay integration
overlay.startOverlay(async (question) => {
  try {
    const response = await openai.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: question }],
    });
    overlay.showAnswer(response.choices[0].message.content.trim());
  } catch (err) {
    overlay.showAnswer("Error: " + (err?.message || "unknown"));
  }
});

function registerShortcuts() {
  // Ctrl+Enter → move overlay to next corner
  globalShortcut.register("Control+Enter", () => {
    const bounds = screen.getPrimaryDisplay().bounds;
    cornerIndex = (cornerIndex + 1) % 4;
    let x = 0,
      y = 0;

    switch (cornerIndex) {
      case 0:
        x = 0;
        y = 0;
        break;
      case 1:
        x = bounds.width - 700;
        y = 0;
        break;
      case 2:
        x = 0;
        y = bounds.height - 120;
        break;
      case 3:
        x = bounds.width - 700;
        y = bounds.height - 120;
        break;
    }
    overlay.moveWindow(x, y);
  });

  // Ctrl+D → toggle theme
  globalShortcut.register("Control+D", () => {
    darkMode = !darkMode;
    overlay.toggleTheme(darkMode);
  });

  // Ctrl+L → Real mic STT → AI
  globalShortcut.register("Control+L", async () => {
    console.log("🎤 Recording from mic...");

    const tmpFile = path.join(app.getPath("temp"), "speech.wav");
    const fileStream = fs.createWriteStream(tmpFile, { encoding: "binary" });

    const rec = record({
      sampleRateHertz: 16000,
      threshold: 0,
      verbose: false,
      recordProgram: "sox", // or 'rec' / 'arecord'
      silence: "1.0",
    });

    rec.pipe(fileStream);

    // Stop after 5 sec
    setTimeout(async () => {
      rec.stop();

      console.log("🎤 Recording finished. Sending to Whisper...");
      try {
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(tmpFile),
          model: "gpt-4o-mini-transcribe", // or whisper-1
        });

        const text = transcription.text.trim();
        console.log("📝 Transcript:", text);

        // Send to LLM
        const response = await openai.chat.completions.create({
          model: "llama-3.1-8b-instant",
          messages: [{ role: "user", content: text }],
        });

        overlay.showAnswer(response.choices[0].message.content.trim());
      } catch (err) {
        console.error("STT Error:", err);
        overlay.showAnswer("STT Error: " + err.message);
      }
    }, 5000);
  });

  // Ctrl+I → screenshot + OCR + AI
  globalShortcut.register("CommandOrControl+I", async () => {
    try {
      const imgPath = path.join(app.getPath("temp"), "screenshot.png");

      // 1. Capture full screen
      await screenshot({ filename: imgPath });

      // 2. Run OCR with Tesseract
      const {
        data: { text: ocrText },
      } = await Tesseract.recognize(imgPath, "eng");

      const extracted = ocrText.replace(/\s+/g, " ").trim();

      if (!extracted) {
        new Notification({
          title: "Stealth Assistant",
          body: "⚠️ No text found on screen",
        }).show();
        return;
      }

      // 3. Send extracted text to LLM
      const client = new OpenAI({ apiKey: process.env.GROQ_API_KEY });
      const response = await openai.chat.completions.create({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: extracted }],
      });

      const answer = response.choices[0].message.content.trim();

      // 4. Copy result to clipboard + notify
      clipboard.writeText(answer);
      new Notification({
        title: "Stealth Assistant",
        body: "✅ OCR + LLM response copied!",
      }).show();

      // (Optional) also show inside overlay
      overlay.showAnswer(answer);
    } catch (err) {
      console.error("Ctrl+I Error:", err);
      new Notification({
        title: "Stealth Assistant",
        body: "❌ Failed (check console)",
      }).show();
    }
  });
}
