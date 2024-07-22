/* eslint-disable no-undef */

// main.js
(function () {
  const vscode = acquireVsCodeApi();
  const suggestButton = document.getElementById("suggest");
  const refineButton = document.getElementById("refine");
  const input = document.getElementById("input");
  const suggestionsDiv = document.getElementById("suggestions");
  const refinedSuggestionsDiv = document.getElementById("refinedSuggestions");
  const namingStyleSelect = document.getElementById("namingStyle");

  suggestButton.addEventListener("click", () => {
    const text = input.value;
    const style = namingStyleSelect.value;
    vscode.postMessage({
      type: "suggest",
      value: text,
      style: style,
    });
  });

  refineButton.addEventListener("click", () => {
    const text = input.value;
    const style = namingStyleSelect.value;
    const selectedSuggestions = getSelectedSuggestions();
    vscode.postMessage({
      type: "refine",
      value: text,
      style: style,
      selectedSuggestions: selectedSuggestions,
    });
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
      case "suggestions":
        displaySuggestions(message.value, suggestionsDiv);
        break;
      case "refinedSuggestions":
        displaySuggestions(message.value, refinedSuggestionsDiv);
        break;
    }
  });

  function displaySuggestions(suggestions, targetDiv) {
    targetDiv.innerHTML = "";
    suggestions.forEach((suggestion, index) => {
      const div = document.createElement("div");
      div.className = "suggestion";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `suggestion-${targetDiv.id}-${index}`;
      checkbox.value = suggestion;

      const label = document.createElement("label");
      label.htmlFor = `suggestion-${targetDiv.id}-${index}`;
      label.textContent = suggestion;

      const copyButton = document.createElement("button");
      copyButton.textContent = "Copy";
      copyButton.addEventListener("click", () => {
        vscode.postMessage({
          type: "copy",
          value: suggestion,
        });
      });

      div.appendChild(checkbox);
      div.appendChild(label);
      div.appendChild(copyButton);
      targetDiv.appendChild(div);
    });
  }

  function getSelectedSuggestions() {
    const allCheckboxes = document.querySelectorAll(
      'input[type="checkbox"]:checked'
    );
    return Array.from(allCheckboxes).map((checkbox) => checkbox.value);
  }
})();
