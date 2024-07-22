import * as vscode from "vscode";
import axios from "axios";

export class VariableNameSuggesterProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  > = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    vscode.TreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    } else {
      const suggestItem = new vscode.TreeItem(
        "Suggest Variable Names",
        vscode.TreeItemCollapsibleState.None
      );
      suggestItem.command = {
        command: "variable-name-suggester.suggestNames",
        title: "Suggest Names",
      };
      return Promise.resolve([suggestItem]);
    }
  }
}

export async function suggestVariableNames(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const selection = editor.selection;
    const text = editor.document.getText(selection);

    if (text) {
      const { apiKey, suggestionCount } = await getConfig();
      if (apiKey) {
        try {
          const suggestions = await getSuggestionsWithRetry(
            text,
            apiKey,
            suggestionCount
          );
          await showSuggestionsQuickPick(suggestions);
        } catch (error) {
          if (error instanceof Error) {
            vscode.window.showErrorMessage(`Error: ${error.message}`);
          } else {
            vscode.window.showErrorMessage(`An unexpected error occurred`);
          }
        }
      } else {
        vscode.window.showErrorMessage(
          "API key is not set. Please set it in the settings."
        );
      }
    } else {
      vscode.window.showInformationMessage(
        "Please select some text to get variable name suggestions."
      );
    }
  }
}

async function getConfig(): Promise<{
  apiKey: string | undefined;
  suggestionCount: number;
}> {
  const config = vscode.workspace.getConfiguration("variableNameSuggester");
  let apiKey = config.get<string>("apiKey");
  const suggestionCount = config.get<number>("suggestionCount") || 5;

  if (!apiKey) {
    apiKey = await vscode.window.showInputBox({
      prompt: "Enter your OpenAI API Key",
      password: true,
    });

    if (apiKey) {
      await config.update("apiKey", apiKey, vscode.ConfigurationTarget.Global);
    }
  }

  return { apiKey, suggestionCount };
}

async function getSuggestionsWithRetry(
  text: string,
  apiKey: string,
  count: number,
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
            {
              role: "system",
              content:
                "You are a helpful assistant that suggests variable names.",
            },
            {
              role: "user",
              content: `Suggest ${count} variable names for: ${text}`,
            },
          ],
          max_tokens: 60,
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
        const suggestions =
          response.data.choices[0].message.content.split("\n");
        return suggestions.slice(0, count);
      } else {
        throw new Error("Invalid API response format");
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 429) {
          const waitTime = extractRetryAfterTime(
            error.response.headers["retry-after"]
          );
          console.log(
            `Rate limited. Waiting for ${waitTime} seconds before retry.`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
          retries++;
        } else {
          throw new Error(
            `Request failed: ${error.response?.status} ${error.response?.statusText}`
          );
        }
      } else if (error instanceof Error) {
        throw error;
      } else {
        throw new Error("An unexpected error occurred");
      }
    }
  }
  throw new Error("Max retries reached");
}

function extractRetryAfterTime(retryAfter: string | undefined): number {
  if (!retryAfter) return 5;
  const parsedTime = parseInt(retryAfter, 10);
  return isNaN(parsedTime) ? 5 : parsedTime;
}

async function showSuggestionsQuickPick(suggestions: string[]) {
  const selected = await vscode.window.showQuickPick(suggestions, {
    placeHolder: "Select a variable name",
    onDidSelectItem: (item) => {
      vscode.env.clipboard.writeText(item.toString());
      vscode.window.showInformationMessage(`Copied: ${item}`);
    },
  });

  if (selected) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      editor.edit((editBuilder) => {
        editBuilder.replace(editor.selection, selected);
      });
    }
  }
}

export function deactivate() {}
