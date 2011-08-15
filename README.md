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

# Contributors

sharps-lite.js and sharps-full.js are by Jason Orendorff.

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
