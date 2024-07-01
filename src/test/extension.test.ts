import * as assert from 'assert';
import * as vscode from 'vscode';
import * as extension from '../extension';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('getCellAtPosition returns correct cell for explicit markers', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: '# %%\nprint("Hello")\n\n# %%\nprint("World")',
            language: 'python'
        });

        // Test first cell
        const cell1 = extension.getCellAtPosition(document, new vscode.Position(1, 0));
        assert.strictEqual(cell1?.text, 'print("Hello")\n');

        // Test second cell
        const cell2 = extension.getCellAtPosition(document, new vscode.Position(4, 0));
        assert.strictEqual(cell2?.text, 'print("World")');
    });

    test('getCellAtPosition returns correct cell for implicit blocks', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: 'def func1():\n    print("Hello")\n\ndef func2():\n    print("World")',
            language: 'python'
        });

        // Test first function
        const cell1 = extension.getCellAtPosition(document, new vscode.Position(0, 0));
        assert.strictEqual(cell1?.text, 'def func1():\n    print("Hello")');

        // Test second function
        const cell2 = extension.getCellAtPosition(document, new vscode.Position(3, 0));
        assert.strictEqual(cell2?.text, 'def func2():\n    print("World")');
    });

    test('getCellAtPosition handles empty lines between blocks', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: 'def func1():\n    print("Hello")\n\n\ndef func2():\n    print("World")',
            language: 'python'
        });

        // Test first function
        const cell1 = extension.getCellAtPosition(document, new vscode.Position(0, 0));
        assert.strictEqual(cell1?.text, 'def func1():\n    print("Hello")');

        // Test second function
        const cell2 = extension.getCellAtPosition(document, new vscode.Position(4, 0));
        assert.strictEqual(cell2?.text, 'def func2():\n    print("World")');
    });

    test('getCellAtPosition handles nested blocks', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: 'def outer():\n    print("Outer")\n    def inner():\n        print("Inner")\n    inner()',
            language: 'python'
        });

        // Test outer function
        const cell = extension.getCellAtPosition(document, new vscode.Position(0, 0));
        assert.strictEqual(cell?.text, 'def outer():\n    print("Outer")\n    def inner():\n        print("Inner")\n    inner()');
    });

    test('getCellAtPosition handles cursor at beginning of def', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: 'def func1():\n    print("Hello")\n\ndef func2():\n    print("World")',
            language: 'python'
        });

        // Test cursor at beginning of first function
        const cell1 = extension.getCellAtPosition(document, new vscode.Position(0, 0));
        assert.strictEqual(cell1?.text, 'def func1():\n    print("Hello")');

        // Test cursor at beginning of second function
        const cell2 = extension.getCellAtPosition(document, new vscode.Position(3, 0));
        assert.strictEqual(cell2?.text, 'def func2():\n    print("World")');
    });

    test('getCellAtPosition handles cursor in middle of nested def', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: 'def outer():\n    print("Outer")\n    def inner():\n        print("Inner")\n    inner()',
            language: 'python'
        });

        // Test cursor in middle of inner function
        const cell = extension.getCellAtPosition(document, new vscode.Position(3, 4));
        assert.strictEqual(cell?.text, 'def outer():\n    print("Outer")\n    def inner():\n        print("Inner")\n    inner()');
    });

    test('getCellAtPosition treats blocks separated by empty comment lines as one block', async () => {
        const document = await vscode.workspace.openTextDocument({
            content: 'def func1():\n    print("Hello")\n#\n    print("Still in func1")\n\ndef func2():\n    print("World")',
            language: 'python'
        });

        // Test first function with empty comment line
        const cell1 = extension.getCellAtPosition(document, new vscode.Position(0, 0));
        assert.strictEqual(cell1?.text, 'def func1():\n    print("Hello")\n#\n    print("Still in func1")');

        // Test second function
        const cell2 = extension.getCellAtPosition(document, new vscode.Position(5, 0));
        assert.strictEqual(cell2?.text, 'def func2():\n    print("World")');
    });

    test('parseMetadata correctly parses cell metadata', () => {
        const metadata = extension.parseMetadata('# %% [markdown] tag="test" id="123"');
        assert.deepStrictEqual(metadata, { tag: 'test', id: '123' });
    });

});

