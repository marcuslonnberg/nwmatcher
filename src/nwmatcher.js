/*
 * Copyright (C) 2007-2009 Diego Perini
 * All rights reserved.
 *
 * nwmatcher.js - A fast CSS selector engine and matcher
 *
 * Author: Diego Perini <diego.perini at gmail com>
 * Version: 1.2.0
 * Created: 20070722
 * Release: 20091101
 *
 * License:
 *  http://javascript.nwbox.com/NWMatcher/MIT-LICENSE
 * Download:
 *  http://javascript.nwbox.com/NWMatcher/nwmatcher.js
 */

window.NW || (window.NW = { });

NW.Dom = (function(global) {

  var version = 'nwmatcher-1.2.0',

  // processing context
  base = global.document,

  // script loading context
  context = base,

  // document type node (+DTD)
  docType = context.doctype,

  // context root element (HTML)
  root = context.documentElement,

  // current DOM viewport/window, also used to
  // detect Safari 2.0.x [object AbstractView]
  view = base.defaultView || base.parentWindow,

  // http://www.w3.org/TR/css3-syntax/#characters
  // unicode/ISO 10646 characters 161 and higher
  // NOTE: Safari 2.0.x crashes with escaped (\\)
  // Unicode ranges in regular expressions so we
  // use a negated character range class instead
  encoding = '((?:[-\\w]|[^\\x00-\\xa0]|\\\\.)+)',

  // used to skip [ ] or ( ) groups in token tails
  skipgroup = '(?:\\[.*\\]|\\(.*\\))',

  // discard invalid chars found in passed selector
  reValidator = /([.:#*\w]|[^\x00-\xa0])/,

  // matches simple id, tagname & classname selectors
  reSimpleSelector = /^[.#]?[-\w]+$/,

  // split comma separated selector groups, exclude commas inside '' "" () []
  // example: (#div a, ul > li a) group 1 is (#div a) group 2 is (ul > li a)
  reSplitGroup = /([^,()[\]]+|\([^()]+\)|\(.*\)|\[(?:\[[^[\]]*\]|["'][^'"]*["']|[^'"[\]]+)+\]|\[.*\]|\\.)+/g,

  // split last, right most, selector group token
  reSplitToken = /([^ >+~,\\()[\]]+|\([^()]+\)|\(.*\)|\[[^[\]]+\]|\[.*\]|\\.)+/g,

  // Only five characters can occur in whitespace, they are:
  // \x20 \t \n \r \f, checks now uniformed through the code
  // http://www.w3.org/TR/css3-selectors/#selector-syntax

  reClassValue = /([-\w]+)/,
  reIdSelector = /\#([-\w]+)$/,
  reTrimSpaces = /^[\x20\t\n\r\f]+|[\x20\t\n\r\f]+$/g,

  /*----------------------------- UTILITY METHODS ----------------------------*/

  slice = Array.prototype.slice,

  // Safari 2 bug with innerText (gasp!)
  // used to strip tags from innerHTML
  stripTags = function(s) {
    return s.replace(/<\/?("[^\"]*"|'[^\']*'|[^>])+>/gi, '');
  },

  /*------------------------------- DEBUGGING --------------------------------*/

  // enable/disable notifications
  VERBOSE = false,

  // a way to control user notification
  emit =
    function(message) {
      if (VERBOSE) {
        var console = global.console;
        if (console && console.log) {
          console.log(message);
        } else {
          if (/exception/i.test(message)) {
            global.status = message;
            global.defaultStatus = message;
          } else {
            global.status += message;
          }
        }
      }
    },

  /*----------------------------- FEATURE TESTING ----------------------------*/

  // detect native methods
  isNative = (function() {
    var s = (global.open + '').replace(/open/g, '');
    return function(object, method) {
      var m = object ? object[method] : false, r = new RegExp(method, 'g');
      return !!(m && typeof m != 'string' && s === (m + '').replace(r, ''));
    };
  })(),

  // NOTE: NATIVE_XXXXX check for existance of method only
  // so through the code read it as "supported", maybe BUGGY

  // supports lowercase node names
  NATIVE_TAG_MATCH =
    typeof context.createElementNS == 'function' ? '.toUpperCase()' : '',

  // supports the new traversal API
  NATIVE_TRAVERSAL_API =
    'nextElementSibling' in root && 'previousElementSibling' in root,

  // detect native getAttribute/hasAttribute methods,
  // frameworks extend these to elements, but it seems
  // this does not work for XML namespaced attributes,
  // used to check both getAttribute/hasAttribute in IE
  NATIVE_HAS_ATTRIBUTE = isNative(root, 'hasAttribute'),

  // detect if DOM methods are native in browsers
  NATIVE_QSAPI = isNative(context, 'querySelector'),
  NATIVE_GEBID = isNative(context, 'getElementById'),
  NATIVE_GEBTN = isNative(root, 'getElementsByTagName'),
  NATIVE_GEBCN = isNative(root, 'getElementsByClassName'),

  // nodeList can be converted by native .slice()
  // Opera 9.27 and an id="length" will fold this
  NATIVE_SLICE_PROTO =
    (function() {
      var isSupported = false, div = context.createElement('div');
      try {
        div.innerHTML = '<div id="length"></div>';
        root.insertBefore(div, root.firstChild);
        isSupported = !!slice.call(div.childNodes, 0)[0];
      } catch(e) {
      } finally {
        root.removeChild(div).innerHTML = '';
      }
      return isSupported;
    })(),

  // NOTE: BUGGY_XXXXX check both for existance and no known bugs.

  BUGGY_GEBID = NATIVE_GEBID ?
    (function() {
      var isBuggy, div = context.createElement('div');
      div.innerHTML = '<a name="Z"></a>';
      root.insertBefore(div, root.firstChild);
      isBuggy = !!div.ownerDocument.getElementById('Z');
      div.innerHTML = '';
      root.removeChild(div);
      div = null;
      return isBuggy;
    })() :
    true,

  // detect IE gEBTN comment nodes bug
  BUGGY_GEBTN = NATIVE_GEBTN ?
    (function() {
      var isBuggy, div = context.createElement('div');
      div.appendChild(context.createComment(''));
      isBuggy = div.getElementsByTagName('*')[0];
      div.innerHTML = '';
      div = null;
      return isBuggy;
    })() :
    true,

  // detect Opera gEBCN second class and/or UTF8 bugs as well as Safari 3.2
  // caching class name results and not detecting when changed,
  // tests are based on the jQuery selector test suite
  BUGGY_GEBCN = NATIVE_GEBCN ?
    (function() {
      var isBuggy,
        div = context.createElement('div'),
        method = 'getElementsByClassName',
        test = /\u53f0\u5317/;

      // Opera tests
      div.innerHTML = '<span class="' + test + 'abc ' + test + '"></span><span class="x"></span>';
      isBuggy = !div[method](test)[0];

      // Safari test
      div.lastChild.className = test;
      if (!isBuggy) isBuggy = div[method](test).length !== 2;

      div.innerHTML = '';
      div = null;
      return isBuggy;
    })() :
    true,

  // check Seletor API implementations
  BUGGY_QSAPI = NATIVE_QSAPI ? (function() {
    var pattern = [ '!=', ':contains', ':selected' ], div = context.createElement('div');

    // WebKit treats case insensitivity correctly with classNames (when no DOCTYPE)
    // obsolete bug https://bugs.webkit.org/show_bug.cgi?id=19047
    // so the bug is in all other browsers code now :-)
    // new specs http://www.whatwg.org/specs/web-apps/current-work/#selectors
    div.innerHTML = '<b class="X"></b>';
    if (compatMode == 'BackCompat' && div.querySelector('.x') === null) {
      return { 'test': function() { return true; } };
    }

    // :enabled :disabled bugs with hidden fields (Firefox 3.5 QSA bug)
    // http://www.w3.org/TR/html5/interactive-elements.html#selector-enabled
    // IE8 throws error with these pseudos
    div.innerHTML = '<input type="hidden">';
    try {
      div.querySelectorAll(':enabled').length === 1 && pattern.push(':enabled', ':disabled');
    } catch(e) { }

    // :checked bugs whith checkbox fields (Opera 10beta3 bug)
    div.innerHTML = '<input type="checkbox" checked>';
    try {
      div.querySelectorAll(':checked').length !== 1 && pattern.push(':checked');
    } catch(e) { }

    // :link bugs with hyperlinks matching (Firefox/Safari)
    div.innerHTML = '<a href="x"></a>';
    div.querySelectorAll(':link').length !== 1 && pattern.push(':link');

    div.innerHTML = '';
    div = null;

    return pattern.length ?
      new RegExp(pattern.join('|')) :
      { 'test': function() { return false; } };
  })() :
  true,

  // Safari 2 missing document.compatMode property
  // makes it harder to detect Quirks vs. Strict
  compatMode = context.compatMode ||
    (function() {
      var el; (el = document.createElement('div')).style.width = 1;
      return el.style.width == '1px' ? 'BackCompat' : 'CSS1Compat';
    })(),

  /*----------------------------- LOOKUP OBJECTS -----------------------------*/

  LINK_NODES = { 'a': 1, 'A': 1, 'area': 1, 'AREA': 1, 'link': 1, 'LINK': 1 },

  QSA_NODE_TYPES = { '9': 1, '11': 1 },

  // attribute referencing URI values need special treatment in IE
  ATTRIBUTES_URI = {
    'action': 2, 'cite': 2, 'codebase': 2, 'data': 2, 'href': 2,
    'longdesc': 2, 'lowsrc': 2, 'src': 2, 'usemap': 2
  },

  // HTML 5 draft specifications
  // http://www.whatwg.org/specs/web-apps/current-work/#selectors
  HTML_TABLE = {
    // class attribute must be treated case-insensitive in HTML quirks mode
    'class': compatMode.indexOf('CSS') > -1 ? 0 : 1,
    'accept': 1, 'accept-charset': 1, 'align': 1, 'alink': 1, 'axis': 1,
    'bgcolor': 1, 'charset': 1, 'checked': 1, 'clear': 1, 'codetype': 1, 'color': 1,
    'compact': 1, 'declare': 1, 'defer': 1, 'dir': 1, 'direction': 1, 'disabled': 1,
    'enctype': 1, 'face': 1, 'frame': 1, 'hreflang': 1, 'http-equiv': 1, 'lang': 1,
    'language': 1, 'link': 1, 'media': 1, 'method': 1, 'multiple': 1, 'nohref': 1,
    'noresize': 1, 'noshade': 1, 'nowrap': 1, 'readonly': 1, 'rel': 1, 'rev': 1,
    'rules': 1, 'scope': 1, 'scrolling': 1, 'selected': 1, 'shape': 1, 'target': 1,
    'text': 1, 'type': 1, 'valign': 1, 'valuetype': 1, 'vlink': 1
  },

  // the following attributes must be treated case insensitive in XHTML
  // See Niels Leenheer blog
  // http://rakaz.nl/item/css_selector_bugs_case_sensitivity
  XHTML_TABLE = {
    'accept': 1, 'accept-charset': 1, 'alink': 1, 'axis': 1,
    'bgcolor': 1, 'charset': 1, 'codetype': 1, 'color': 1,
    'enctype': 1, 'face': 1, 'hreflang': 1, 'http-equiv': 1,
    'lang': 1, 'language': 1, 'link': 1, 'media': 1, 'rel': 1,
    'rev': 1, 'target': 1, 'text': 1, 'type': 1, 'vlink': 1
  },

  INSENSITIVE_TABLE = docType && docType.systemId && docType.systemId.indexOf('xhtml') > -1 ?
    XHTML_TABLE : HTML_TABLE,

  // shortcut for the frequently checked case sensitivity of the class attribute
  isClassNameLowered = INSENSITIVE_TABLE['class'],

  // placeholder to add functionalities
  Selectors = {
    // as a simple example this will check
    // for chars not in standard ascii table
    //
    // 'mySpecialSelector': {
    //  'Expression': /\u0080-\uffff/,
    //  'Callback': mySelectorCallback
    // }
    //
    // 'mySelectorCallback' will be invoked
    // only after passing all other standard
    // checks and only if none of them worked
  },

  // attribute operators
  Operators = {
    // ! is not really in the specs
    // still unit tests have to pass
     '=': "%p==='%m'",
    '!=': "%p!=='%m'",
    '^=': "%p.indexOf('%m')==0",
    '*=': "%p.indexOf('%m')>-1",
    // sensitivity handled by compiler
    // NOTE: working alternative
    // '|=': "/%m-/i.test(%p+'-')",
    '|=': "(%p+'-').indexOf('%m-')==0",
    '~=': "(' '+%p+' ').indexOf(' %m ')>-1",
    // precompile in '%m' string length to optimize
    // NOTE: working alternative
    // '$=': "%p.lastIndexOf('%m')==%p.length-'%m'.length"
    '$=': "%p.substr(%p.length - '%m'.length) === '%m'"
  },

  // optimization expressions
  Optimize = {
    ID: new RegExp("#" + encoding + "|" + skipgroup + "*"),
    TAG: new RegExp(encoding + "|" + skipgroup + "*"),
    CLASS: new RegExp("\\." + encoding + "|" + skipgroup + "*")
  },

  // precompiled Regular Expressions
  Patterns = {
    // element attribute matcher
    attribute: /^\[[\x20\t\n\r\f]*([-\w]*:?(?:[-\w])+)[\x20\t\n\r\f]*(?:([~*^$|!]?=)[\x20\t\n\r\f]*(["']*)([^'"()]*?)\3)?[\x20\t\n\r\f]*\](.*)/,
    // structural pseudo-classes
    spseudos: /^\:(root|empty|nth)?-?(first|last|only)?-?(child)?-?(of-type)?(\((?:even|odd|[^\)]*)\))?(.*)/,
    // uistates + dynamic + negation pseudo-classes
    dpseudos: /^\:([\w]+|[^\x00-\xa0]+)(?:\((["']*)(.*?(\(.*\))?[^'"()]*?)\2\))?(.*)/,
    // E > F
    children: /^[\x20\t\n\r\f]*\>[\x20\t\n\r\f]*(.*)/,
    // E + F
    adjacent: /^[\x20\t\n\r\f]*\+[\x20\t\n\r\f]*(.*)/,
    // E ~ F
    relative: /^[\x20\t\n\r\f]*\~[\x20\t\n\r\f]*(.*)/,
    // E F
    ancestor: /^[\x20\t\n\r\f]+(.*)/,
    // all
    universal: /^\*(.*)/,
    // id
    id: new RegExp("^#" + encoding + "(.*)"),
    // tag
    tagName: new RegExp("^" + encoding + "(.*)"),
    // class
    className: new RegExp("^\\." + encoding + "(.*)")
  },

  // current CSS3 grouping of Pseudo-Classes
  // they allow implementing extensions
  // and improve error notifications;
  // the assigned value represent current spec status:
  // 3 = CSS3, 2 = CSS2, '?' = maybe implemented
  CSS3PseudoClasses = {
    Structural: {
      'root': 3, 'empty': 3,
      'first-child': 3, 'last-child': 3, 'only-child': 3,
      'first-of-type': 3, 'last-of-type': 3, 'only-of-type': 3,
      'first-child-of-type': 3, 'last-child-of-type': 3, 'only-child-of-type': 3,
      'nth-child': 3, 'nth-last-child': 3, 'nth-of-type': 3, 'nth-last-of-type': 3
      // (the 4rd line is not in W3C CSS specs but is an accepted alias of 3nd line)
    },

    // originally separated in different pseudo-classes
    // we have grouped them to optimize a bit size+speed
    // all are going through the same code path (switch)
    Others: {
      // UIElementStates (grouped to optimize)
      'checked': 3, 'disabled': 3, 'enabled': 3, 'selected': 2, 'indeterminate': '?',
      // Dynamic pseudo classes
      'active': 3, 'focus': 3, 'hover': 3, 'link': 3, 'visited': 3,
      // Target, Language and Negated pseudo classes
      'target': 3, 'lang': 3, 'not': 3,
      // http://www.w3.org/TR/2001/CR-css3-selectors-20011113/#content-selectors
      'contains': '?'
    }
  },

  /*------------------------------ DOM METHODS -------------------------------*/

  concatList =
    function(listout, listin) {
      var i = -1, element;
      if (listout.length === 0 && Array.slice) return Array.slice(listin);
      while ((element = listin[++i])) listout[listout.length] = element;
      return listout;
    },

  concatCall =
    function(listout, listin, callback) {
      var i = -1, element;
      while ((element = listin[++i])) callback(listout[listout.length] = element);
      return listout;
    },

  // element by id
  // @return element reference or null
  byId =
    function(id, from) {
      var i = -1, element, names, node, result;
      from || (from = context);
      id = id.replace(/\\/g, '');
      if (from.getElementById) {
        result = from.getElementById(id);
        if (result && id != getAttribute(result, 'id') && from.getElementsByName) {
          names = from.getElementsByName(id);
          result = null;
          while ((element = names[++i])) {
            if ((node = element.getAttributeNode('id')) && node.value == id) {
              result = element;
              break;
            }
          }
        }
      } else {
        result = select('[id="' + id + '"]', from)[0] || null;
      }
      return result;
    },

  // elements by tag
  // @return nodeList (live)
  byTag =
    function(tag, from) {
      return (from || context).getElementsByTagName(tag);
    },

  // elements by name
  // @return array
  byName =
    function(name, from) {
      return select('[name="' + name.replace(/\\/g, '') + '"]', from || context);
    },

  // elements by class
  // @return array
  byClass = !BUGGY_GEBCN ?
    function(className, from) {
      return slice.call(from.getElementsByClassName(className.replace(/\\/g, '')), 0);
    } :
    function(className, from) {
      // context is handled in byTag for non native gEBCN
      var i = -1, j = i, results = [ ], element,
        elements = from.getElementsByTagName('*'),
        cn = isClassNameLowered ? className.toLowerCase() : className;
      className = ' ' + cn.replace(/\\/g, '') + ' ';
      while ((element = elements[++i])) {
        if ((cn = element.className)) {
          if ((' ' + (isClassNameLowered ? cn.toLowerCase() : cn).
            replace(/[\t\n\r\f]/g, ' ') + ' ').indexOf(className) > -1) {
            results[++j] = element;
          }
        }
      }
      return results;
    },

  getChildren =
    function(from) {
      var i = -1, element = from.firstChild, elements = [ ];
      while (element) {
        if ((element.nodeType == 1)) {
            elements[++i] = element;
        }
        element = element.nextSibling;
      }
      return elements;
    },

  // children position by nodeType
  // @return number
  getIndexesByNodeType =
    function(element) {
      var i = 0, indexes, node,
        id = element[CSS_INDEX] || (element[CSS_INDEX] = ++CSS_ID);
      if (!indexesByNodeType[id]) {
        indexes = { };
        node = element.firstChild;
        while (node) {
          if (node.nodeType == 1) {
            indexes[node[CSS_INDEX] || (node[CSS_INDEX] = ++CSS_ID)] = ++i;
          }
          node = node.nextSibling;
        }
        indexes.length = i;
        indexesByNodeType[id] = indexes;
      }
      return indexesByNodeType[id];
    },

  // children position by nodeName
  // @return number
  getIndexesByNodeName =
    function(element, name) {
      var i = 0, indexes, node,
        id = element[CSS_INDEX] || (element[CSS_INDEX] = ++CSS_ID);
      if (!indexesByNodeName[id]) {
        indexes = { };
        node = element.firstChild;
        while (node) {
          if (node.nodeName.toLowerCase() == name) {
            indexes[node[CSS_INDEX] || (node[CSS_INDEX] = ++CSS_ID)] = ++i;
          }
          node = node.nextSibling;
        }
        indexes.length = i;
        indexesByNodeName[id] = indexes;
      }
      return indexesByNodeName[id];
    },

  getElements =
    function(tag, from) {
      var element = from.firstChild, elements = [ ];
      if (!tag) return elements;
      tag = tag.toLowerCase();
      while (element) {
        if ((element.nodeType == 1 && tag == '*') ||
            element.nodeName.toLowerCase() == tag) {
            elements[elements.length] = element;
        }
        getElements(tag, element, elements);
        element = element.nextSibling;
      }
      return elements;
    },

  getNextSibling = NATIVE_TRAVERSAL_API ?
    function (element) {
      return element.nextElementSibling;
    } :
    function (element) {
      element = element.nextSibling;
      while (element && element.nodeType !== 1)
        element = element.nextSibling;
      return element;
    },

  // attribute value
  // @return string
  getAttribute = NATIVE_HAS_ATTRIBUTE ?
    function(element, attribute) {
      return element.getAttribute(attribute) + '';
    } :
    function(element, attribute) {
      // specific URI attributes (parameter 2 to fix IE bug)
      if (ATTRIBUTES_URI[attribute.toLowerCase()]) {
        return element.getAttribute(attribute, 2) + '';
      }
      var node = element.getAttributeNode(attribute);
      return (node && node.value) + '';
    },

  // attribute presence
  // @return boolean
  hasAttribute = NATIVE_HAS_ATTRIBUTE ?
    function(element, attribute) {
      return element.hasAttribute(attribute);
    } :
    function(element, attribute) {
      // need to get at AttributeNode first on IE
      var node = element.getAttributeNode(attribute);
      // use both "specified" & "nodeValue" properties
      return !!(node && (node.specified || node.nodeValue));
    },

  // check if element matches the :link pseudo
  // @return boolean
  isLink =
    function(element) {
        return hasAttribute(element,'href') && LINK_NODES[element.nodeName];
    },

  isDisconnected = 'compareDocumentPosition' in root ?
    function(element, container) {
      return (container.compareDocumentPosition(element) & 1) == 1;
    } : 'contains' in root ?
    function(element, container) {
      return !container.contains(element);
    } :
    function(element, container) {
      while ((element = element.parentNode)) {
        if (element === container) return false;
      }
      return true;
    },

  /*---------------------------- COMPILER METHODS ----------------------------*/

  // conditionals optimizers for the compiler

  // do not change this, it is searched & replaced
  ACCEPT_NODE = 'f&&f(N);r[r.length]=N;continue main;',

  // fix for IE gEBTN('*') returning collection with comment nodes
  SKIP_COMMENTS = BUGGY_GEBTN ? 'if(e.nodeType!=1){continue;}' : '',

  // use the textContent or innerText property to check CSS3 :contains
  // Safari 2 has a bug with innerText and hidden content, using an
  // internal replace on the innerHTML property avoids trashing it
  CONTAINS_TEXT =
    'textContent' in root ?
    'e.textContent' :
    (function() {
      var t = context.createElement('div');
      t.innerHTML = '<p>p</p>';
      t.style.display = 'none';
      return t.innerText.length > 0 ?
        'e.innerText' :
        's.stripTags(e.innerHTML)';
    })(),

  // compile a comma separated group of selector
  // @mode boolean true for select, false for match
  // @return function (compiled)
  compileGroup =
    function(selector, source, mode) {
      var i = -1, seen = { }, parts, token;
      if ((parts = selector.match(reSplitGroup))) {
        // for each selector in the group
        while ((token = parts[++i])) {
          token = token.replace(reTrimSpaces, '');
          // avoid repeating the same token in comma separated group (p, p)
          if (!seen[token]) source += 'e=N;' + compileSelector(token, mode ? ACCEPT_NODE : 'return true;');
          seen[token] = true;
        }
      }
      if (mode) {
        // for select method
        return new Function('c,s,r,d,h,g,f',
          'var n,N,x=0,k=0,e;main:while(N=e=c[k++]){' +
          SKIP_COMMENTS + source + '}return r;');
      } else {
        // for match method
        return new Function('e,s,r,d,h,g,f',
          'var n,N,x=0;N=e;' + source + 'return false;');
      }
    },

  // compile a CSS3 string selector into ad-hoc javascript matching function
  // @return string (to be compiled)
  compileSelector =
    function(selector, source) {

      var i, a, b, n, k, expr, match, result, status, test, type;

      k = 0;

      while (selector) {

        // *** Universal selector
        // * match all (empty block, do not remove)
        if ((match = selector.match(Patterns.universal))) {
          // do nothing, handled in the compiler where
          // BUGGY_GEBTN return comment nodes (ex: IE)
          true;
        }

        // *** ID selector
        // #Foo Id case sensitive
        else if ((match = selector.match(Patterns.id))) {
          // document can contain conflicting elements (id/name)
          // prototype selector unit need this method to recover bad HTML forms
          source = 'if((e.submit?s.getAttribute(e,"id"):e.id)=="' +
            match[1] + '"){' + source + '}';
        }

        // *** Type selector
        // Foo Tag (case insensitive)
        else if ((match = selector.match(Patterns.tagName))) {
          // both tagName and nodeName properties may be upper or lower case
          // depending on their creation NAMESPACE in createElementNS()
          source = 'if(e.nodeName' + NATIVE_TAG_MATCH + '=="' +
            match[1].toUpperCase() + '"){' + source + '}';
        }

        // *** Class selector
        // .Foo Class (case sensitive)
        else if ((match = selector.match(Patterns.className))) {
          // W3C CSS3 specs: element whose "class" attribute has been assigned a
          // list of whitespace-separated values, see section 6.4 Class selectors
          // and notes at the bottom; explicitly non-normative in this specification.
          source = 'if((" "+e.className+" ")' +
            (isClassNameLowered ? '.toLowerCase()' : '') +
            '.replace(/[\\t\\n\\r\\f]/g," ").indexOf(" ' +
            (isClassNameLowered ? match[1].toLowerCase() : match[1]) +
            ' ")>-1){' + source + '}';
        }

        // *** Attribute selector
        // [attr] [attr=value] [attr="value"] [attr='value'] and !=, *=, ~=, |=, ^=, $=
        // case sensitivity is treated differently depending on the document type (see map)
        else if ((match = selector.match(Patterns.attribute))) {
          // xml namespaced attribute ?
          expr = match[1].split(':');
          expr = expr.length == 2 ? expr[1] : expr[0] + '';

          // check case treatment from INSENSITIVE_TABLE
          if (match[4] && INSENSITIVE_TABLE[expr.toLowerCase()]) {
            match[4] = match[4].toLowerCase();
          }

          source = (match[2] ? 'n=s.getAttribute(e,"' + match[1] + '");' : '') +
            'if(' + (match[2] ? Operators[match[2]].replace(/\%p/g, 'n' +
              (expr ? '' : '.toLowerCase()')).replace(/\%m/g, match[4]) :
              's.hasAttribute(e,"' + match[1] + '")') +
            '){' + source + '}';
        }

        // *** Adjacent sibling combinator
        // E + F (F adiacent sibling of E)
        else if ((match = selector.match(Patterns.adjacent))) {
          if (NATIVE_TRAVERSAL_API) {
            source = 'if((e=e.previousElementSibling)){' + source + '}';
          } else {
            source = 'while((e=e.previousSibling)){if(e.nodeType==1){' +
              source + 'break;}}';
          }
        }

        // *** General sibling combinator
        // E ~ F (F relative sibling of E)
        else if ((match = selector.match(Patterns.relative))) {
          k++;
          if (NATIVE_TRAVERSAL_API) {
            // previousSibling particularly slow on Gecko based browsers prior to FF3.1
            source =
              'var N' + k + '=e;e=e.parentNode.firstElementChild;' +
              'while(e!=N' + k +'){if(e){' + source + '}e=e.nextElementSibling;}';
          } else {
            source =
              'var N' + k + '=e;e=e.parentNode.firstChild;' +
              'while(e!=N' + k +'){if(e.nodeType==1){' + source + '}e=e.nextSibling;}';
          }
        }

        // *** Child combinator
        // E > F (F children of E)
        else if ((match = selector.match(Patterns.children))) {
          source = 'if(e!==g&&(e=e.parentNode)){' + source + '}';
        }

        // *** Descendant combinator
        // E F (E ancestor of F)
        else if ((match = selector.match(Patterns.ancestor))) {
          source = 'while(e!==g&&(e=e.parentNode)){' + source + '}';
        }

        // *** Structural pseudo-classes
        // :root, :empty,
        // :first-child, :last-child, :only-child,
        // :first-of-type, :last-of-type, :only-of-type,
        // :nth-child(), :nth-last-child(), :nth-of-type(), :nth-last-of-type()
        else if ((match = selector.match(Patterns.spseudos)) &&
          CSS3PseudoClasses.Structural[selector.match(reClassValue)[0]]) {

          switch (match[1]) {
            case 'root':
              // element root of the document
              source = 'if(e===h){' + source + '}';
              break;

            case 'empty':
              // element that has no children
              source = 'if(!e.firstChild){' + source + '}';
              break;

            default:
              // used for nth-child/of-type
              type = NATIVE_TRAVERSAL_API ?
                (match[4] ? 'n.nodeName==e.nodeName' : 'true') :
                (match[4] ? 'n.nodeName==e.nodeName' : 'n.nodeType==1');

              if (match[1] && match[5]) {
                // remove the ( ) grabbed above
                match[5] = match[5].replace(/\(|\)/g, '');
                if (match[5] == 'even') {
                  a = 2;
                  b = 0;
                } else if (match[5] == 'odd') {
                  a = 2;
                  b = 1;
                } else {
                  // assumes correct "an+b" format
                  a = match[5].match(/^-/) ? -1 : match[5].match(/^n/) ? 1 : 0;
                  a = a || ((n = match[5].match(/(-?\d{1,})n/)) ? parseInt(n[1], 10) : 0);
                  b = 0 || ((n = match[5].match(/(-?\d{1,})$/)) ? parseInt(n[1], 10) : 0);
                }

                // executed after the count is computed
                expr = match[2] == 'last' ? 'n.length-' + (b - 1) : b;

                test =
                  b < 0 ?
                    a <= 1 ?
                      '<=' + Math.abs(b) :
                      '%' + a + '===' + (a + b) :
                  a > Math.abs(b) ? '%' + a + '===' + b :
                  a === Math.abs(b) ? '%' + a + '===' + 0 :
                  a === 0 ? '==' + expr :
                  a < 0 ? '<=' + b :
                  a > 0 ? '>=' + b :
                    '';

                // 4 cases: 1 (nth) x 4 (child, of-type, last-child, last-of-type)
                source = 'n=s.getIndexesBy' + (match[4] ? 'NodeName' : 'NodeType') +
                  '(e.parentNode' + (match[4] ? ',e.nodeName.toLowerCase()' : '') + ');' +
                  'if(n[e.' + CSS_INDEX + ']' + test + '){' + source + '}';

              } else {
                // 6 cases: 3 (first, last, only) x 1 (child) x 2 (-of-type)
                // too much overhead calling functions out of the main loop ?
                a = match[2] == 'first' ? 'previous' : 'next';
                n = match[2] == 'only' ? 'previous' : 'next';
                b = match[2] == 'first' || match[2] == 'last';

                source = NATIVE_TRAVERSAL_API ?
                  ( 'n=e.' + a + 'ElementSibling;if(!(n&&' + type + ')){' + (b ? source :
                    'n=e.' + n + 'ElementSibling;if(!(n&&' + type + ')){' + source + '}') + '}' ) :
                  ( 'n=e;while((n=n.' + a + 'Sibling)&&!(' + type + '));if(!n){' + (b ? source :
                    'n=e;while((n=n.' + n + 'Sibling)&&!(' + type + '));if(!n){' + source + '}') + '}' );
              }
              break;
          }
        }

        // *** negation, user action and target pseudo-classes
        // *** UI element states and dynamic pseudo-classes
        // CSS3 :not, :checked, :enabled, :disabled, :target
        // CSS3 :active, :hover, :focus
        // CSS3 :link, :visited
        else if ((match = selector.match(Patterns.dpseudos)) &&
          CSS3PseudoClasses.Others[selector.match(reClassValue)[0]]) {

          switch (match[1]) {
            // CSS3 negation pseudo-class
            case 'not':
              // compile nested selectors, need to escape double quotes characters
              // since the string we are inserting into already uses double quotes
              source = 'if(!s.match(e, "' + match[3].replace(/\x22/g, '\\"') + '")){' + source +'}';
              break;

            // CSS3 UI element states
            case 'checked':
              // only radio buttons and check boxes
              source = 'if("form" in e&&/radio|checkbox/i.test(e.type)&&e.checked===true){' + source + '}';
              break;
            case 'enabled':
              // does not consider hidden input fields
              source = 'if((("form" in e&&e.type!=="hidden")||s.isLink(e))&&e.disabled===false){' + source + '}';
              break;
            case 'disabled':
              // does not consider hidden input fields
              source = 'if((("form" in e&&e.type!=="hidden")||s.isLink(e))&&e.disabled===true){' + source + '}';
              break;

            // CSS3 target pseudo-class
            case 'target':
              n = base.location.hash;
              source = 'if(e.id!=""&&e.id=="' + n + '"&&"href" in e){' + source + '}';
              break;

            // CSS3 dynamic pseudo-classes
            case 'link':
              source = 'if(s.isLink(e)&&!e.visited){' + source + '}';
              break;
            case 'visited':
              source = 'if(s.isLink(e)&&!!e.visited){' + source + '}';
              break;

            // CSS3 user action pseudo-classes IE & FF3 have native support
            // these capabilities may be emulated by some event managers
            case 'active':
              source = 'if("activeElement" in d&&e===d.activeElement){' + source + '}';
              break;
            case 'hover':
              source = 'if("hoverElement" in d&&e===d.hoverElement){' + source + '}';
              break;
            case 'focus':
              source = 'if("form" in e&&e===d.activeElement&&typeof d.hasFocus=="function"&&d.hasFocus()===true){' + source + '}';
              break;

            // CSS2 :contains and :selected pseudo-classes
            // not currently part of CSS3 drafts
            case 'contains':
              source = 'if(' + CONTAINS_TEXT + '.indexOf("' + match[3] + '")>-1){' + source + '}';
              break;
            case 'selected':
              // fix Safari selectedIndex property bug
              n = base.getElementsByTagName('select');
              for (i = 0; n[i]; i++) {
                n[i].selectedIndex;
              }
              source = 'if("form" in e&&e.selected===true){' + source + '}';
              break;

            default:
              break;
          }
        } else {

          // this is where external extensions are
          // invoked if expressions match selectors
          expr = false;
          status = true;

          for (expr in Selectors) {
            if ((match = selector.match(Selectors[expr].Expression))) {
              result = Selectors[expr].Callback(match, source);
              source = result.source;
              status |= result.status;
            }
          }

          // if an extension fails to parse the selector
          // it must return a false boolean in "status"
          if (!status) {
            // log error but continue execution, don't throw real exceptions
            // because blocking following processes maybe is not a good idea
            emit('DOMException: unknown pseudo selector "' + selector + '"');
            return source;
          }

          if (!expr) {
            // see above, log error but continue execution
            emit('DOMException: unknown token in selector "' + selector + '"');
            return source;
          }

        }

        // ensure "match" is not null or empty since
        // we do not throw real DOMExceptions above
        selector = match && match[match.length - 1];
      }

      return source;
    },

  /*----------------------------- QUERY METHODS ------------------------------*/

  // match element with selector
  // @return boolean
  match =
    function(element, selector, from) {
      // make sure an element node was passed
      if (element && element.nodeType == 1) {
        if (typeof selector == 'string' && selector.length) {
          base = element.ownerDocument;
          root = base.documentElement;
          // save compiled matchers
          if (!compiledMatchers[selector]) {
            compiledMatchers[selector] = compileGroup(selector, '', false);
          }
          // result of compiled matcher
          return compiledMatchers[selector](element, snap, base, root, from || base);
        } else {
          emit('DOMException: "' + selector + '" is not a valid CSS selector.');
        }
      }
      return false;
    },

  native_api =
    function(selector, from, data, callback) {
      var element;
      switch (selector.charAt(0)) {
        case '#':
          if ((element = (from || context).getElementById(selector.slice(1))))
          //if ((element = byId(selector.slice(1), from)))
          {
            data ? (data[data.length] = element) : (data = [ element ]);
            callback && callback(element);
          }
          return data || [ ];
        case '.':
          return data || callback ?
            concatCall(data || [ ], byClass(selector.slice(1), from || context), callback) :
            byClass(selector.slice(1), from || context);
        default:
          return data || callback ?
            concatCall(data || [ ], byTag(selector, from || context), callback) :
            concatList(data || [ ], byTag(selector, from || context));
      }
    },

  // select elements matching selector
  // version using new Selector API
  // @return array
  select_qsa =
    function (selector, from, data, callback) {

      var elements;

      if (reSimpleSelector.test(selector))
        return native_api(selector, from, data, callback);

      if ((!from || QSA_NODE_TYPES[from.nodeType]) &&
          !BUGGY_QSAPI.test(selector)) {
        try {
          elements = (from || context).querySelectorAll(selector);
          if (elements.length == 1) {
            callback && callback(elements[0]);
            return [ elements[0] ];
          }
        } catch(e) { }

        if (elements) {
          if (callback) return concatCall(data || [ ], elements, callback);
          return NATIVE_SLICE_PROTO ?
            slice.call(elements) :
            concatList(data || [ ], elements);
        }
      }

      // fall back to NWMatcher select
      return client_api(selector, from, data, callback);
    },

  lastSelector,
  lastContext,
  lastSlice,

  // select elements matching selector
  // version using cross-browser client API
  // @return array
  client_api =
    function client_api(selector, from, data, callback) {

      var done, element, elements, parts, token, hasChanged, isSingle;

      if (reSimpleSelector.test(selector))
        return native_api(selector, from, data, callback);

      // result set
      elements = [ ];

      // storage setup
      data || (data = [ ]);

      // ensure context is set
      from || (from = context);

      // extract context if changed
      if (lastContext != from) {
        // save passed context
        lastContext = from;
        // reference context ownerDocument and document root (HTML)
        root = (base = from.ownerDocument || from).documentElement;
      }

      // pre-filtering pass allow to scale proportionally with big DOM trees;

      if (hasChanged = lastSelector != selector) {
        // process valid selector strings
        if (reValidator.test(selector)) {
          // save passed selector
          lastSelector = selector;
          selector = selector.replace(reTrimSpaces, '');
        } else {
          emit('DOMException: "' + selector + '" is not a valid CSS selector.');
          return data;
        }
      }

      // reinitialize indexes
      indexesByNodeType = { };
      indexesByNodeName = { };

      // commas separators are treated sequentially to maintain order
      if ((isSingle = selector.match(reSplitGroup).length < 2)) {

        if (hasChanged) {
          // get right most selector token
          parts = selector.match(reSplitToken);

          // only last slice before :not rules
          lastSlice = parts[parts.length - 1].split(':not')[0];
        }

        // reduce selection context
        if ((parts = selector.match(Optimize.ID))) {
          if ((element = context.getElementById(parts[1]))) {
            from = element.parentNode;
          }
        }

        // ID optimization RTL
        if ((parts = lastSlice.match(Optimize.ID)) &&
          (token = parts[parts.length - 1]) && NATIVE_GEBID) {
          if ((element = byId(token, context))) {
            if (match(element, selector)) {
              elements = [ element ];
              done = true;
            }
          } else return data;
        }

        // CLASS optimization RTL
        else if ((parts = lastSlice.match(Optimize.CLASS)) &&
          (token = parts[parts.length - 1])) {
          elements = byClass(token, from);
          if (selector == '.' + token) done = true;
        }

        // TAG optimization RTL
        else if ((parts = lastSlice.match(Optimize.TAG)) &&
          (token = parts[parts.length - 1]) && NATIVE_GEBTN) {
          elements = byTag(token, from);
          if (selector == token) done = true;
        }

      }

      if (elements.length === 0) {

        if (isSingle && (parts = selector.match(/\#((?:[-\w]|[^\x00-\xa0]|\\.)+)(.*)/))) {
          if ((element = byId(parts[1]))) {
            parts[2] = parts[2].replace(/[\x20\t\n\r\f]([ >+~])[\x20\t\n\r\f]/g, '$1');
            switch (parts[2].charAt(0)) {
              case '.':
                elements = byClass(parts[2].slice(1), element);
                break;
              case ':':
                if (parts[2].match(/[ >+~]/)) {
                  elements = element.getElementsByTagName('*');
                } else elements = [ element ];
                break;
              case ' ':
                elements = element.getElementsByTagName('*');
                break;
              case '~':
                elements = getChildren(element.parentNode);
                break;
              case '>':
                elements = getChildren(element);
                break;
              case  '':
                elements = [ element ];
                break;
              case '+':
                element = getNextSibling(element);
                elements = element ? [ element ] : [ ];
                break;
              default:
                break;
            }
          } else if (selector.indexOf(':not') < 0) return data;
        }

        if (elements.length === 0) elements = from.getElementsByTagName('*');
      }
      // end of prefiltering pass

      // save compiled selectors
      if (!compiledSelectors[selector]) {
        compiledSelectors[selector] = compileGroup(selector, '', true);
      }

      return done ?
        (callback ? concatCall(data, elements, callback) : concatList(data, elements)) : 
        compiledSelectors[selector](elements, snap, data, base, root, from, callback);
    },

  // use the new native Selector API if available,
  // if missing, use the cross-browser client api
  // @return array
  select = NATIVE_QSAPI ?
    select_qsa :
    client_api,

  /*-------------------------------- STORAGE ---------------------------------*/

  // CSS_ID expando on elements,
  // used to keep child indexes
  // during a selection session
  CSS_ID = 1,

  CSS_INDEX = 'sourceIndex' in root ? 'sourceIndex' : 'CSS_ID',

  // ordinal position by nodeType or nodeName
  indexesByNodeType = { },
  indexesByNodeName = { },

  // compiled select functions returning collections
  compiledSelectors = { },

  // compiled match functions returning booleans
  compiledMatchers = { },

  // used to pass methods to compiled functions
  snap = {

    // element indexing methods (nodeType/nodeName)
    getIndexesByNodeType: getIndexesByNodeType,
    getIndexesByNodeName: getIndexesByNodeName,

    // element inspection methods
    getAttribute: getAttribute,
    hasAttribute: hasAttribute,

    // element selection methods
    byClass: byClass,
    byName: byName,
    byTag: byTag,
    byId: byId,

    // helper/check methods
    stripTags: stripTags,
    isLink: isLink,

    // selection/matching
    select: select,
    match: match
  };

  /*------------------------------- PUBLIC API -------------------------------*/

  return {

    // retrieve element by id attr
    byId: byId,

    // retrieve elements by tag name
    byTag: byTag,

    // retrieve elements by name attr
    byName: byName,

    // retrieve elements by class name
    byClass: byClass,

    // read the value of the attribute
    // as was in the original HTML code
    getAttribute: getAttribute,

    // check for the attribute presence
    // as was in the original HTML code
    hasAttribute: hasAttribute,

    // element match selector, return boolean true/false
    match: match,

    // elements matching selector, starting from element
    select: select,

    // for testing purposes !
    compile:
      function(selector, mode) {
        return compileGroup(selector, '', mode || false).toString();
      },

    // add or overwrite user defined operators
    registerOperator:
      function (symbol, resolver) {
        if (!Operators[symbol]) {
          Operators[symbol] = resolver;
        }
      },

    // add selector patterns for user defined callbacks
    registerSelector:
      function (name, rexp, func) {
        if (!Selectors[name]) {
          Selectors[name] = { };
          Selectors[name].Expression = rexp;
          Selectors[name].Callback = func;
        }
      }

  };

})(this);
