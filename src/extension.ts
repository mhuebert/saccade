import * as vscode from 'vscode';
import { parser } from '@lezer/python';
import { SyntaxNode } from '@lezer/common';

// Add a console log at the beginning of the file
console.log('Extension `saccade` is being loaded');

interface Cell {
    startLine: number;
    endLine: number;
    type: 'code' | 'markdown';
    metadata: { [key: string]: string };
    text: string;
}

function checkForExplicitMarkers(document: vscode.TextDocument): boolean {
    const config = vscode.workspace.getConfiguration('saccade');
    const enabledCellMarkers: string[] = config.get('enabledCellMarkers', ['# +', '# %+', '# %%']);
    
    // Check only the first 100 lines for performance
    const linesToCheck = Math.min(document.lineCount, 100);
    for (let i = 0; i < linesToCheck; i++) {
        const line = document.lineAt(i).text.trim();
        if (enabledCellMarkers.some(marker => line.startsWith(marker))) {
            return true;
        }
    }
    return false;
}

export function getCellAtPosition(document: vscode.TextDocument, position: vscode.Position): Cell | null {
    if (checkForExplicitMarkers(document)) {
        return getExplicitCell(document, position);
    } else {
        return getImplicitCell(document, position);
    }
}

function getExplicitCell(document: vscode.TextDocument, position: vscode.Position): Cell | null {
    const config = vscode.workspace.getConfiguration('saccade');
    const enabledCellMarkers: string[] = config.get('enabledCellMarkers', ['# +', '# %+', '# %%']);
    
    let startLine = position.line;
    let endLine = position.line;
    let cellType: 'code' | 'markdown' = 'code';
    let metadata: { [key: string]: string } = {};

    // Find the start of the cell
    while (startLine > 0) {
        const line = document.lineAt(startLine - 1).text.trim();
        if (enabledCellMarkers.some(marker => line.startsWith(marker))) {
            metadata = parseMetadata(line);
            if (line.includes('[markdown]')) {
                cellType = 'markdown';
            }
            break;
        }
        startLine--;
    }

    // Find the end of the cell
    while (endLine < document.lineCount - 1) {
        const line = document.lineAt(endLine + 1).text.trim();
        if (enabledCellMarkers.some(marker => line.startsWith(marker)) || 
            line.startsWith('# -') || line.startsWith('# %-')) {
            break;
        }
        endLine++;
    }

    const text = document.getText(new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length));
    return { startLine, endLine, type: cellType, metadata, text };
}
function getImplicitCell(document: vscode.TextDocument, position: vscode.Position): Cell | null {
    const code = document.getText();
    const tree = parser.parse(code);
    let cursor = tree.cursor();

    // Move cursor to the position
    cursor.moveTo(document.offsetAt(position));

    // Find the top-level node at or before the cursor position
    while (cursor.parent()) {
        if (cursor.node.parent === null) {
            break;
        }
    }

    // If we're at the Script node, find the first child that starts after the position
    if (cursor.type.name === "Script") {
        cursor.firstChild();
        while (cursor.from <= document.offsetAt(position) && cursor.nextSibling()) {}
        if (cursor.from > document.offsetAt(position) && cursor.prevSibling()) {}
    }

    // If we couldn't find a node, return null
    if (!cursor.node) {
        return null;
    }

    const currentNode = cursor.node;

    // Find contiguous top-level nodes
    let startNode = currentNode;
    let endNode = currentNode;

    // Traverse backwards to find the start of the block
    while (startNode.prevSibling) {
        if (hasBlankLineBetween(code, startNode.prevSibling, startNode)) {
            break;
        }
        startNode = startNode.prevSibling;
    }

    // Traverse forwards to find the end of the block
    while (endNode.nextSibling) {
        if (hasBlankLineBetween(code, endNode, endNode.nextSibling)) {
            break;
        }
        endNode = endNode.nextSibling;
    }

    const startPos = document.positionAt(startNode.from);
    const endPos = document.positionAt(endNode.to);
    const startLine = startPos.line;
    let endLine = endPos.line;

    // Get the text without trailing newlines
    let text = document.getText(new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length));
    
    // Remove trailing newlines from text, but keep track of how many we removed
    const trailingNewlines = text.match(/\n*$/)?.[0].length ?? 0;
    text = text.replace(/\n+$/, '');
    
    // Adjust endLine to account for removed trailing newlines
    endLine -= trailingNewlines;

    return { startLine, endLine, type: 'code', metadata: {}, text };
}

