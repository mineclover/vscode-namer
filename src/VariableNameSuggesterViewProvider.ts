import * as vscode from "vscode";
import axios from "axios";

export class VariableNameSuggesterViewProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "variableNameSuggesterSidebar";

  private _view?: vscode.WebviewView;
  private _outputChannel: vscode.OutputChannel;

  private readonly SYSTEM_PROMPT =
    "You are a helpful assistant that suggests variable names. Provide your suggestions as a valid JSON array of strings.";
  private readonly USER_PROMPT = (count: number, text: string, style: string) =>
    `Suggest ${count} variable names for: ${text}. 
         Use the ${style} naming style.
         Respond with a valid JSON array of strings containing only the variable names, without any additional explanation or numbering. 
         Example response format: ["variableName1", "variableName2", "variableName3"]`;

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
          await this.getSuggestions(data.value, data.style);
          break;
        case "copy":
          vscode.env.clipboard.writeText(data.value);
          vscode.window.showInformationMessage(`Copied: ${data.value}`);
          break;
      }
    });
  }

  private async getSuggestions(text: string, style: string) {
    const { apiKey, suggestionCount } = await this.getConfig();
    if (apiKey) {
      try {
        const suggestions = await this.getSuggestionsWithRetry(
          text,
          apiKey,
          suggestionCount,
          style
        );
        this._view?.webview.postMessage({
          type: "suggestions",
          value: suggestions,
        });

        this._outputChannel.appendLine(`Input: ${text}`);
        this._outputChannel.appendLine(`Style: ${style}`);
        this._outputChannel.appendLine(`Suggestions:`);
        suggestions.forEach((suggestion, index) => {
          this._outputChannel.appendLine(`${index + 1}. ${suggestion}`);
        });
        this._outputChannel.appendLine("---");
        this._outputChannel.show();
      } catch (error) {
        this.handleError(error);
      }
    } else {
      vscode.window.showErrorMessage(
        "API key is not set. Please set it in the settings."
      );
    }
  }

  private async getConfig(): Promise<{
    apiKey: string | undefined;
    suggestionCount: number;
  }> {
    const config = vscode.workspace.getConfiguration("vscode-namer");
    let apiKey = config.get<string>("apiKey");
    const suggestionCount = config.get<number>("suggestionCount") || 5;

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

    return { apiKey, suggestionCount };
  }

  private async getSuggestionsWithRetry(
    text: string,
    apiKey: string,
    count: number,
    style: string,
    maxRetries = 3
  ): Promise<string[]> {
    let retries = 0;
    while (retries < maxRetries) {
      try {
        const response = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          {
            model: "gpt-3.5-turbo",
            messages: [
              { role: "system", content: this.SYSTEM_PROMPT },
              { role: "user", content: this.USER_PROMPT(count, text, style) },
            ],
            max_tokens: 150,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (
          response.data &&
          response.data.choices &&
          response.data.choices.length > 0
        ) {
          const content = response.data.choices[0].message.content;

          this._outputChannel.appendLine("Full API Response:");
          this._outputChannel.appendLine(
            JSON.stringify(response.data, null, 2)
          );
          this._outputChannel.appendLine("---");

          try {
            const suggestions = JSON.parse(content);
            if (
              Array.isArray(suggestions) &&
              suggestions.every((item) => typeof item === "string")
            ) {
              return suggestions.slice(0, count);
            } else {
              throw new Error(
                "Invalid response format: not an array of strings"
              );
            }
          } catch (parseError) {
            throw new Error(`Failed to parse response as JSON: ${parseError}`);
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
          throw error;
        }
      }
    }
    throw new Error("Max retries reached");
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
                <select id="namingStyle">
                    <option value="camelCase">camelCase</option>
                    <option value="PascalCase">PascalCase</option>
                    <option value="snake_case">snake_case</option>
                    <option value="kebab-case">kebab-case</option>
                </select>
                <input id="input" type="text" placeholder="Enter description for variable">
                <button id="suggest">Suggest Names</button>
                <div id="suggestions"></div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`;
  }
}
