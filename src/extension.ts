"use strict";

import * as vscode from "vscode";
import * as fs from "fs";
import * as ts from "typescript";
import * as path from "path";
import { suggestVariableNames, VariableNameSuggesterProvider } from "./nameGPT";

const uniq = (array: string[]) => [...new Set(array)];

export function getAllClassNames(content: string) {
  // check file exists, if not just return []
  const matchLineRegexp = /.*[,{]/g;

  const lines = content.match(matchLineRegexp);
  if (lines === null) {
    return [];
  }

  const classNames = lines.join(" ").match(/\.[_A-Za-z0-9-]+/g);
  if (classNames === null) {
    return [];
  }

  //slice(1) 은 . 빼려고 하는 것

  const uniqNames = uniq(classNames)
    .map((item) => item.slice(1))
    .filter((item) => !/^[0-9]/.test(item));
  return uniqNames;
}

function copyTextToClipboard(text: string) {
  vscode.env.clipboard.writeText(text).then(
    () => {
      vscode.window.showInformationMessage("클립보드에 복사되었습니다.");
    },
    (error) => {
      vscode.window.showErrorMessage(
        "클립보드에 복사하는 데 실패했습니다: " + error
      );
    }
  );
}

function createFile(filePath: string, content: string) {
  fs.writeFile(filePath, content, (err) => {
    if (err) {
      vscode.window.showErrorMessage("파일을 생성하는 데 실패했습니다.");
    } else {
      vscode.window.showInformationMessage(
        `${filePath}에 파일이 생성되었습니다.`
      );
    }
  });
}

const getFilePath = (uri: vscode.Uri) => {
  const fsPath = uri.fsPath;
  const fsSplit = fsPath.split("/");
  const name = fsSplit.pop();
  const folder = fsSplit.join("/");
  return { name, folder };
};

const getDocumentText = (document: vscode.TextDocument) => {
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length)
  );
  return document.getText(fullRange);
};

/**
 * export type {name} = "a" | "b" ...;
 * @param arr
 * @param name
 * @returns
 */
const arrayToStringTyped = (arr: string[], name: string) => {
  const types = arr.map((item) => '"' + item + '"').join(" | ");
  const context = "export type " + name + "Styles" + " = " + types;
  return context;
};

// eslint-disable-next-line prefer-const
let inferredTypeMap = new Map<string, string>();
// eslint-disable-next-line prefer-const
let currentHoverKey: string | null = null;
export function activate(context: vscode.ExtensionContext) {
  const createType = vscode.commands.registerCommand(
    "extension.createType",
    function () {
      // 전체 텍스트 가져오기
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const { name, folder } = getFilePath(editor.document.uri);
      if (!name) return;
      // scss 파일만
      if (!(name.endsWith(".css") || name.endsWith(".scss"))) return;
      const fullText = getDocumentText(editor.document);
      // 클래스 리스트
      const classes = getAllClassNames(fullText);
      // 타입 텍스트화
      const context = arrayToStringTyped(classes, name.split(".")[0]);

      const newName = name.replace(/(\.css|\.scss)$/, ".d.ts");
      // 파일 생성
      createFile(folder + "/" + newName, context);
    }
  );
  const clipboardType = vscode.commands.registerCommand(
    "extension.clipboardType",
    function () {
      // 전체 텍스트 가져오기
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const { name, folder } = getFilePath(editor.document.uri);
      if (!name) return;
      // scss 파일만
      if (!(name.endsWith(".css") || name.endsWith(".scss"))) return;
      const fullText = getDocumentText(editor.document);
      // 클래스 리스트
      const classes = getAllClassNames(fullText);
      // 타입 텍스트화
      const context = arrayToStringTyped(classes, name.split(".")[0]);
      // 복사
      copyTextToClipboard(context);
    }
  );

  // 추론된 타입 전체

  const hover = vscode.languages.registerHoverProvider(
    ["typescript", "typescriptreact"],
    {
      async provideHover(document, position, token) {
        try {
          const inferredType = await getInferredType(document, position);
          if (inferredType) {
            const showTypeOnHover = vscode.workspace
              .getConfiguration("cssToTyped")
              .get("showTypeOnHover");
            const contents = new vscode.MarkdownString();
            contents.isTrusted = true;
            contents.supportHtml = true;

            const hoverKey = `${document.uri.toString()}:${position.line}:${
              position.character
            }`;

            inferredTypeMap.set(hoverKey, inferredType);
            currentHoverKey = hoverKey; // 현재 호버 키 저장

            if (showTypeOnHover) {
              contents.appendCodeblock(inferredType, "typescript");
              contents.appendMarkdown("\n");
            }

            contents.appendMarkdown(
              `<a href="command:cssToTyped.copyInferredType">Copy Inferred Type</a>`
            );

            return new vscode.Hover(contents);
          }
        } catch (error) {
          console.error("Error in hover provider:", error);
        }
        return null;
      },
    }
  );
  context.subscriptions.push(hover);

  // 호버가 해제될 때 메모리 정리
  const selectionChangeDisposable =
    vscode.window.onDidChangeTextEditorSelection(() => {
      currentHoverKey = null;
    });

  context.subscriptions.push(selectionChangeDisposable);
  const copyInferredType = vscode.commands.registerCommand(
    "cssToTyped.copyInferredType",
    async () => {
      if (!currentHoverKey) {
        console.error("No current hover key");
        vscode.window.showErrorMessage("No type to copy");
        return;
      }

      const inferredType = inferredTypeMap.get(currentHoverKey);
      if (inferredType) {
        try {
          await vscode.env.clipboard.writeText(inferredType);
          vscode.window.showInformationMessage(
            "Inferred type copied to clipboard"
          );
        } catch (error) {
          console.error("Error copying to clipboard:", error);
          vscode.window.showErrorMessage(
            "Error copying inferred type to clipboard"
          );
        }
      } else {
        vscode.window.showInformationMessage(
          "No type could be inferred at this position"
        );
      }
    }
  );
  context.subscriptions.push(copyInferredType);

  context.subscriptions.push(selectionChangeDisposable);

  // getInferredType, formatType, findNodeAtPosition, getAllTypeScriptFiles 함수들은 이전과 동일
  const disposable = vscode.commands.registerCommand(
    "extension.copyInferredType",
    async (args: any) => {
      let hoverKey: string;

      if (Array.isArray(args) && typeof args[0] === "string") {
        hoverKey = args[0];
      } else if (typeof args === "string") {
        hoverKey = args;
      } else {
        console.error("Invalid arguments received:", args);
        vscode.window.showErrorMessage("Invalid hover key");
        return;
      }

      const inferredType = inferredTypeMap.get(hoverKey);
      if (inferredType) {
        try {
          await vscode.env.clipboard.writeText(inferredType);
          vscode.window.showInformationMessage(
            "Inferred type copied to clipboard"
          );

          // 사용 후 Map에서 제거 (메모리 관리)
          inferredTypeMap.delete(hoverKey);
        } catch (error) {
          console.error("Error copying to clipboard:", error);
          vscode.window.showErrorMessage(
            "Error copying inferred type to clipboard"
          );
        }
      } else {
        vscode.window.showInformationMessage(
          "No type could be inferred at this position"
        );
      }
    }
  );

  const variableNameSuggesterProvider = new VariableNameSuggesterProvider();
  vscode.window.registerTreeDataProvider(
    "variableNameSuggesterSidebar",
    variableNameSuggesterProvider
  );

  const suggestVariable = vscode.commands.registerCommand(
    "variable-name-suggester.suggestNames",
    () => suggestVariableNames(context)
  );

  context.subscriptions.push(suggestVariable);

  context.subscriptions.push(disposable);

  context.subscriptions.push(clipboardType);
  context.subscriptions.push(createType);
}

