/* -*- Mode: C++; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */

// sharps-full.js - Parser for sharp object literals where values may be JS functions.
//
// To use this file, concatenate it with lib/jsdefs.js, lib/jslex.js,
// lib/jsparse.js, and lib/decomp.js, then run it through your favorite JS code
// compressor. This file provides a single function:
//
//     Sharps.parse(str) - Parse the string as a JS expression with
//         sharp object syntax. Return its value.

var Sharps = (function () {
    var TOK = Narcissus.definitions.tokenIds;

    // The basic algorithm:
    //
    // Sharp defs, #nnn=[...] or #mmm={...}, are translated directly into
    // assignment expressions $S[nnn]=[...] or $S[mmm]={...}.
    //
    // Each object literal or array literal that directly contains a sharp ref:
    //   { ..., a: #nnn#, ...}
    //   [ ..., #mmm#, ...]
    // is assigned a number if it doesn't already have a number by virtue of a
    // sharpdef. Thus these may be translated to
    //   ($S[j] = { ... a: 0, ...})
    //   ($S[k] = [ ... 0, ...])
    // where j and k are chosen arbitrarily. The 0 is just a placeholder.
    //
    // The entire AST is translated this way; and then each object that had a
    // sharp ref is fixed up by assigning, for example:
    //   $S[j].a = $S[nnn]
    //   $S[k][5] = $S[mmm]
    //
    // The AST and the fixup assignments are bundled together in a function that
    // evaluates them and returns the appropriate object. The final result is a
    // call-expression that calls this function.
    //
    // Example:
    //   #1=[#1#]
    // This is translated by replacing the sharpref #1# with 0 and replacing the 
    // sharpdef #1=[...] with $S[1]=[...]. So the translation is $S[1]=[0].
    // The fixup assignment for the #1# is $S[1][0] = $S[1].
    // The final result of combining the translation with the fixup is:
    //   (function ($S) { return [$S[1]=[0]][$S[1][0] = $S[1], 0]; })([])
    function parse(s) {
        var ast = Narcissus.parser.parse("(" + s + ");");
        if (ast.type !== TOK.SCRIPT)
            throw SyntaxError("parser internal error");
        if (ast.children.length !== 1)
            throw SyntaxError("expected a single expression");
        ast = ast.children[0];
        if (ast.type !== TOK.SEMICOLON)
            throw SyntaxError("expected a single expression, not a statement");
        ast = ast.expression;

        // Node constructors.
        var tokenizer = ast.tokenizer;
        function assign(l, r) {
            var x = new Narcissus.parser.Node(tokenizer, {type: TOK.ASSIGN});
            x.push(l);
            x.push(r);
            return x;
        }
        function index(a, b) {
            var x = new Narcissus.parser.Node(tokenizer, {type: TOK.INDEX});
            x.push(a);
            x.push(b);
            return x;
        }
        function dot(a, b) {
            var x = new Narcissus.parser.Node(tokenizer, {type: TOK.DOT});
            x.push(a);
            x.push(b);
            return x;
        }
        function identifier(id) {
            return new Narcissus.parser.Node(tokenizer, {type: TOK.IDENTIFIER, value: id});
        }
        function number(v) {
            return new Narcissus.parser.Node(tokenizer, {type: TOK.NUMBER, value: v});
        }
        function string(v) {
            return new Narcissus.parser.Node(tokenizer, {type: TOK.STRING, value: v});
        }
        function seq(arr) {
            var x = new Narcissus.parser.Node(tokenizer, {type: TOK.COMMA});
            for (var i = 0; i < arr.length; i++)
                x.push(arr[i]);
            return x;
        }
        function arrayInit(arr) {
            var x = new Narcissus.parser.Node(tokenizer, {type: TOK.ARRAY_INIT});
            for (var i = 0; i < arr.length; i++)
                x.push(arr[i]);
            return x;
        }
        function prog0(arr) {
            // prog0([n, n1...]) ==> `[n][(n1..., 0)]`
            var first = arr[0];
            if (arr.length === 1)
                return first;
            var rest = arr.slice(1);
            rest.push(number(0));
            return index(arrayInit([first]), seq(rest));
        }

        var sharpVars = [];
        var nextSyntheticId = 0;
        var syntheticIndexNodes = [];
        var fixups = [];

        function translateNode(n, objid) {
            var objidIsSharpIndex = objid !== undefined;
            switch (n.type) {
            case TOK.OBJECT_INIT:
                var arr = n.children;
                for (var j = 0; j < arr.length; j++) {
                    var pi = arr[j];
                    //assertEq(pi.type, TOK.PROPERTY_INIT);
                    var pair = pi.children;
                    //assertEq(pair.length, 2);
                    var id = pair[0], expr = pair[1];
                    //assertEq(id.type, TOK.IDENTIFIER);
                    if (expr.type === TOK.SHARPREF) {
                        if (sharpVars[expr.value] === undefined)
                            throw new SyntaxError("Sharp variable used before definition");
                        if (objid === undefined)
                            objid = nextSyntheticId++;
                        fixups.push([objid, objidIsSharpIndex, id.value, expr.value]);
                        pair[1] = number(0);
                    } else {
                        pair[1] = translateNode(expr);
                    }
                }
                break;

            case TOK.ARRAY_INIT:
                var arr = n.children;
                for (var j = 0; j < arr.length; j++) {
                    var expr = arr[j];
                    if (expr === null)
                        continue;

                    if (expr.type === TOK.SHARPREF) {
                        if (sharpVars[expr.value] === undefined)
                            throw new SyntaxError("Sharp variable used before definition");
                        if (objid === undefined)
                            objid = nextSyntheticId++;
                        fixups.push([objid, objidIsSharpIndex, j, expr.value]);
                        arr[j] = number(0);
                    } else {
                        arr[j] = translateNode(expr);
                    }
                }
                break;

            case TOK.SHARPDEF:
                if (n.value in sharpVars)
                    throw new SyntaxError("Sharp variable multiply defined");
                sharpVars[n.value] = true;
                var payload = translateNode(n.children[0], n.value);
                return assign(index(identifier("$S"), number(n.value)), payload);

            case TOK.SHARPREF:
                throw new SyntaxError("Sharp variable reference in unsupported position");

            default:
                return n;
            }

            if (objidIsSharpIndex || objid === undefined)
                return n;

            var idx = number(objid);
            syntheticIndexNodes.push(idx);
            return assign(index(identifier("$S"), idx), n);
        }


        var arr = [translateNode(ast)];
        var result;
        if (sharpVars.length === 0) {
            result = s;
        } else {
            // All the synthetic index numbers we came up with must be incremented
            // so as not to conflict with any sharp variable number.
            for (var i = 0; i < syntheticIndexNodes.length; i++)
                syntheticIndexNodes[i].value += sharpVars.length;

            for (var i = 0; i < fixups.length; i++) {
                var f = fixups[i];
                var objid = f[0], objidIsSharpIndex = f[1], propid = f[2], sharpid = f[3];
                if (!objidIsSharpIndex)
                    objid += sharpVars.length;
                var objexpr = index(identifier("$S"), objid);
                var propexpr;
                if (typeof propid === 'number')
                    propexpr = index(objexpr, number(propid));
                else if (/^[A-Za-z_$][0-9A-Za-z_$]*$/.exec(propid) === null)
                    propexpr = index(objexpr, string(propid));
                else
                    propexpr = dot(objexpr, identifier(propid));
                var sharpobjexpr = index(identifier("$S"), number(sharpid));
                arr.push(assign(propexpr, sharpobjexpr));
            }

            var expr = Narcissus.decompiler.pp(prog0(arr));
            result = "(function($S){return " + expr + ";}([]))";
        }

        var indirectEval = eval;
        return indirectEval(result);
    }

    return {parse: parse};
})();
