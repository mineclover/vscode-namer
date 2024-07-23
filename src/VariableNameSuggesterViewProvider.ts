import * as vscode from "vscode";
import axios from "axios";

export class VariableNameSuggesterViewProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "variableNameSuggesterSidebar";

  private _view?: vscode.WebviewView;
  private _outputChannel: vscode.OutputChannel;

  private readonly SYSTEM_PROMPT =
    "You are a helpful assistant that suggests variable names. Provide your suggestions as a valid JSON array of strings, without any markdown formatting or code blocks.";

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._outputChannel = vscode.window.createOutputChannel(
      "Variable Name Suggester"
    );
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "suggest":
          await this.getSuggestions(
            data.value,
            data.style,
            data.concept,
            parseInt(data.count)
          );
          break;
        case "copy":
          vscode.env.clipboard.writeText(data.value);
          vscode.window.showInformationMessage(`Copied: ${data.value}`);
          break;
        case "copyPrompt":
          vscode.env.clipboard.writeText(data.value);
          vscode.window.showInformationMessage("Prompt copied to clipboard");
          break;
        case "openLink":
          vscode.env.openExternal(vscode.Uri.parse(data.url));
          break;
        case "info":
          vscode.window.showInformationMessage(data.value);
          break;
      }
    });
  }

  private generateUserPrompt(
    text: string,
    style: string,
    concept: string,
    count: number
  ): string {
    return `Suggest ${count} variable names for: ${text}. 
Use the ${style} naming style and the ${concept} concept.
Respond with a valid JSON array of strings containing only the variable names, without any additional formatting or explanation.`;
  }

  private async getSuggestions(
    text: string,
    style: string,
    concept: string,
    count: number
  ) {
    const { apiKey } = await this.getConfig();
    if (!apiKey) {
      vscode.window.showErrorMessage(
        "API key is not set. Please set it in the settings."
      );
      return;
    }

    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
      try {
        const USER_PROMPT = this.generateUserPrompt(
          text,
          style,
          concept,
          count
        );

        const requestBody = {
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: this.SYSTEM_PROMPT },
            { role: "user", content: USER_PROMPT },
          ],
          max_tokens: 200,
        };

        this._outputChannel.appendLine("Full API Request:");
        this._outputChannel.appendLine(JSON.stringify(requestBody, null, 2));
        this._outputChannel.appendLine("---");

        const response = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          requestBody,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
          }
        );

        this._outputChannel.appendLine("Full API Response:");
        this._outputChannel.appendLine(JSON.stringify(response.data, null, 2));
        this._outputChannel.appendLine("---");

        if (
          response.data &&
          response.data.choices &&
          response.data.choices.length > 0
        ) {
          const content = response.data.choices[0].message.content.trim();

          let suggestions: string[];
          try {
            suggestions = JSON.parse(content);
          } catch (parseError) {
            // If JSON parsing fails, try to extract array from the content
            const match = content.match(/\[.*\]/s);
            if (match) {
              suggestions = JSON.parse(match[0]);
            } else {
              throw new Error(
                `Failed to parse response as JSON: ${parseError}`
              );
            }
          }

          if (
            Array.isArray(suggestions) &&
            suggestions.every((item) => typeof item === "string")
          ) {
            suggestions = suggestions.slice(0, count);
            this._view?.webview.postMessage({
              type: "suggestions",
              value: suggestions,
              userPrompt: USER_PROMPT,
            });

            this._outputChannel.appendLine(`Input: ${text}`);
            this._outputChannel.appendLine(`Style: ${style}`);
            this._outputChannel.appendLine(`Concept: ${concept}`);
            this._outputChannel.appendLine(`Count: ${count}`);
            this._outputChannel.appendLine(`Suggestions:`);
            suggestions.forEach((suggestion, index) => {
              this._outputChannel.appendLine(`${index + 1}. ${suggestion}`);
            });
            this._outputChannel.appendLine("---");
            this._outputChannel.show();

            return;
          } else {
            throw new Error("Invalid response format: not an array of strings");
          }
        } else {
          throw new Error("Invalid API response format");
        }
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 429) {
          const waitTime = this.extractRetryAfterTime(
            error.response.headers["retry-after"]
          );
          this._outputChannel.appendLine(
            `Rate limited. Waiting for ${waitTime} seconds before retry.`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
          retries++;
        } else {
          this.handleError(error);
          return;
        }
      }
    }

    vscode.window.showErrorMessage(
      "Max retries reached. Failed to get suggestions."
    );
  }

  private async getConfig(): Promise<{ apiKey: string | undefined }> {
    const config = vscode.workspace.getConfiguration("vscode-namer");
    let apiKey = config.get<string>("apiKey");

    if (!apiKey) {
      apiKey = await vscode.window.showInputBox({
        prompt: "Enter your OpenAI API Key",
        password: true,
      });

      if (apiKey) {
        await config.update(
          "apiKey",
          apiKey,
          vscode.ConfigurationTarget.Global
        );
      }
    }

    return { apiKey };
  }

  private extractRetryAfterTime(retryAfter: string | undefined): number {
    if (!retryAfter) return 5;
    const parsedTime = parseInt(retryAfter, 10);
    return isNaN(parsedTime) ? 5 : parsedTime;
  }

  private handleError(error: unknown) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(`Error: ${error.message}`);
      this._outputChannel.appendLine(`Error: ${error.message}`);
    } else {
      vscode.window.showErrorMessage(`An unexpected error occurred`);
      this._outputChannel.appendLine(`An unexpected error occurred`);
    }
    this._outputChannel.show();
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "main.js")
    );
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "styles.css")
    );

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${stylesUri}" rel="stylesheet">
            <title>Variable Name Suggester</title>
        </head>
        <body>
            <div class="container">
                <select id="namingStyle">
                    <option value="camelCase">camelCase</option>
                    <option value="PascalCase">PascalCase</option>
                    <option value="snake_case">snake_case</option>
                    <option value="kebab-case">kebab-case</option>
                </select>
                <select id="namingConcept">
                    <option value="default">Default</option>
                    <option value="hipster">Hipster</option>
                    <option value="expert">Expert Developer</option>
                    <option value="academic">Academic</option>
                    <option value="abstract">Abstract</option>
                    <option value="semantic">Semantic</option>
                </select>
                <input type="number" id="suggestionCount" min="1" max="20" value="5" placeholder="Number of suggestions">
                <input id="input" type="text" placeholder="Enter description for variable">
                <button id="suggest">Suggest Names</button>
                <div id="suggestions"></div>
                
                <div class="ai-buttons">
                    <button id="geminiBtn">Gemini</button>
                    <button id="gptBtn">GPT</button>
                    <button id="claudeBtn">Claude</button>
                </div>
                <textarea id="explanationPrompt" readonly></textarea>
                <button id="copyPrompt">Copy Explanation Prompt</button>
            </div>
            <script src="${scriptUri}"></script>
        </body>
        </html>`;
  }
}
