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
        displaySuggestions(message.value);
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
})();
