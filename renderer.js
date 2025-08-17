// const chatBox = document.getElementById("questionBox");
// const outputDiv = document.getElementById("output");

// // 1. Textbox input
// chatBox.addEventListener("keydown", async (e) => {
//   if (e.key === "Enter") {
//     const q = chatBox.value.trim();
//     if (!q) return;

//     outputDiv.innerHTML += `<div><b>You:</b> ${q}</div>`;
//     const ans = await window.electronAPI.askAI(q);
//     outputDiv.innerHTML += `<div><b>AI:</b> ${ans}</div>`;
//     chatBox.value = "";
//   }
// });

// // 2. Shortcut: listen
// window.electronAPI.ipc.on("shortcut-listen", async () => {
//   const q = "Pretend this is live speech transcript"; // STT later
//   const ans = await window.electronAPI.askAI(q);
//   outputDiv.innerHTML += `<div><b>AI (listening):</b> ${ans}</div>`;
// });

// // 3. Shortcut: screenshot -> OCR -> AI
// window.electronAPI.ipc.on("shortcut-screenshot", async () => {
//   const sources = await window.electronAPI.capture.getSources({
//     types: ["screen"],
//   });
//   const screenshot = sources[0].thumbnail.toPNG();

//   const text = await window.electronAPI.ocr(screenshot);
//   const ans = await window.electronAPI.askAI(
//     `Answer based on this text: ${text}`
//   );

//   outputDiv.innerHTML += `<div><b>AI (screenshot):</b> ${ans}</div>`;
// });

const chatBox = document.getElementById("questionBox");
const outputDiv = document.getElementById("output");

chatBox.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    const q = chatBox.value.trim();
    if (!q) return;

    outputDiv.innerHTML += `<div><b>You:</b> ${q}</div>`;
    const ans = await window.electronAPI.askAI(q);
    outputDiv.innerHTML += `<div><b>AI:</b> ${ans}</div>`;
    chatBox.value = "";
  }
});

// Example OCR trigger (you can call this from shortcut later)
window.electronAPI.ipc.on("shortcut-screenshot", async () => {
  const sources = await window.electronAPI.capture.getSources({
    types: ["screen"],
  });
  const screenshot = sources[0].thumbnail.toPNG();
  const text = await window.electronAPI.runOCR(screenshot);

  const ans = await window.electronAPI.askAI(
    `Answer based on this text: ${text}`
  );
  outputDiv.innerHTML += `<div><b>AI (OCR):</b> ${ans}</div>`;
});
