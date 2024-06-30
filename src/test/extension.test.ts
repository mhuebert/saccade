import * as assert from 'assert';
import * as vscode from 'vscode';
import * as extension from '../../src/extension';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('getCellAtPosition returns correct cell', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: '# %%\nprint("Hello")\n\n# %%\nprint("World")',
            language: 'python'
        });
        const editor = await vscode.window.showTextDocument(document);

        // Test first cell
        const cell1 = extension.getCellAtPosition(document, new vscode.Position(1, 0));
        assert.strictEqual(cell1?.startLine, 0);
        assert.strictEqual(cell1?.endLine, 1);
        assert.strictEqual(cell1?.type, 'code');

        // Test second cell
        const cell2 = extension.getCellAtPosition(document, new vscode.Position(4, 0));
        assert.strictEqual(cell2?.startLine, 3);
        assert.strictEqual(cell2?.endLine, 4);
        assert.strictEqual(cell2?.type, 'code');
    });

    test('parseMetadata correctly parses cell metadata', () => {
        const metadata = extension.parseMetadata('# %% [markdown] tag="test" id="123"');
        assert.deepStrictEqual(metadata, { tag: 'test', id: '123' });
    });

    test('highlightCell correctly highlights cell', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: '# %%\nprint("Hello")\n\n# %%\nprint("World")',
            language: 'python'
        });
        const editor = await vscode.window.showTextDocument(document);

        const cell = extension.getCellAtPosition(document, new vscode.Position(1, 0));
        extension.highlightCell(editor, cell);

        // You might need to add a small delay here to allow for the decoration to be applied
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check if the decoration has been applied correctly
        // This part might need to be adjusted based on how you can access the applied decorations
    });
});
