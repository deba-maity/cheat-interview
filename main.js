// require("dotenv").config();
// const { app, BrowserWindow, ipcMain } = require("electron");
// const OpenAI = require("openai");
// const path = require("path");
// const overlay = require("./build/Release/overlay.node");

// let mainWindow;

// app.whenReady().then(() => {
//   mainWindow = new BrowserWindow({
//     width: 800,
//     height: 600,
//     webPreferences: {
//       preload: path.join(__dirname, "preload.js"),
//       nodeIntegration: false, // keep secure
//       contextIsolation: true, // required for preload
//     },
//   });

//   mainWindow.loadFile("index.html");
//   mainWindow.webContents.openDevTools(); // auto open console
// });

// // API key check
// // if (!process.env.OPENROUTER_API_KEY) {
// //   console.error("❌ OPENROUTER_API_KEY missing in .env");
// //   process.exit(1);
// // }

// // OpenAI client
// const openai = new OpenAI({
//   apiKey: process.env.GROQ_API_KEY,
//   baseURL: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
// });

// // Handle IPC from renderer
// ipcMain.handle("ask-ai", async (event, question) => {
//   console.log("👤 User:", question);
//   try {
//     const response = await openai.chat.completions.create({
//       model: "llama-3.1-8b-instant",
//       messages: [{ role: "user", content: question }],
//     });

//     const answer = response.choices[0].message.content.trim();
//     console.log("🤖 AI:", answer);
//     return answer;
//   } catch (err) {
//     console.error("AI Error:", err);
//     return "Error: " + err.message;
//   }
// });

// console.log("🚀 Stealth overlay starting… (Press Enter in the overlay box)");

// // Start overlay (C++ will call this callback when Enter is pressed)
// overlay.startOverlay(async (question) => {
//   try {
//     console.log("👤 User:", question);

//     const response = await openai.chat.completions.create({
//       model: "gpt-4o-mini",
//       messages: [{ role: "user", content: question }],
//     });

//     const answer =
//       response?.choices?.[0]?.message?.content?.trim() || "No response";

//     console.log("🤖 AI:", answer);
//     overlay.showAnswer(answer);
//   } catch (err) {
//     console.error("LLM error:", err?.message || err);
//     overlay.showAnswer("Error: " + (err?.message || "unknown"));
//   }
// });

require("dotenv").config();
const { app, BrowserWindow, ipcMain } = require("electron");
const OpenAI = require("openai");
const Tesseract = require("tesseract.js");
const path = require("path");
const overlay = require("./build/Release/overlay.node"); // your C++ overlay

let mainWindow;

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile("index.html");
  mainWindow.webContents.openDevTools();
});

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
});

// Handle AI queries
ipcMain.handle("ask-ai", async (event, question) => {
  console.log("👤 User:", question);
  try {
    const response = await openai.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: question }],
    });

    const answer = response.choices[0].message.content.trim();
    console.log("🤖 AI:", answer);
    return answer;
  } catch (err) {
    console.error("AI Error:", err);
    return "Error: " + err.message;
  }
});

// Handle OCR
ipcMain.handle("run-ocr", async (event, imageBuffer) => {
  try {
    const { data } = await Tesseract.recognize(imageBuffer, "eng");
    return data.text.trim();
  } catch (err) {
    console.error("OCR Error:", err);
    return "";
  }
});

// Overlay integration (C++ overlay triggers AI)
overlay.startOverlay(async (question) => {
  try {
    console.log("👤 Overlay User:", question);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: question }],
    });

    const answer =
      response?.choices?.[0]?.message?.content?.trim() || "No response";
    console.log("🤖 AI (Overlay):", answer);

    overlay.showAnswer(answer);
  } catch (err) {
    console.error("Overlay LLM error:", err?.message || err);
    overlay.showAnswer("Error: " + (err?.message || "unknown"));
  }
});