function hasBlankLineBetween(code: string, node1: SyntaxNode, node2: SyntaxNode): boolean {
    if (!node1 || !node2 || node1.to >= node2.from) {
        return false;
    }
    
    const trailingNewlineNode1 = code.slice(node1.from, node1.to).endsWith('\n') ? 1 : 0;
    const textBetween = code.slice(node1.to, node2.from);
    const totalNewlines = trailingNewlineNode1 + (textBetween.match(/\n/g) || []).length;
    const hasBlankLine = totalNewlines > 1;

    return hasBlankLine;
}

export function parseMetadata(line: string): { [key: string]: string } {
    const metadata: { [key: string]: string } = {};
    const matches = line.match(/(\w+)\s*=\s*"([^"]*)"/g);
    if (matches) {
        matches.forEach(match => {
            const [key, value] = match.split('=').map(s => s.trim().replace(/"/g, ''));
            metadata[key] = value;
        });
    }
    return metadata;
}

let decoration: vscode.TextEditorDecorationType;

export function createDecoration() {
    return vscode.window.createTextEditorDecorationType({
        backgroundColor: 'rgba(100, 100, 100, 0.3)',
        isWholeLine: true,
    });
}

export function highlightCell(editor: vscode.TextEditor, cell: Cell | null) {
    if (!cell) {
        editor.setDecorations(decoration, []);
        return;
    }

    const range = new vscode.Range(cell.startLine, 0, cell.endLine, editor.document.lineAt(cell.endLine).text.length);
    editor.setDecorations(decoration, [range]);
}

function flashCell(editor: vscode.TextEditor, cell: Cell | null) {
    if (!cell) {
        return;
    }

    highlightCell(editor, cell);

    setTimeout(() => {
        editor.setDecorations(decoration, []);
    }, 200); // Flash for 200ms
}

async function evaluateCell(editor: vscode.TextEditor, cell: Cell | null): Promise<void> {
    if (!cell) {
        vscode.window.showErrorMessage('No cell found at cursor position');
        return;
    }

    // Flash the cell
    flashCell(editor, cell);

    if (cell.type === 'code') {
        await vscode.commands.executeCommand('jupyter.execSelectionInteractive', cell.text);
    } else {
        vscode.window.showInformationMessage('Selected cell is a Markdown cell and cannot be executed.');
    }
}

function moveToNextCell(editor: vscode.TextEditor, currentCell: Cell): void {
    const document = editor.document;
    let nextLine = currentCell.endLine + 1;

    // Skip blank lines
    while (nextLine < document.lineCount && document.lineAt(nextLine).isEmptyOrWhitespace) {
        nextLine++;
    }

    if (nextLine < document.lineCount) {
        const nextCell = getCellAtPosition(document, new vscode.Position(nextLine, 0));
        if (nextCell) {
            const newPosition = new vscode.Position(nextCell.startLine, 0);
            editor.selection = new vscode.Selection(newPosition, newPosition);
            editor.revealRange(new vscode.Range(newPosition, newPosition));
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    try {
        decoration = createDecoration();

        let disposables: vscode.Disposable[] = [];

        disposables.push(vscode.commands.registerCommand('extension.evaluatePythonToplevel', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }

            const cell = getCellAtPosition(editor.document, editor.selection.active);
            await evaluateCell(editor, cell);
        }));

        disposables.push(vscode.commands.registerCommand('extension.evaluatePythonToplevelAndMoveNext', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active editor');
                return;
            }

            const cell = getCellAtPosition(editor.document, editor.selection.active);
            await evaluateCell(editor, cell);

            if (cell) {
                moveToNextCell(editor, cell);
            }
        }));

        context.subscriptions.push(...disposables);

    } catch (error) {
        console.error('Error activating extension:', error);
        vscode.window.showErrorMessage('Failed to activate Saccade extension');
    }
}

export function deactivate() {
    if (decoration) {
        decoration.dispose();
    }
}