async function getInferredType(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<string | null> {
  try {
    const fileName = document.fileName;

    const projectRoot = findProjectRoot(fileName);

    const tsconfigPath = ts.findConfigFile(
      projectRoot,
      ts.sys.fileExists,
      "tsconfig.json"
    );
    let compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.CommonJS,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      allowJs: true,
      checkJs: true,
    };

    if (tsconfigPath) {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(tsconfigPath)
      );
      compilerOptions = { ...compilerOptions, ...parsedConfig.options };
    }

    const projectFiles = getAllTypeScriptFiles(projectRoot);

    const program = ts.createProgram(projectFiles, compilerOptions);
    const sourceFile = program.getSourceFile(fileName);
    const typeChecker = program.getTypeChecker();

    if (!sourceFile) {
      return null;
    }

    const offset = document.offsetAt(position);
    const nodeAtPosition = findNodeAtPosition(sourceFile, offset);

    if (nodeAtPosition) {
      let typeNode: ts.Node | undefined = nodeAtPosition;

      // 표현식인 경우 부모 노드를 찾습니다.
      if (ts.isExpressionStatement(nodeAtPosition)) {
        typeNode = nodeAtPosition.expression;
      }

      // 변수 선언인 경우 초기화 표현식을 찾습니다.
      if (ts.isVariableDeclaration(typeNode) && typeNode.initializer) {
        typeNode = typeNode.initializer;
      }

      const type = typeChecker.getTypeAtLocation(typeNode);
      const typeString = formatType(type, typeChecker);

      return typeString;
    }

    return null;
  } catch (error) {
    console.error("Error in getInferredType:", error);
    return null;
  }
}

function findProjectRoot(fileName: string): string {
  let dir = path.dirname(fileName);
  while (dir !== path.parse(dir).root) {
    if (
      fs.existsSync(path.join(dir, "package.json")) ||
      fs.existsSync(path.join(dir, "tsconfig.json"))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return dir;
}

function formatType(type: ts.Type, typeChecker: ts.TypeChecker): string {
  if (type.isUnion()) {
    return type.types.map((t) => formatType(t, typeChecker)).join(" | ");
  }

  if (type.isIntersection()) {
    return type.types.map((t) => formatType(t, typeChecker)).join(" & ");
  }

  if (type.isClassOrInterface()) {
    const props = type.getProperties().map((prop) => {
      const propType = typeChecker.getTypeOfSymbolAtLocation(
        prop,
        prop.valueDeclaration!
      );
      const isOptional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
      return `${prop.name}${isOptional ? "?" : ""}: ${formatType(
        propType,
        typeChecker
      )}`;
    });
    return `{ ${props.join("; ")} }`;
  }

  return typeChecker.typeToString(
    type,
    undefined,
    ts.TypeFormatFlags.NoTruncation |
      ts.TypeFormatFlags.WriteArrayAsGenericType |
      ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
      ts.TypeFormatFlags.WriteClassExpressionAsTypeLiteral |
      ts.TypeFormatFlags.InTypeAlias
  );
}

function findNodeAtPosition(
  sourceFile: ts.SourceFile,
  offset: number
): ts.Node | undefined {
  function find(node: ts.Node): ts.Node | undefined {
    if (node.getStart() <= offset && offset < node.getEnd()) {
      const childNode = ts.forEachChild(node, find);
      return childNode || node;
    }
  }
  return find(sourceFile);
}

function getAllTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".git") {
          files.push(...getAllTypeScriptFiles(fullPath));
        }
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
      ) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error);
  }

  return files;
}
