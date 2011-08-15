/* -*- Mode: JavaScript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */

function assertEqual(a, b) {
    function fail(av, bv, where) {
        function shortToString(v) {
            if (v === -0)
                return "-0";
            var s = typeof v;
            if (v === null || s === 'boolean' || s === 'number' || s === 'string')
                s = uneval(v);
            return s;
        }
        var astr = shortToString(av), bstr = shortToString(bv);
        throw new Error("got A" + where + " = " + astr + ", expected B" + where + " = " + bstr);
    }

    var ab = WeakMap();
    var ba = WeakMap();
    var queue = [[a, b, '']];

    for (var i = 0; i < queue.length; i++) {
        var item = queue[i];
        var av = item[0], bv = item[1], where = item[2];
        switch (typeof av) {
        case 'undefined':
        case 'boolean':
        case 'string':
        case 'number':
            if (av !== bv)
                fail(av, bv, where);
            break;

        case 'object':
            if (av === null) {
                if (bv !== null)
                    fail(av, bv, where);
                break;
            } else if (bv === null || typeof bv !== 'object') {
                fail(av, bv, where);
            } else if (ab.has(av)) {
                if (bv !== ab.get(av))
                    fail(av, bv, where);
                break;
            } else {
                ab.set(av, bv);
                ba.set(bv, av);

                var acls = Object.prototype.toString.call(av),
                    bcls = Object.prototype.toString.call(bv);
                if (acls !== bcls)
                    fail(av, bv, where);

                var anames = Object.keys(av), bnames = Object.keys(bv);
                if (anames.length != bnames.length)
                    fail(av, bv, where);
                for (var j = 0; j < anames.length; j++) {
                    var name = bnames[j];
                    var here = where + "." + name;
                    if (name !== anames[j])
                        fail(av, bv, here);
                    var adesc = Object.getOwnPropertyDescriptor(av, name),
                        bdesc = Object.getOwnPropertyDescriptor(bv, name);
                    if (adesc.configurable !== bdesc.configurable)
                        fail(av, bv, here + ".[[Configurable]]");
                    if (adesc.enumerable !== bdesc.enumerable)
                        fail(av, bv, here + ".[[Enumerable]]");
                    if (adesc.writable !== bdesc.writable)
                        fail(av, bv, here + ".[[Writable]]");
                    var props = ["get", "set", "value"];
                    var names = ["[[Get]]", "[[Set]]", "[[Value]]"];
                    for (var i = 0; i < props.length; i++) {
                        var prop = props[i];
                        var there = here + "." + names[i];
                        if ((prop in adesc) !== (prop in bdesc))
                            fail(av, bv, there);
                        if (prop in adesc)
                            queue.push([adesc[prop], bdesc[prop], there]);
                    }
                }
            }
            break;

        case 'function':
            // Two functions are considered equal if they decompile to the same
            // source code, regardless of anything else.
            if (typeof bv !== 'function')
                fail(av, bv, where);
            if (String(bv) !== String(av))
                fail(av, bv, where);
            break;

        default:
            fail(av, bv, where);
        }
    }
}

function test(code, expected) {
    var obj = Sharps.parse(code);
    assertEqual(obj, expected);
}

function testSharpsLite() {
    try {
        test("[#1=[], #1#]",
             let (obj = [[], 1]) (obj[1] = obj[0], obj));
        test('{"q": #1=[#1#]}',
             let (arr = [1]) (arr[0] = arr, {q: arr}));
        test('#1={"me":#1#}',
             let (obj = {me: 1}) (obj.me = obj, obj));
        test('#1={"parent": null, "children":[{"children": [], "parent": #1#}]}',
             let (obj = {parent: null, children:[{children: [], parent: 1}]}) (obj.children[0].parent = obj, obj));
        test('#1=[true, true, [false, true, #2=[#2#, #1#]]]',
             let (arr1 = [true, true, [false, true, 0]], arr2=[0, 0]) (arr1[2][2] = arr2, arr2[0] = arr2, arr2[1] = arr1, arr1));
        test('{"objects": [#1={"prev": null, "next": #2={"prev": #1#, "next": #3={"prev": #2#, "next": null}}}, #2#, #3#]}',
             let (arr = [{prev: null}, {}, {next: null}]) (arr[0].next = arr[1],
                                                           arr[1].prev = arr[0],
                                                           arr[1].next = arr[2],
                                                           arr[2].prev = arr[1],
                                                           {objects: arr}));
    } catch (exc) {
        print(exc.stack);
        print(exc);
    }
}

function testSharpsFull() {
    try {
        test("[#1=[], #1#]",
             let (obj = [[], 1]) (obj[1] = obj[0], obj));
        test("{__proto__: #1=[#1#]}",
             let (arr = [1]) (arr[0] = arr, {__proto__: arr}));
        test("#1={me:#1#}",
             let (obj = {me: 1}) (obj.me = obj, obj));
        test("#1={parent: null, children:[{children: [], parent: #1#}]}",
             let (obj = {parent: null, children:[{children: [], parent: 1}]}) (obj.children[0].parent = obj, obj));
        test("#1=[,,, [,,,, #2=[#2#, #1#]]]",
             let (arr1 = [,,, [,,,, 0]], arr2=[0, 0]) (arr1[3][4] = arr2, arr2[0] = arr2, arr2[1] = arr1, arr1));
        test(uneval(Sharps), Sharps);
    } catch (exc) {
        print(exc.stack);
        print(exc);
    }
}

load("sharps-lite.js");
testSharpsLite();

load("lib/jsdefs.js");
load("lib/jslex.js");
load("lib/jsparse.js");
load("lib/jsdecomp.js");
load("sharps-full.js");
testSharpsFull();

print("Tests passed.");
