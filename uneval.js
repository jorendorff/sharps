/* -*- Mode: JavaScript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*-
 *
 * uneval.js - ES5 implementation of uneval and obj.toSource().
 */

(function (global) {
    "use strict";

    // Isolate this code from the mutable globals as much as possible. toSource
    // will continue to work even if global names are deleted or replaced. Of
    // course if the names are tampered with before this file is loaded,
    // there's not much we can do.
    var builtin_isArray = Array.isArray;
    var builtin_Object = Object;
    var builtin_getOwnPropertyNames = Object.getOwnPropertyNames;
    var builtin_getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    var builtin_TypeError = TypeError;
    var builtin_toString = {}.toString;
    var builtin_hasOwnProperty = {}.hasOwnProperty;
    var builtin_call = Function.prototype.call;
    var HasOwnProperty = builtin_call.bind(builtin_hasOwnProperty);
    var builtin_match = builtin_call.bind("".match);
    var builtin_replace = builtin_call.bind("".replace);
    var builtin_slice = builtin_call.bind("".slice);
    var builtin_Function_toString = builtin_call.bind(Function.prototype.toString);
    var builtin_RegExp_toString = builtin_call.bind(/x/.toString);
    var builtin_Date_valueOf = builtin_call.bind(Date.prototype.valueOf);
    var builtin_Boolean_valueOf = builtin_call.bind(Boolean.prototype.valueOf);
    var builtin_Number_valueOf = builtin_call.bind(Number.prototype.valueOf);
    var builtin_String_valueOf = builtin_call.bind(String.prototype.valueOf);

    var parensRegExp = /^[(]((?:.|\n)*)[)]$/;
    var functionRegExp = /^[^ ]* [^\(]*(\((?:.|\n)*)$/;

    // Pure-ES5 implementation of Map for JS implementations that don't have
    // WeakMap.
    function Map() { 
        this.keys = [];
        this.vals = [];
    }
    Map.prototype.get = function (key) {
        var keys = this.keys, n = keys.length;
        for (var i = 0; i < n; i++) {
            if (keys[i] === key)
                return this.vals[i];
        }
        return undefined;
    };
    Map.prototype.set = function (key, val) {
        var keys = this.keys, n = keys.length;
        for (var i = 0; i < n; i++) {
            if (keys[i] === key)
                break;
        }
        this.vals[i] = val;
    };

    // If the implementation provides WeakMap, that will be faster.
    if (typeof WeakMap === 'function')
        Map = WeakMap;

    function IsObject(v) {
        return v !== null && (typeof v === 'object' || typeof v === 'function' || typeof v === 'xml');
    }

    function IsFunctionObject(v) {
        return typeof v === 'function';
    }

    function ToObject(v) {
        return builtin_Object(v);
    }

    function ToUint32(value) {
        return value >>> 0;
    }

    function ToString(value) {
        // Plain ("" + value) is ToString(ToPrimitive(value)). The difference
        // is observable if value is an object with a valueOf method.
        return IsObject(value) ? builtin_Array_join([value]) : "" + value;
    }

    function Enumerate(obj) {
        var a = [];
        var w = 0;
        var all = builtin_getOwnPropertyNames(obj);
        for (var r = 0, n = all.length; r < n; r++) {
            var id = all[r];
            var prop = builtin_getOwnPropertyDescriptor(obj, id);
            if (prop.enumerable) {
                prop.name = id;
                a[w++] = prop;
            }
        }
        return a;
    }

    var sharpObjectDepth = 0;
    var sharpObjectMap = undefined;
    var sharpgen = 0;

    function MarkSharpObjects(obj) {
        var he = sharpObjectMap.get(obj), props;

        if (he === undefined) {
            he = {sharpid: undefined, isSharp: false};
            sharpObjectMap.set(obj, he);

            props = Enumerate(obj);

            for (var i = 0, length = props.length; i < length; i++) {
                var prop = props[i];
                if (prop === undefined)
                    continue;

                var hasGetter = HasOwnProperty(prop, "get");
                var hasSetter = HasOwnProperty(prop, "set");
                if (hasGetter || hasSetter) {
                    if (hasGetter && IsObject(prop.get))
                        MarkSharpObjects(prop.get);
                    if (hasSetter && IsObject(prop.set))
                        MarkSharpObjects(prop.set);
                } else {
                    if (IsObject(prop.value))
                        MarkSharpObjects(prop.value);
                }
            }
        } else {
            if (he.sharpid === undefined)
                he.sharpid = ++sharpgen;
            props = undefined;
        }
        return [he, props];
    }

    function EnterSharpObject(obj) {
        var outermost = (sharpObjectMap === undefined);
        if (outermost)
            sharpObjectMap = new Map;

        try {
            var he, props = undefined;
            if (sharpObjectDepth === 0) {
                /*
                 * Although MarkSharpObjects tries to avoid invoking getters,
                 * it ends up doing so anyway under some circumstances; for
                 * example, if obj is a scripted Proxy, then
                 * Object.getOwnPropertyNames(obj) calls back into script. This
                 * could lead to LeaveSharpObject being called while
                 * MarkSharpObjects is still working.
                 *
                 * Increment sharpObjectDepth while we call MarkSharpObjects, to
                 * ensure that such a call doesn't free the hash table we're
                 * still using.
                 */
                sharpObjectDepth++;
                try {
                    [he, props] = MarkSharpObjects(obj);
                } finally {
                    sharpObjectDepth--;
                }
            } else {
                he = sharpObjectMap.get(obj);

                /*
                 * It's possible that the value of a property has changed from the
                 * first time the object's properties are traversed (when the property
                 * ids are entered into the hash table) to the second (when they are
                 * converted to strings), i.e., the JSObject::getProperty() call is not
                 * idempotent.
                 */
                if (he === undefined) {
                    he = {sharpid: undefined, isSharp: false};
                    sharpObjectMap.set(obj, he);
                }
            }

            var sharpchars = null;
            if (he.sharpid !== undefined)
                sharpchars = "#" + he.sharpid + (he.isSharp ? "#" : "=");

            if (!he.isSharp) {
                if (props === undefined)
                    props = Enumerate(obj);
                sharpObjectDepth++;
            }

            return [he, props, sharpchars];
        } finally {
            /* Clean up the sharpObjectMap on outermost error. */
            if (sharpObjectDepth === 0) {
                sharpgen = 0;
                sharpObjectMap = undefined;
            }
        }
    }

    function LeaveSharpObject() {
        if (sharpObjectDepth <= 0)
            throw new Error("internal error: unmatched LeaveSharpObject");
        if (--sharpObjectDepth === 0) {
            sharpgen = 0;
            sharpObjectMap = undefined;
        }
    }

    function IsIdentifier(idstr) {
        // (Unlike the original, this conservatively returns false for anything containing any
        // character outside the ASCII range.)
        return !!builtin_match(idstr, /^[A-Za-z_$][0-9A-Za-z_$]*$/);
    }

    function ValueToSource(v) {
        if (v === undefined)
            return "(void 0)";

        if (typeof v === 'string')
            return QuoteString(v, '"');

        /* Special case to preserve negative zero, _contra_ toString. */
        if (v === 0 && 1/v === 1/-0)
            return "-0";

        if (!IsObject(v))
            return "" + v;
        return ToString(TryMethod(v, "toSource"));
    }

    var EscapeMap = Object.create(null);
    EscapeMap['\b'] = '\\b';
    EscapeMap['\f'] = '\\f';
    EscapeMap['\n'] = '\\n';
    EscapeMap['\r'] = '\\r';
    EscapeMap['\t'] = '\\t';
    EscapeMap['\v'] = '\\v';
    EscapeMap['"'] =  '\\"';
    EscapeMap['\''] = '\\\'';
    EscapeMap['\\'] = '\\\\';

    function QuoteString(str, quote) {
        // Unlike the original js_QuoteString, this is not intended for use
        // escaping identifiers. quote should be '"' or "'".
        // This does NOT replicate bug 632019.
        var s = quote;
        for (var i = 0, n = str.length; i < n; i++) {
            var c = str[i];
            if (c >= '\x20' && c < '\x7f' && c !== quote && c != '\\' && c != '\t') {
                s += c;
            } else if (c in EscapeMap) {
                s += EscapeMap[c];
            } else {
                var ci = c.charCodeAt(0);
                var zero = 48; // '0'.charCodeAt(0);
                if (c < '\u0100') {
                    s += '\\x' + String.fromCharCode(zero + ((ci & 0xf0) >> 4), zero + (ci & 0xf));
                } else {
                    s += '\\u' + String.fromCharCode(zero + ((ci & 0xf000) >> 12),
                                                     zero + ((ci & 0x0f00) >> 8),
                                                     zero + ((ci & 0x00f0) >> 4),
                                                     zero + (ci & 0x000f));
                }
            }
        }
        return s + quote;
    }

    function TryMethod(obj, name) {
        /*
         * Report failure only if an appropriate method was found, and calling it
         * returned failure.  We propagate failure in this case to make exceptions
         * behave properly.
         */
        // This replicates a bug in the original: if obj[name] exists but is
        // not callable, the wrong error is reported, and this can result in
        // too much recursion trying to report the error.
        if (IsObject(obj[name]))
            return obj[name]();
        return obj;
    }

    function obj_toSource(obj) {
        /* If outermost, we need parentheses to be an expression, not a block. */
        var outermost = (sharpObjectDepth === 0);

        obj = ToObject(obj);

        var rec = EnterSharpObject(obj)
        var he = rec[0], props = rec[1], sharpchars = rec[2];

        /*
         * If he.isSharp, we didn't enter -- obj is already "sharp", meaning we've visited it
         * already in our depth first search, and therefore sharpchars contains a
         * string of the form "#n#".
         */
        if (he.isSharp)
            return sharpchars;

        try {
            var chars;
            if (!sharpchars) {
                chars = (outermost ? '(' : '');
            } else {
                /*
                 * EnterSharpObject returned a string of the form "#n=" in sharpchars.
                 * No need for parentheses around the whole shebang, because #n=
                 * unambiguously begins an object initializer, and never a block
                 * statement.
                 */
                he.isSharp = true;
                chars = sharpchars;
                outermost = false;
            }

            chars += '{';
            var comma = false;
            for (var i = 0, length = props.length; i < length; i++) {
                var prop = props[i];

                var val = [];
                var gsop = [];
                var valcnt = 0;
                var doGet = true;
                if (HasOwnProperty(prop, "get")) {
                    doGet = false;
                    val[valcnt] = prop.get;
                    gsop[valcnt] = "get";
                    valcnt++;
                }
                if (HasOwnProperty(prop, "set")) {
                    doGet = false;
                    val[valcnt] = prop.set;
                    gsop[valcnt] = "set";
                    valcnt++;
                }
                var id = prop.name;
                if (doGet) {
                    valcnt = 1;
                    val[0] = obj[id];  // replicates unfortunate behavior in original; should use prop.value instead
                    gsop[0] = null;
                }

                /*
                 * If id is not an identifier or an integer that fits in 31
                 * bits, then it must be quoted.
                 */
                if (!IsIdentifier(id) && !(builtin_match(id, /0|[1-9][0-9]*/) && (+id | 0) === +id))
                    id = QuoteString(id, "'");

                for (var j = 0; j < valcnt; j++) {
                    /*
                     * Censor an accessor descriptor getter or setter part if it's
                     * undefined.
                     */
                    if (gsop[j] && val[j] === undefined)
                        continue;

                    /* Convert val[j] to its canonical source form. */
                    var vchars = ValueToSource(val[j]);

                    /*
                     * If val[j] is a non-sharp object, and we're not serializing an
                     * accessor (ECMA syntax can't accommodate sharpened accessors),
                     * consider sharpening it.
                     */
                    var vsharp = null;
                    if (gsop[j] === null && IsObject(val[j]) && vchars[0] !== '#') {
                        [he, , vsharp] = EnterSharpObject(val[j]);
                        if (he.isSharp) {
                            vchars = vsharp;
                        } else {
                            if (vsharp !== null)
                                he.isSharp = true;
                            LeaveSharpObject();
                        }
                    }

                    /*
                     * Remove '(function ' from the beginning of valstr and ')' from the
                     * end so that we can put "get" in front of the function definition.
                     */
                    if (gsop[j] !== null && IsFunctionObject(val[j])) {
                        var orig = vchars;
                        var group1 = function (all, g1) { return g1; };
                        vchars = builtin_replace(vchars, parensRegExp, group1);
                        vchars = builtin_replace(vchars, functionRegExp, group1);
                        if (vchars === orig)
                            gsop[j] = null;
                    }

                    if (comma)
                        chars += ", ";
                    comma = true;

                    if (gsop[j] !== null)
                        chars += gsop[j] + " ";
                    chars += id;

                    /* Extraneous space after id here will be extracted later */
                    // Actually it's not. That incorrect comment is in the original.
                    chars += (gsop[j] === null ? ":" : " ");

                    if (vsharp !== null)
                        chars += vsharp;
                    chars += vchars;
                }
            }

            chars += "}";
            if (outermost)
                chars += ")";
            return chars;
        } finally {
            LeaveSharpObject();
        }
    }

    function array_toSource(obj) {
        obj = ToObject(obj);

        if (!builtin_isArray(obj)) {
            var t = builtin_toString.call(obj);
            t = builtin_slice(t, 8, -1);
            if (t === "Object")
                t = "object";
            throw new builtin_TypeError("Array.prototype.toSource called on incompatible " + t);
        }

        /* Find joins or cycles in the reachable object graph. */
        var rec = EnterSharpObject(obj);
        var he = rec[0], sharpchars = rec[2];
        var initiallySharp = he.isSharp;

        try {
            var sb = "";
            if (he.isSharp)
                return sharpchars;
            if (sharpchars) {
                he.isSharp = true;
                sb = sharpchars;
            }

            sb += "[";
            for (var i = 0, length = obj.length; i < length; i++) {
                var hole = !(i in obj);
                if (!hole)
                    sb += ValueToSource(obj[i]);
                if (i + 1 !== length)
                    sb += ", ";
                else if (hole)
                    sb += ",";
            }
            return sb + "]";
        } finally {
            if (!initiallySharp)
                LeaveSharpObject();
        }
    }

    function def(obj, name, fn) {
        Object.defineProperty(obj, name, {configurable: true, enumerable: false, writable: true, value: fn});
    }

    def(global, 'uneval', function uneval(v) { return ValueToSource(v); });
    def(Object.prototype, 'toSource', function toSource() { return obj_toSource(this); });
    def(Array.prototype, 'toSource', function toSource() { return array_toSource(this); });

    def(Boolean.prototype, 'toSource', function toSource() {
        return "(new Boolean(" + builtin_Boolean_valueOf(this) + "))";
    });
    def(Date.prototype, 'toSource', function toSource() {
        return "(new Date(" + builtin_Date_valueOf(this) + "))";
    });
    def(Error.prototype, 'toSource', function toSource() {
        var obj = ToObject(this);
        var name = ToString(obj.name);
        var message = ValueToSource(obj.message);
        var fileName = ValueToSource(obj.fileName);
        var lineno = ToUint32(obj.lineNumber);
        lineno = (lineno === 0 ? "" : ", " + lineno);
        return "(new " + name + "(" + message + ", " + fileName + lineno + "))";
    });
    def(Function.prototype, 'toSource', function toSource() {
        return builtin_Function_toString(this, -1);
    });
    def(Math, 'toSource', function toSource () { return "Math"; });
    def(Number.prototype, 'toSource', function toSource() {
        return "(new Number(" + builtin_Number_valueOf(this) + "))";
    });
    def(JSON, 'toSource', function toSource() { return "JSON"; });
    def(RegExp.prototype, 'toSource', function toSource() { return builtin_RegExp_toString(this); });
    def(String.prototype, 'toSource', function toSource() {
        return "(new String(" + ValueToSource(builtin_String_valueOf(this)) + "))";
    });
})(this);
