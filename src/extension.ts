import * as vscode from 'vscode';
import { parser } from '@lezer/python';
import { SyntaxNode, TreeFragment, Input, Tree } from '@lezer/common';

let config = vscode.workspace.getConfiguration('saccade');

const logger = {
    time: (label: string) => {
        if (config.get('debugMode', false)) {
            console.time(label);
        }
    },
    timeEnd: (label: string) => {
        if (config.get('debugMode', false)) {
            console.timeEnd(label);
        }
    },
    log: (...args: any[]) => {
        if (config.get('debugMode', false)) {
            console.log(...args);
        }
    },
    error: (...args: any[]) => {
        if (config.get('debugMode', false)) {
            console.error(...args);
        }
    }
};

interface Cell {
    startLine: number;
    endLine: number;
    type: 'code' | 'markdown';
    metadata: { [key: string]: string };
    text: string;
}

function checkForExplicitMarkers(document: vscode.TextDocument): boolean {
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

class StringInput implements Input {
    constructor(private content: string) {}

    get length() { return this.content.length; }

    chunk(from: number) { return this.content.slice(from); }

    read(from: number, to: number) { return this.content.slice(from, to); }

    lineChunks = false;
}

let lastTree: Tree | null = null;

function getImplicitCell(document: vscode.TextDocument, position: vscode.Position): Cell | null {
    const code = document.getText();
    const input = new StringInput(code);
    const tree = parser.parse(input);
    
    lastTree = tree;
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

const decorations = {
    createDecoration: vscode.window.createTextEditorDecorationType,
    types: {} as Record<string, vscode.TextEditorDecorationType>,

    initTypes() {
        const cellBorderColor = config.get('currentCell.borderColor', 'transparent');
        const cellBorderWidth = config.get('currentCell.borderWidth', '0');
        const cellFlashColor = config.get('cellFlash.color', 'transparent');

        this.types = {
            cellTopAbove: this.createDecoration({
                isWholeLine: true,
                borderColor: cellBorderColor,
                borderStyle: 'solid',
                borderWidth: `0 0 ${cellBorderWidth} 0`,
            }),
            cellTopOn: this.createDecoration({
                isWholeLine: true,
                borderColor: cellBorderColor,
                borderStyle: 'solid',
                borderWidth: `${cellBorderWidth} 0 0 0`,
            }),
            cellBottomBelow: this.createDecoration({
                borderColor: cellBorderColor,
                borderStyle: 'solid',
                borderWidth: `${cellBorderWidth} 0 0 0`,
                isWholeLine: true,
            }),
            cellBottomOn: this.createDecoration({
                borderColor: cellBorderColor,
                borderStyle: 'solid',
                borderWidth: `0 0 ${cellBorderWidth} 0`,
                isWholeLine: true,
            }),
            flash: this.createDecoration({
                backgroundColor: cellFlashColor,
                isWholeLine: true,
            }),
        };
    },

    apply(editor: vscode.TextEditor, range: vscode.Range | null, decorationType: vscode.TextEditorDecorationType) {
        editor.setDecorations(decorationType, range ? [range] : []);
    },

    getCellRange(editor: vscode.TextEditor, cell: Cell | null): vscode.Range | null {
        if (!cell) return null;
        return new vscode.Range(cell.startLine, 0, cell.endLine, editor.document.lineAt(cell.endLine).text.length);
    },

    decorateCurrentCell(editor: vscode.TextEditor, cell: Cell | null) {
        
        this.clearAllDecorations(editor);

        if(!config.get("currentCell.border", true)) {
            return;
        }

        const range = this.getCellRange(editor, cell);
        if (range) {
            const isFirstLine = range.start.line === 0;
            const isLastLine = range.end.line === editor.document.lineCount - 1;

            // Top border
            if (isFirstLine) {
                this.apply(editor, new vscode.Range(range.start, range.start), this.types.cellTopOn);
            } else {
                const topLineRange = new vscode.Range(
                    range.start.line - 1,
                    editor.document.lineAt(range.start.line - 1).text.length,
                    range.start.line - 1,
                    editor.document.lineAt(range.start.line - 1).text.length
                );
                this.apply(editor, topLineRange, this.types.cellTopAbove);
            }

            // Bottom border
            if (isLastLine) {
                this.apply(editor, new vscode.Range(range.end, range.end), this.types.cellBottomOn);
            } else {
                const bottomLineRange = new vscode.Range(
                    range.end.line + 1,
                    0,
                    range.end.line + 1,
                    0
                );
                this.apply(editor, bottomLineRange, this.types.cellBottomBelow);
            }
        }
    },

    flashCell(editor: vscode.TextEditor, cell: Cell | null) {
        const range = this.getCellRange(editor, cell);
        if (range) {
            this.apply(editor, range, this.types.flash);
            setTimeout(() => this.apply(editor, null, this.types.flash), 200); // Flash for 200ms
        }
    },

    clearAllDecorations(editor: vscode.TextEditor) {
        Object.values(this.types).forEach(decorationType => {
            this.apply(editor, null, decorationType);
        });
    },

    dispose() {
        Object.values(this.types).forEach(decorationType => decorationType.dispose());
    }
};

async function evaluateCell(editor: vscode.TextEditor, cell: Cell | null): Promise<void> {
    if (!cell) {
        vscode.window.showErrorMessage('No cell found at cursor position');
        return;
    }

    decorations.flashCell(editor, cell);

    if (cell.type === 'code') {
        await vscode.commands.executeCommand('jupyter.execSelectionInteractive', cell.text);
    } else {
        vscode.window.showInformationMessage('Selected cell is a Markdown cell and cannot be executed.');
    }
}

function moveToNextCell(editor: vscode.TextEditor, currentCell: Cell): void {
    const document = editor.document;
    let nextLine = currentCell.endLine + 1;

    while (nextLine < document.lineCount && document.lineAt(nextLine).isEmptyOrWhitespace) {
        nextLine++;
    }

    if (nextLine < document.lineCount) {
        const nextCell = getCellAtPosition(document, new vscode.Position(nextLine, 0));
        if (nextCell) {
            const newPosition = new vscode.Position(nextCell.startLine, 0);
            editor.selection = new vscode.Selection(newPosition, newPosition);
            
            // Calculate the range to reveal, including the next cell and some context
            const endOfNextCell = new vscode.Position(nextCell.endLine, document.lineAt(nextCell.endLine).text.length);
            const rangeToReveal = new vscode.Range(newPosition, endOfNextCell);
            
            // Reveal the range with a small amount of padding above and below
            editor.revealRange(rangeToReveal, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
    }
}


function isStandardEditor(editor: vscode.TextEditor | undefined): boolean {
    return editor !== undefined && 
           editor.document.languageId === 'python' && 
           editor.viewColumn !== undefined;
}

export function activate(context: vscode.ExtensionContext) {
    try {
        let disposables: vscode.Disposable[] = [];

        decorations.initTypes();

        disposables.push(vscode.commands.registerCommand('extension.evaluatePythonToplevel', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && isStandardEditor(editor)) {
                const cell = getCellAtPosition(editor.document, editor.selection.active);
                await evaluateCell(editor, cell);
            }
        }));

        disposables.push(vscode.commands.registerCommand('extension.evaluatePythonToplevelAndMoveNext', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && isStandardEditor(editor)) {
                const cell = getCellAtPosition(editor.document, editor.selection.active);
                await evaluateCell(editor, cell);

                if (cell) {
                    moveToNextCell(editor, cell);
                }
            }
        }));

        disposables.push(vscode.workspace.onDidChangeTextDocument(event => {
            const document = event.document;
            if (isStandardEditor(vscode.window.activeTextEditor) && lastTree) {
                logger.time('Incremental parsing');
                const changes = event.contentChanges.map(change => ({
                    fromA: document.offsetAt(change.range.start),
                    toA: document.offsetAt(change.range.end),
                    fromB: document.offsetAt(change.range.start),
                    toB: document.offsetAt(change.range.start) + change.text.length
                }));
                
                const fragments = TreeFragment.applyChanges(TreeFragment.addTree(lastTree), changes);
                const newTree = parser.parse(new StringInput(document.getText()), fragments);
                lastTree = newTree;
                logger.timeEnd('Incremental parsing');
            } else if (isStandardEditor(vscode.window.activeTextEditor)) {
                logger.time('Full parsing');
                lastTree = parser.parse(new StringInput(document.getText()));
                logger.timeEnd('Full parsing');
            }
        }));

        disposables.push(vscode.window.onDidChangeTextEditorSelection(event => {
            const editor = event.textEditor;
            if (isStandardEditor(editor)) {
                const cell = getCellAtPosition(editor.document, editor.selection.active);
                decorations.decorateCurrentCell(editor, cell);
            }
        }));

        disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('saccade')) {
                config = vscode.workspace.getConfiguration('saccade');
                decorations.dispose();
                decorations.initTypes();
            }
        }));

        context.subscriptions.push(...disposables);

    } catch (error) {
        logger.error('Error activating extension:', error);
        vscode.window.showErrorMessage('Failed to activate Saccade extension');
    }
}

export function deactivate() {
    decorations.dispose();
}
