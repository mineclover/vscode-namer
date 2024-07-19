"use strict";

import * as vscode from "vscode";
import * as fs from "fs";
import * as ts from "typescript";
import * as path from "path";

const uniq = (array: string[]) => [...new Set(array)];
const inferredTypeMap = new Map<string, string>();
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
    "extension.clipInferredType",
    async (hoverKey: string) => {
      if (typeof hoverKey !== "string") {
        console.error("Invalid hover key type:", typeof hoverKey);
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
        console.log("No inferred type found for key:", hoverKey);
        console.log("Current map contents:", [...inferredTypeMap.entries()]);
        vscode.window.showInformationMessage(
          "No type could be inferred at this position"
        );
      }
    }
  );

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

            // 호버 위치에 대한 고유 키 생성
            const hoverKey = `${document.uri.toString()}:${position.line}:${
              position.character
            }`;

            // 추론된 타입 정보 저장
            inferredTypeMap.set(hoverKey, inferredType);

            if (showTypeOnHover) {
              contents.appendCodeblock(inferredType, "typescript");
              contents.appendMarkdown("\n");
            }

            // 명령에 인자를 전달할 때 encodeURIComponent 사용
            contents.appendMarkdown(
              `<a href="command:extension.clipInferredType?${encodeURIComponent(
                JSON.stringify([hoverKey])
              )}">Copy Inferred Type</a>`
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

  const clipInferredType = vscode.commands.registerCommand(
    "extension.clipInferredType",
    async (hoverKey: string) => {
      try {
        console.log("Received hover key:", hoverKey); // 디버깅용 로그
        if (typeof hoverKey !== "string") {
          console.error("Invalid hover key type:", typeof hoverKey);
          vscode.window.showErrorMessage("Invalid hover key");
          return;
        }

        const inferredType = inferredTypeMap.get(hoverKey);
        if (inferredType) {
          await vscode.env.clipboard.writeText(inferredType);
          vscode.window.showInformationMessage(
            "Inferred type copied to clipboard"
          );

          // 사용 후 Map에서 제거 (메모리 관리)
          inferredTypeMap.delete(hoverKey);
        } else {
          console.log("No inferred type found for key:", hoverKey); // 디버깅용 로그
          console.log("Current map contents:", [...inferredTypeMap.entries()]); // 디버깅용 로그
          vscode.window.showInformationMessage(
            "No type could be inferred at this position"
          );
        }
      } catch (error) {
        console.error("Error copying inferred type:", error);
        vscode.window.showErrorMessage("Error copying inferred type");
      }
    }
  );

  context.subscriptions.push(clipInferredType);

  context.subscriptions.push(disposable);

  context.subscriptions.push(clipboardType);
  context.subscriptions.push(createType);
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

async function getInferredType(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<string | null> {
  try {
    const fileName = document.fileName;
    console.log("Processing file:", fileName);

    const projectRoot = findProjectRoot(fileName);
    console.log("Project root:", projectRoot);

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
      console.log("Found tsconfig.json at:", tsconfigPath);
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      const parsedConfig = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(tsconfigPath)
      );
      compilerOptions = { ...compilerOptions, ...parsedConfig.options };
    } else {
      console.log("No tsconfig.json found. Using default compiler options.");
    }

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
      const typeString = formatType(type, typeChecker);

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
