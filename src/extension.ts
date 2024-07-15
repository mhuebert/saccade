import * as vscode from 'vscode';
import { parser } from '@lezer/python';
import { SyntaxNode, TreeFragment, Input, Tree } from '@lezer/common';
import * as fs from 'fs';

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
    metadata: Record<string, string>;
    text: string;
}

function checkForExplicitMarkers(document: vscode.TextDocument): boolean {
    const enabledCellMarkers: string[] = config.get('enabledCellMarkers', ['# +', '# %+', '# %%']);
    
    // Check only the first 100 lines for performance
    const linesToCheck = Math.min(document.lineCount, 100);
    for (let i = 0; i < linesToCheck; i++) {
        if (enabledCellMarkers.some(marker => document.lineAt(i).text.startsWith(marker))) {
            return true;
        }
    }
    return false;
}

export function getCellAtPosition(document: vscode.TextDocument, position: vscode.Position): Cell | null {
    const useExplicitCells = config.get('useExplicitCellsIfPresent', false) && checkForExplicitMarkers(document);
    return useExplicitCells ? getExplicitCell(document, position) : getImplicitCell(document, position);
}

const topMarkerRegex = /^\s*(# \+|# %\+|# %%)\s*/;
const bottomMarkerRegex = /^\s*(# -|# %-)\s*$/;

function stripMarkdownComments(text: string): string {
    return text.split('\n')
        .map(line => line.replace(/^#+\s?/, ''))
        .join('\n')
        .trim();
}

function getExplicitCell(document: vscode.TextDocument, position: vscode.Position): Cell | null {
    let startLine = position.line;
    let endLine = position.line;
    let cellType: 'code' | 'markdown' = 'code';
    let metadata: Record<string, string> = {};
    
    const currentLine = document.lineAt(position.line).text;
    if (topMarkerRegex.test(currentLine)) {
        metadata = parseMetadata(currentLine);
        cellType = currentLine.toLowerCase().includes('[markdown]') ? 'markdown' : 'code';
        startLine++;
    } else {
        // Find the start of the cell
        while (startLine > 0) {
            const line = document.lineAt(startLine - 1).text;
            if (topMarkerRegex.test(line)) {
                metadata = parseMetadata(line);
                cellType = line.toLowerCase().includes('[markdown]') ? 'markdown' : 'code';
                break;
            }
            startLine--;
        }
    }

    // Find the end of the cell
    while (endLine < document.lineCount - 1) {
        const line = document.lineAt(endLine + 1).text;
        if (topMarkerRegex.test(line) || bottomMarkerRegex.test(line)) {
            break;
        }
        endLine++;
    }

    let text = document.getText(new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length));
    if (cellType === 'markdown') {
        text = stripMarkdownComments(text);
    }
    return { startLine, endLine, type: cellType, metadata, text };
}

class StringInput implements Input {
    constructor(private content: string) { }

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
        if (cursor.node.parent === null) break;
    }

    // If we're at the Script node, find the first child that starts after the position
    if (cursor.type.name === "Script") {
        cursor.firstChild();
        while (cursor.from <= document.offsetAt(position) && cursor.nextSibling()) { }
        if (cursor.from > document.offsetAt(position) && cursor.prevSibling()) { }
    }

    if (!cursor.node) return null;

    let startNode = cursor.node;
    let endNode = cursor.node;
    let onlyCommentNodes = isCommentNode(startNode);

    // Traverse backwards to find the start of the cell
    while (startNode.prevSibling && !hasBlankLineBetween(code, startNode.prevSibling, startNode)) {
        startNode = startNode.prevSibling;
        onlyCommentNodes = onlyCommentNodes && isCommentNode(startNode);
    }

    // Traverse forwards to find the end of the cell
    while (endNode.nextSibling && !hasBlankLineBetween(code, endNode, endNode.nextSibling)) {
        endNode = endNode.nextSibling;
        onlyCommentNodes = onlyCommentNodes && isCommentNode(endNode);
    }

    const startPos = document.positionAt(startNode.from);
    const endPos = document.positionAt(endNode.to);
    const startLine = startPos.line;
    let endLine = endPos.line;

    let text = document.getText(new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length));

    // Remove trailing newlines from cell
    const trailingNewlines = text.match(/\n*$/)?.[0].length ?? 0;
    text = text.replace(/\n+$/, '');
    endLine -= trailingNewlines;

    const cellType = onlyCommentNodes ? 'markdown' : 'code';

    if (cellType === 'markdown') {
        text = stripMarkdownComments(text);
    }

    return { 
        startLine, 
        endLine, 
        type: cellType, 
        metadata: {}, 
        text 
    };
}

function isCommentNode(node: SyntaxNode): boolean {
    return node.type.name === "Comment";
}

function hasBlankLineBetween(code: string, node1: SyntaxNode, node2: SyntaxNode): boolean {
    if (!node1 || !node2 || node1.to >= node2.from) {
        return false;
    }

    const trailingNewlineNode1 = code.slice(node1.from, node1.to).endsWith('\n') ? 1 : 0;
    const textBetween = code.slice(node1.to, node2.from);
    const totalNewlines = trailingNewlineNode1 + (textBetween.match(/\n/g) || []).length;

    return totalNewlines > 1;
}

export function parseMetadata(line: string): Record<string, string> {
    const metadata: Record<string, string> = {};
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
    activeFlashes: new Set<vscode.Range>(),

    initTypes() {
        const accentColor = new vscode.ThemeColor('saccade.accentColor');
        const cellBorderWidth = config.get('currentCell.borderWidth', '0');

        this.types = {
            cellTopAbove: this.createDecoration({
                isWholeLine: true,
                borderColor: accentColor,
                borderStyle: 'solid',
                borderWidth: `0 0 ${cellBorderWidth} 0`,
            }),
            cellTopOn: this.createDecoration({
                isWholeLine: true,
                borderColor: accentColor,
                borderStyle: 'solid',
                borderWidth: `${cellBorderWidth} 0 0 0`,
            }),
            cellBottomBelow: this.createDecoration({
                borderColor: accentColor,
                borderStyle: 'solid',
                borderWidth: `${cellBorderWidth} 0 0 0`,
                isWholeLine: true,
            }),
            cellBottomOn: this.createDecoration({
                borderColor: accentColor,
                borderStyle: 'solid',
                borderWidth: `0 0 ${cellBorderWidth} 0`,
                isWholeLine: true,
            }),
            evaluating: this.createDecoration({
                backgroundColor: accentColor,
                isWholeLine: true,
                overviewRulerColor: accentColor,
                overviewRulerLane: vscode.OverviewRulerLane.Full,
            }),
        };
    },

    apply(editor: vscode.TextEditor, range: vscode.Range | null, decorationType: vscode.TextEditorDecorationType) {
        if (range) {
            if (decorationType === this.types.evaluating) {
                this.activeFlashes.add(range);
            }
            editor.setDecorations(decorationType, decorationType === this.types.evaluating ? Array.from(this.activeFlashes) : [range]);
        }
    },

    getCellRange(editor: vscode.TextEditor, cell: Cell | null): vscode.Range | null {
        if (!cell) return null;
        return new vscode.Range(cell.startLine, 0, cell.endLine, editor.document.lineAt(cell.endLine).text.length);
    },

    decorateCurrentCell(editor: vscode.TextEditor, cell: Cell | null) {
        this.clearAllDecorations(editor);

        if (!config.get("currentCell.show", true)) {
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

    flashCell(editor: vscode.TextEditor, cell: Cell | null): Promise<vscode.Disposable> {
        return new Promise((resolve) => {
            const range = this.getCellRange(editor, cell);
            if (range) {
                this.apply(editor, range, this.types.evaluating);
                const disposable = {
                    dispose: () => {
                        this.activeFlashes.delete(range);
                        editor.setDecorations(this.types.evaluating, Array.from(this.activeFlashes));
                    }
                };
                setTimeout(() => resolve(disposable), 200);
            } else {
                resolve({ dispose: () => {} });
            }
        });
    },

    clearAllDecorations(editor: vscode.TextEditor) {
        this.activeFlashes.clear();
        Object.values(this.types).forEach(decorationType => {
            editor.setDecorations(decorationType, []);
        });
    },

    dispose() {
        Object.values(this.types).forEach(decorationType => decorationType.dispose());
        this.activeFlashes.clear();
    }
};

function processCell(cellText: string, cellType: 'code' | 'markdown'): string {
    
    function wrapMarkdown(text: string) {
        if (/^\s*-[-*]-/.test(text)) {
            return text.split('\n').map(line => `# -${line}`).join('\n');
        } else {
            return `display(Markdown(${JSON.stringify(text)}))`;
        }
    }
    if (cellType === 'markdown') {
        return wrapMarkdown(cellText);
    }

    const lines = cellText.split('\n');
    let processedLines: string[] = [];
    let markdownChunk: string[] = [];
    let hasMarkdown = false;

    function processMarkdownChunk() {
        const markdownContent = markdownChunk.join('\n').trim();
        if (markdownContent) {
            processedLines.push(wrapMarkdown(markdownContent));
            hasMarkdown = true;
        }
        markdownChunk = [];
    }

    for (const line of lines) {
        if (line.match(/^#(?!\s*%)/)) {
            markdownChunk.push(line.slice(1).trim());
        } else {
            if (markdownChunk.length > 0) {
                processMarkdownChunk();
            }
            processedLines.push(line);
        }
    }

    if (markdownChunk.length > 0) {
        processMarkdownChunk();
    }

    if (hasMarkdown) {
        processedLines.unshift('# \nfrom IPython.display import display, Markdown');
    }

    return processedLines.join('\n');
}

async function evaluateCell(editor: vscode.TextEditor, cell: Cell | null): Promise<void> {
    if (!cell) {
        vscode.window.showErrorMessage('No cell found at cursor position');
        return;
    }

    const flashDisposable = decorations.flashCell(editor, cell);

    try {
        const renderMarkdown = config.get('renderMarkdownWithinCells', true) || cell.type === 'markdown';
        const source = renderMarkdown ? processCell(cell.text, cell.type) : cell.text;
        await vscode.commands.executeCommand('jupyter.execSelectionInteractive', source);
    } finally {
        (await flashDisposable).dispose();
    }
}

function moveToNextExplicitCell(editor: vscode.TextEditor, currentCell: Cell): void {
    const document = editor.document;
    let nextLine = currentCell.endLine + 1;

    while (nextLine < document.lineCount) {
        const line = document.lineAt(nextLine).text;
        if (topMarkerRegex.test(line)) {
            const newPosition = new vscode.Position(nextLine, 0);
            editor.selection = new vscode.Selection(newPosition, newPosition);
            editor.revealRange(new vscode.Range(newPosition, newPosition), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            break;
        }
        nextLine++;
    }
}

function moveToNextCell(editor: vscode.TextEditor, currentCell: Cell): void {
    if (!currentCell) {return;};
    if (config.get('useExplicitCellsIfPresent', false) && checkForExplicitMarkers(editor.document)) {
        moveToNextExplicitCell(editor, currentCell);
        return;
    }
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

function parseCells(document: vscode.TextDocument, upToLine?: number): Cell[] {
    const cells: Cell[] = [];
    let currentLine = 0;
    const lastLine = upToLine !== undefined ? Math.min(upToLine, document.lineCount - 1) : document.lineCount - 1;

    while (currentLine <= lastLine) {
        const cell = getCellAtPosition(document, new vscode.Position(currentLine, 0));
        if (cell) {
            cells.push(cell);
            // Move to the next non-empty line after the current cell
            currentLine = cell.endLine + 1;
            while (currentLine <= lastLine && document.lineAt(currentLine).isEmptyOrWhitespace) {
                currentLine++;
            }
        } else {
            // If no cell is found, move to the next non-empty line
            do {
                currentLine++;
            } while (currentLine <= lastLine && document.lineAt(currentLine).isEmptyOrWhitespace);
        }
    }

    return cells;
}

async function evaluateCellsAboveAndCurrent(editor: vscode.TextEditor): Promise<void> {
    // TODO
    // figure out how to run cells in the active kernel without showing the result 
    // in the interactive window. Then we should be able to show the currently active 
    // cell in the scrollbar area. 

    const document = editor.document;
    const currentPosition = editor.selection.active;

    const currentCell = getCellAtPosition(document, currentPosition);
    if (!currentCell) {
        return; // Exit if no current cell is found
    }

    const originalSelection = editor.selection;
    const endOfCurrentCell = new vscode.Position(currentCell.endLine, document.lineAt(currentCell.endLine).text.length);
    editor.selection = new vscode.Selection(endOfCurrentCell, endOfCurrentCell);

    vscode.commands.executeCommand('jupyter.runtoline');
    
    editor.selection = originalSelection;
    
}

function isStandardEditor(editor: vscode.TextEditor | undefined): boolean {
    return editor !== undefined &&
        editor.document.languageId === 'python' &&
        editor.viewColumn !== undefined;
}

async function evaluateSelection(editor: vscode.TextEditor): Promise<void> {
    if (!editor.selection.isEmpty) {
        // If there's a selection, evaluate it
        const selectedText = editor.document.getText(editor.selection);
        await evaluateCell(editor, {
            startLine: editor.selection.start.line,
            endLine: editor.selection.end.line,
            type: 'code',
            metadata: {},
            text: selectedText
        });
    }
}

function generateNotebook(document: vscode.TextDocument): any {
    const cells = parseCells(document);
    const notebookCells = cells.map(cell => ({
        cell_type: cell.type,
        source: cell.text.split('\n'),
        metadata: cell.metadata,
        outputs: []
    }));

    return {
        nbformat: 4,
        nbformat_minor: 2,
        metadata: {
            kernelspec: {
                display_name: "Python 3",
                language: "python",
                name: "python3"
            },
            language_info: {
                codemirror_mode: {
                    name: "ipython",
                    version: 3
                },
                file_extension: ".py",
                mimetype: "text/x-python",
                name: "python",
                nbconvert_exporter: "python",
                pygments_lexer: "ipython3",
                version: "3.8.0"
            }
        },
        cells: notebookCells
    };
}

export function activate(context: vscode.ExtensionContext) {
    try {
        let disposables: vscode.Disposable[] = [];

        decorations.initTypes();

        disposables.push(vscode.commands.registerCommand('extension.evaluateCell', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && isStandardEditor(editor)) {
                if (!editor.selection.isEmpty) {
                    await evaluateSelection(editor);
                } else {
                    await evaluateCell(editor, getCellAtPosition(editor.document, editor.selection.active));
                }
            }
        }));

        disposables.push(vscode.commands.registerCommand('extension.evaluateImplicitCell', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && isStandardEditor(editor)) {
                if (!editor.selection.isEmpty) {
                    await evaluateSelection(editor);
                } else {
                    await evaluateCell(editor, getImplicitCell(editor.document, editor.selection.active));
                }
            }
        }));

        disposables.push(vscode.commands.registerCommand('extension.evaluateCellAndMoveNext', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && isStandardEditor(editor)) {
                const cell = getCellAtPosition(editor.document, editor.selection.active);

                if (cell) {
                    await evaluateCell(editor, cell);
                    moveToNextCell(editor, cell);
                }
            }
        }));

        disposables.push(vscode.commands.registerCommand('extension.evaluateCellAndAbove', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && isStandardEditor(editor)) {
                await evaluateCellsAboveAndCurrent(editor);
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

        disposables.push(vscode.commands.registerCommand('extension.generateNotebook', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && isStandardEditor(editor)) {
                const notebook = generateNotebook(editor.document);
                const currentFilePath = editor.document.fileName;
                const notebookPath = currentFilePath.replace(/\.py$/, '.ipynb');
                
                fs.writeFile(notebookPath, JSON.stringify(notebook, null, 2), (err) => {
                    if (err) {
                        vscode.window.showErrorMessage(`Failed to save notebook: ${err.message}`);
                    } else {
                        vscode.window.showInformationMessage(`Notebook saved to ${notebookPath}`);
                    }
                });
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