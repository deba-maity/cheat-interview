console.log("script loaded");
const questionBox = document.getElementById("questionBox");
const outputDiv = document.getElementById("output");
console.log("Key pressed:", e.key, "Value:", e.target.value);

questionBox.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    const q = questionBox.value.trim();
    if (!q) return;
    outputDiv.textContent = "Thinking...";
    const answer = await window.electronAPI.sendQuestion(q);
    outputDiv.textContent = answer || "No response";
    questionBox.value = "";
  }
});

// Listen for answers from main
window.addEventListener("ai-answer", (e) => {
  outputDiv.textContent = e.detail;
});
