import * as vscode from 'vscode';
import { parser } from '@lezer/python';

// Add a console log at the beginning of the file
console.log('Extension `saccade` is being loaded');

interface Cell {
    startLine: number;
    endLine: number;
    type: 'code' | 'markdown';
    metadata: { [key: string]: string };
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

    return { startLine, endLine, type: cellType, metadata };
}

function getImplicitCell(document: vscode.TextDocument, position: vscode.Position): Cell | null {
    const code = document.getText();
    const tree = parser.parse(code);

    let startLine = position.line;
    let endLine = position.line;

    // Find the top-level node at the current position
    let node = tree.resolveInner(document.offsetAt(position), 1);
    while (node.parent && node.parent.type.name !== 'Script') {
        node = node.parent;
    }

    if (node) {
        // Handle the case where the cursor is at the start of the file
        if (node.type.name === 'Script' && position.line === 0 && position.character === 0) {
            // Find the first top-level node
            node = node.firstChild || node;
        }

        if (node) {
            const startPos = document.positionAt(node.from);
            const endPos = document.positionAt(node.to);
            startLine = startPos.line;
            endLine = endPos.line;

            // Include adjacent top-level blocks
            while (startLine > 0) {
                const prevLine = document.lineAt(startLine - 1);
                if (prevLine.isEmptyOrWhitespace) {
                    break;
                }
                startLine--;
            }

            while (endLine < document.lineCount - 1) {
                const nextLine = document.lineAt(endLine + 1);
                if (nextLine.isEmptyOrWhitespace) {
                    break;
                }
                endLine++;
            }
        }
    }

    return { startLine, endLine, type: 'code', metadata: {} };
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

    const document = editor.document;
    const range = new vscode.Range(cell.startLine, 0, cell.endLine, document.lineAt(cell.endLine).text.length);
    const cellCode = document.getText(range);

    // Flash the cell
    flashCell(editor, cell);

    if (cell.type === 'code') {
        await vscode.commands.executeCommand('jupyter.execSelectionInteractive', cellCode);
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
