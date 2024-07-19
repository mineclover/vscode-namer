"use strict";

import * as vscode from "vscode";
import * as fs from "fs";
import * as ts from "typescript";
import * as path from "path";

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
  const disposable = vscode.commands.registerCommand(
    "extension.copyInferredType",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("No active editor");
        return;
      }

      const document = editor.document;
      const position = editor.selection.active;

      try {
        const inferredType = await getInferredType(document, position);
        if (inferredType) {
          // 추론된 타입을 클립보드에 복사
          await vscode.env.clipboard.writeText(inferredType);
          vscode.window.showInformationMessage(
            "Inferred type copied to clipboard"
          );
        } else {
          vscode.window.showInformationMessage(
            "Could not infer type at the current position"
          );
        }
      } catch (error) {
        console.error("Error in copyInferredType command:", error);
        vscode.window.showErrorMessage("Error inferring type");
      }
    }
  );

  const hover = vscode.languages.registerHoverProvider("typescript", {
    async provideHover(document, position, token) {
      try {
        const inferredType = await getInferredType(document, position);
        if (inferredType) {
          const copyCommand = "extension.copyHoveredType";
          const contents = new vscode.MarkdownString(
            `Inferred type:\n\`\`\`typescript\n${inferredType}\n\`\`\``
          );
          contents.appendMarkdown(`\n\n[Copy](command:${copyCommand})`);
          contents.isTrusted = true;

          return new vscode.Hover(contents);
        }
      } catch (error) {
        console.error("Error in hover provider:", error);
      }
      return null;
    },
  });

  const copyHoveredType = vscode.commands.registerCommand(
    "extension.copyHoveredType",
    () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const position = editor.selection.active;
        getInferredType(editor.document, position).then((type) => {
          if (type) {
            vscode.env.clipboard.writeText(type);
            vscode.window.showInformationMessage("Type copied to clipboard");
          }
        });
      }
    }
  );

  context.subscriptions.push(hover);
  context.subscriptions.push(copyHoveredType);
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
    console.log("Processing file:", fileName);

    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.CommonJS,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      allowJs: true,
      checkJs: true,
    };

    const projectRoot = path.dirname(fileName);
    console.log("Project root:", projectRoot);

    const projectFiles = getAllTypeScriptFiles(projectRoot);
    console.log("Project files:", projectFiles);

    const program = ts.createProgram(projectFiles, compilerOptions);
    const sourceFile = program.getSourceFile(fileName);
    const typeChecker = program.getTypeChecker();

    if (!sourceFile) {
      console.log("Source file not found");
      return null;
    }

    const offset = document.offsetAt(position);
    const nodeAtPosition = findNodeAtPosition(sourceFile, offset);

    console.log(
      "Node at position:",
      nodeAtPosition?.kind ? ts.SyntaxKind[nodeAtPosition.kind] : "Not found"
    );

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
      const typeString = typeChecker.typeToString(
        type,
        undefined,
        ts.TypeFormatFlags.NoTruncation |
          ts.TypeFormatFlags.WriteArrayAsGenericType |
          ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
          ts.TypeFormatFlags.WriteClassExpressionAsTypeLiteral |
          ts.TypeFormatFlags.InTypeAlias
      );

      console.log("Inferred type:", typeString);
      return typeString;
    } else {
      console.log("No node found at position");
    }

    return null;
  } catch (error) {
    console.error("Error in getInferredType:", error);
    return null;
  }
}
function expandType(
  type: ts.Type,
  typeChecker: ts.TypeChecker,
  depth: number = 0
): string {
  if (depth > 3) {
    // 재귀 깊이 제한
    return "...";
  }

  if (type.isUnion()) {
    return type.types
      .map((t) => expandType(t, typeChecker, depth + 1))
      .join(" | ");
  }

  if (type.isIntersection()) {
    return type.types
      .map((t) => expandType(t, typeChecker, depth + 1))
      .join(" & ");
  }

  if (type.isClassOrInterface()) {
    const props = type.getProperties().map((prop) => {
      const propType = typeChecker.getTypeOfSymbolAtLocation(
        prop,
        prop.valueDeclaration!
      );
      return `${prop.name}: ${expandType(propType, typeChecker, depth + 1)}`;
    });
    return `{ ${props.join("; ")} }`;
  }

  if (type.isLiteral()) {
    return JSON.stringify(type.value);
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
function formatTypeString(typeString: string): string {
  return typeString.replace(/\{([^{}]*)\}/g, (match, content) => {
    const properties = content.split(";").filter(Boolean);
    const formattedProperties = properties
      .map((prop: string) => `    ${prop.trim()}`)
      .join(";\n");
    return `{\n${formattedProperties}\n}`;
  });
}
