import * as vscode from "vscode";
import { VariableNameSuggesterViewProvider } from "./VariableNameSuggesterViewProvider";

export function activate(context: vscode.ExtensionContext) {
  const provider = new VariableNameSuggesterViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      VariableNameSuggesterViewProvider.viewType,
      provider
    )
  );

  const disposable = vscode.commands.registerCommand(
    "vscode-namer.suggestNames",
    () => {
      vscode.commands.executeCommand(
        "workbench.view.extension.variable-name-suggester-sidebar"
      );
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
