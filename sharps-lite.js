/* -*- Mode: JavaScript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/*
 * Sharps.parse is a JSON parser extended to handle cyclic object graphs using
 * "sharp object" syntax.
 *
 * The syntax uses a label of the form #nnn= before any object or array; once
 * the label has been seen, the object can be included in more than one place
 * in the graph by using a backreference of the form #nnn#. For example, a
 * circular linked list of three objects could be written like this:
 *
 *     #1={"next": {"next": {"next": #1#}}}
 *
 * A circular doubly-linked list with three objects requires labels for all
 * three objects:
 *
 *     #1={"prev": #3={"prev":#2={"prev": #1#, "next": #3#}, "next": #1#},
 *         "next": #2#}
 */

var Sharps = (function () {
    function tokenize(s) {
        var token = /\s*([\[\]{}:,]|true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[Ee][-+]?[0-9]+)?|"(?:[^"\\\u0000-\u001f]|\\["\\\/bfnrt]|\\u[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f])*"|#[1-9][0-9]*[=#])/g;

        var tokens = [];
        var m;
        var i = 0;
        while ((m = token.exec(s)) !== null) {
            if (m.index !== i)
                break;
            tokens.push(m[1]);
            i = token.lastIndex;
        }
        if (i !== s.length)
            throw new SyntaxError("invalid character 0x" + s.charCodeAt(i).toString(16) + " at offset " + i);
        return tokens;
    }

    function parse(s) {
        var tokens = tokenize(s);
        var p = 0;
        var parseJSON = JSON.parse || eval;

        function peek() {
            if (p >= tokens.length)
                throw new SyntaxError("Unexpected end of string");
            return tokens[p];
        }

        var sharps = [];

        function objectLiteral(sharpid) {
            // peek() === '{' here
            p++;
            var obj = {};
            if (sharpid !== undefined)
                sharps[sharpid] = obj;

            if (peek() !== '}') {
                for (;;) {
                    var t = peek();
                    if (t.charAt(0) !== '"')
                        throw new SyntaxError("expected string property name in object literal");
                    var key = parseJSON(t);
                    p++;

                    if (peek() !== ':')
                        throw new SyntaxError("expected ':' after property name in object literal");
                    p++;

                    var v = val();
                    Object.defineProperty(obj, key, {configurable: true, enumerable: true, writable: true, value: v});

                    t = peek();
                    if (t === ',')
                        p++;
                    else if (t === '}')
                        break;
                    else
                        throw new SyntaxError("expected ',' or '}' next in an object literal");
                }
            }
            // peek() === '}' here
            p++;
            return obj;
        }

        function arrayLiteral(sharpid) {
            // peek() === '[' here
            p++;
            var arr = [];
            if (sharpid !== undefined)
                sharps[sharpid] = arr;

            if (peek() !== ']') {
                for (var j = 0; ; j++) {
                    var v = val();
                    Object.defineProperty(arr, j, {configurable: true, enumerable: true, writable: true, value: v});

                    var t = peek();
                    if (t === ',')
                        p++;
                    else if (t === ']')
                        break;
                    else
                        throw new SyntaxError("expected ',' or ']' after an array element")
                }
            }
            p++;
            return arr;
        }

        function val() {
            var t = peek();
            if (t === '[')
                return arrayLiteral(undefined);
            if (t === '{')
                return objectLiteral(undefined);

            var c = t.charAt(0);
            if (t === 'true' || t === 'false' || t === 'null' || c === '"' || c === '-' || (c >= '0' && c <= '9')) {
                p++;
                return parseJSON(t);
            }
            if (c === '#') {
                var sharpid = Number(t.substring(1, t.length - 1));

                if (t.charAt(t.length - 1) === '#') {
                    // sharpref
                    if (!(sharpid in sharps))
                        throw new SyntaxError("sharp object #" + sharpid + " used before definition");
                    p++;
                    return sharps[sharpid];
                }

                // sharpdef
                if (sharpid in sharps)
                    throw new SyntaxError("sharp object #" + sharpid + " defined more than once");
                p++;

                if (peek() == '{')
                    return objectLiteral(sharpid);
                else if (peek() == '[')
                    return arrayLiteral(sharpid);
                else
                    throw new SyntaxError("object or array literal expected after " + t);
            }

            throw new SyntaxError("unexpected token: " + t);
        }

        var v = val();
        if (p != tokens.length)
            throw new SyntaxError("unexpected extra characters after JSON+sharps data");
        return v;
    }

    return {parse: parse};
})();
