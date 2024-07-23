/* eslint-disable no-undef */
// main.js
(function () {
  const vscode = acquireVsCodeApi();
  const suggestButton = document.getElementById("suggest");
  const input = document.getElementById("input");
  const suggestionsDiv = document.getElementById("suggestions");
  const namingStyleSelect = document.getElementById("namingStyle");
  const namingConceptSelect = document.getElementById("namingConcept");
  const suggestionCountInput = document.getElementById("suggestionCount");
  const geminiBtn = document.getElementById("geminiBtn");
  const gptBtn = document.getElementById("gptBtn");
  const claudeBtn = document.getElementById("claudeBtn");
  const explanationPrompt = document.getElementById("explanationPrompt");
  const copyPromptBtn = document.getElementById("copyPrompt");

  let lastUserPrompt = "";
  let lastSuggestions = [];

  suggestButton.addEventListener("click", () => {
    const text = input.value;
    const style = namingStyleSelect.value;
    const concept = namingConceptSelect.value;
    const count = suggestionCountInput.value;
    vscode.postMessage({
      type: "suggest",
      value: text,
      style: style,
      concept: concept,
      count: count,
    });
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "suggestions":
        lastSuggestions = message.value;
        displaySuggestions(lastSuggestions);
        lastUserPrompt = message.userPrompt;
        updateExplanationPrompt();
        break;
    }
  });

  function displaySuggestions(suggestions) {
    suggestionsDiv.innerHTML = "";
    suggestions.forEach((suggestion) => {
      const div = document.createElement("div");
      div.className = "suggestion";
      div.textContent = suggestion;

      const copyButton = document.createElement("button");
      copyButton.textContent = "Copy";
      copyButton.addEventListener("click", () => {
        vscode.postMessage({
          type: "copy",
          value: suggestion,
        });
      });

      div.appendChild(copyButton);
      suggestionsDiv.appendChild(div);
    });
  }

  function updateExplanationPrompt() {
    const promptTemplate = `
\`\`\`
Current input prompt:
{현재 입력 프롬프트}

Answer:
{답변}
\`\`\`

The variable names presented in the "Answer" section were generated based on the "Current input prompt" above. Please provide a detailed explanation for each variable name, including the following information:

1. The meaning of the variable name
2. The definition of each word used in the variable name
3. The pronunciation of the variable name (based on English pronunciation)
4. An explanation of how the variable name relates to the given prompt

Please provide a detailed explanation for each variable name individually.
한국어로`;

    const suggestionsString = lastSuggestions
      .map((s, i) => `${i + 1}. ${s}`)
      .join("\n");
    explanationPrompt.value = promptTemplate
      .replace("{현재 입력 프롬프트}", lastUserPrompt)
      .replace("{답변}", suggestionsString);
  }

  copyPromptBtn.addEventListener("click", () => {
    vscode.postMessage({
      type: "copyPrompt",
      value: explanationPrompt.value,
    });
  });

  geminiBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "openLink", url: "https://gemini.google.com/" });
  });

  gptBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "openLink", url: "https://chat.openai.com/" });
  });

  claudeBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "openLink", url: "https://claude.ai/" });
  });

  // Initialize the explanation prompt
  updateExplanationPrompt();
})();
