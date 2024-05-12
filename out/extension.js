"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = exports.getAllClassNames = void 0;
const vscode = require("vscode");
const fs = require("fs");
const uniq = (array) => [...new Set(array)];
function getAllClassNames(content) {
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
exports.getAllClassNames = getAllClassNames;
function copyTextToClipboard(text) {
    vscode.env.clipboard.writeText(text).then(() => {
        vscode.window.showInformationMessage("클립보드에 복사되었습니다.");
    }, (error) => {
        vscode.window.showErrorMessage("클립보드에 복사하는 데 실패했습니다: " + error);
    });
}
function createFile(filePath, content) {
    fs.writeFile(filePath, content, (err) => {
        if (err) {
            vscode.window.showErrorMessage("파일을 생성하는 데 실패했습니다.");
        }
        else {
            vscode.window.showInformationMessage(`${filePath}에 파일이 생성되었습니다.`);
        }
    });
}
const getFilePath = (uri) => {
    const fsPath = uri.fsPath;
    const fsSplit = fsPath.split("/");
    const name = fsSplit.pop();
    const folder = fsSplit.join("/");
    return { name, folder };
};
const getDocumentText = (document) => {
    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    return document.getText(fullRange);
};
/**
 * export type {name} = "a" | "b" ...;
 * @param arr
 * @param name
 * @returns
 */
const arrayToStringTyped = (arr, name) => {
    const types = arr.map((item) => '"' + item + '"').join(" | ");
    const context = "export type " + name + " = " + types;
    return context;
};
function activate(context) {
    const createType = vscode.commands.registerCommand("extension.createType", function () {
        // 전체 텍스트 가져오기
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const { name, folder } = getFilePath(editor.document.uri);
        if (!name)
            return;
        // scss 파일만
        if (!(name.endsWith(".css") || name.endsWith(".scss")))
            return;
        const fullText = getDocumentText(editor.document);
        // 클래스 리스트
        const classes = getAllClassNames(fullText);
        // 타입 텍스트화
        const context = arrayToStringTyped(classes, name.split(".")[0]);
        const newName = name.replace(/(\.css|\.scss)$/, ".d.ts");
        // 파일 생성
        createFile(folder + "/" + newName, context);
    });
    const clipboardType = vscode.commands.registerCommand("extension.clipboardType", function () {
        // 전체 텍스트 가져오기
        const editor = vscode.window.activeTextEditor;
        if (!editor)
            return;
        const { name, folder } = getFilePath(editor.document.uri);
        if (!name)
            return;
        // scss 파일만
        if (!(name.endsWith(".css") || name.endsWith(".scss")))
            return;
        const fullText = getDocumentText(editor.document);
        // 클래스 리스트
        const classes = getAllClassNames(fullText);
        // 타입 텍스트화
        const context = arrayToStringTyped(classes, name.split(".")[0]);
        copyTextToClipboard(context);
    });
    context.subscriptions.push(clipboardType);
    context.subscriptions.push(createType);
}
exports.activate = activate;
//# sourceMappingURL=extension.js.map