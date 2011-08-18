# Sharps

Sometimes object graphs contain cycles. For example, parent objects have
references to their children, which have references back to their parents. JSON
can't serialize such objects.

    var dad = {children: []};
    var kid = {parent: dad};
    dad.children[0] = kid;

    JSON.stringify(dad);
    *** TypeError: cyclic object value

Sharp objects are a way to represent such objects in plain text. It's like
JSON, with extensions using the # character. Write #n= in front of any object
literal to give it a number; later, whenever you need another reference to the
same object, write #n#.

    var code = "#1={children: [{parent: #1#}]}";
    var dad = Sharps.parse(code);
    assert(dad.children[0].parent === dad);

Documentation of the sharp object syntax can be found at:
https://developer.mozilla.org/en/Sharp_variables_in_JavaScript

This directory contains two different implementations of the function
Sharps.parse.

# sharps-lite.js

The version of Sharps.parse in sharps-lite.js is quite simple. It supports JSON
syntax plus sharp objects, and that's it.

sharps-lite.js works fine in Firefox and it would be pretty easy to make it
work in other browsers as well. If you're interested in doing so, let me know.

# sharps-full.js

The version of Sharps.parse in sharps-full.js is much more complex. It supports
objects with properties that are functions:

    var code = "#1={self: #1#, f: function () { return /x/; }}";
    Sharps.parse(code);  // works in sharps-full, not in sharps-lite

Since sharps-full.js contains a full JS parser, based on Narcissus, it is much
much larger than sharps-lite.js. It requires the 3000+ lines of code in the lib
directory.

# uneval.js

This is an implementation of Mozilla's uneval function and .toSource() methods
in pure ES5.

uneval is nonstandard and until now only worked in Firefox. It's quite useful
for error messages and debugging at least. uneval(x) tries to return a string
that evals to x.

   uneval(2) ==> "2"
   unveal(null) ==> "null"
   uneval({a: 1, b: 2}) ==> "({a: 1, b: 2})"
   uneval(new Date(2011, 8, 18)) ==> "(new Date(1316322000000))"

If you uneval an object that has a .toSource() method, it calls the method.

    function Pair(a, b) {
        this.first = a;
        this.second = b;
    }
    Pair.prototype.toSource = function () {
        return "new Pair(" + uneval(this.first) + ", " + uneval(this.second) + ")";
    };

    uneval(new Pair('live long', 'prosper'))
        ==> "new Pair(\"live long\", \"prosper\")"

If you pass uneval a cyclic object, it produces output using sharp-object
syntax. So uneval.js can combine with sharps-full.js to make a simple, flexible
serialization library that mostly produces human-readable strings.

    var p = {}, c = {parent: p};
    p.child = c;
    uneval(p) ==> "#1={child:{parent:#1#}}"

# Contributors

sharps-lite.js, sharps-full.js, and uneval.js are by Jason Orendorff.

Narcissus contributors include:

* Tom Austin
* Brendan Eich
* Andreas Gal
* Shu-yu Guo
* Dave Herman
* Bruno Jouhier
* Gregor Richards
* Dimitris Vardoulakis
* Patrick Walton
