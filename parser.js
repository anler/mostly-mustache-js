var isArray = Array.isArray || function isArrayPolyfill (object) {
  return Object.prototype.toString.call(object) === '[object Array]';
};

var entityMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;'
};

var openTagRe = /{{/;
var closeTagRe = /}}/;
var spaceRe = /\s*/;

var nameRe = /[a-z_$]+[a-z0-9_$]*(?:\.[a-z_$]+[a-z0-9_$]*)*/i;
var stringRe = /(?:'[^']*'|"[^"]*")/;
var booleanRe = /(?:true|false)/;
var numberRe = /\d+(?:\.\d+)?/;

var tagRe = /#|\^|\/|>|%|\{|&|=|!/;



function parseChar(c) {
  return function(tail) {
    var match = tail.match(escapeRegExp(c));
    var value;
    if (match && match.index === 0) {
      value = match[0];
      return ParseResult(value, tail.substring(value.length));
    }
  }
}

function parseRegExp(pattern, tail) {
  var match = tail.match(pattern);
  var value;

  if (match && match.index === 0) {
    value = match[0];
    return ParseResult(value, tail.substring(value.length));
  }
}

function parseUntil(pattern, tail) {
  var index = tail.search(pattern);
  var value;

  switch (index) {
    case -1:
      value = tail;
      tail = '';
      break;
    case 0:
      value = '';
      break;
    default:
      value = tail.substring(0, index);
      tail = tail.substring(index);
  }

  return ParseResult(value, tail);
}

function skipValue(parser) {
  return function(tail) {
    var result = parser(tail);
    if (result) {
      return ParseResult(null, result.tail);
    }
  }
}

function escapeRegExp (string) {
  return string.replace(/[\-\[\]{}()*+?.,\\\^$|#\s]/g, '\\$&');
}

function eos(string) {
  return string === '';
}

function escapeHtml (string) {
  return String(string).replace(/[&<>"'`=\/]/g, function fromEntityMap (s) {
    return entityMap[s];
  });
}

function ParseResult(value, tail) {
  return {
    value: value,
    tail: tail
  };
}

function parseTemplate(string) {
  var tokens = [];
  var result;
  var value;
  var tail = string;
  while (!eos(tail)) {
    result = parseUntil(openTagRe, tail);
    tokens.push(TextNode(result.value));
    tail = result.tail;

    result = parseTag(tail) || parseEverything(tail);
    tokens.push(result.value);
    tail = result.tail;
  }

  return tokens;
}

function parseTag(tail) {
  var result = parseDo([
    skipValue(parseOpenTag),
    parseOr([
      parseValueTag,
      parseSafeValueTag,
      parseSection,
      parseInvertedSection,
      // parsePartial,
      // parseComment,
      parseHelper
    ]),
    skipValue(parseCloseTag)
  ], tail);
  if (result) {
    return ParseResult(result.value[0], result.tail);
  }
}

function parseHelper(tail) {
  var result = parseDo([
    skipValue(parseChar('%')),
    skipValue(parseSpace),
    parseName,
    parseOr([parseHelperArgs, success(ArgsNode([]))]),
    skipValue(parseSpace)
  ], tail);
  if (result) {
    return ParseResult(HelperNode(result.value[0], result.value[1]), result.tail);
  }
}

function parseHelperArgs(tail) {
  var args;
  var result = parseDo([
    skipValue(parseChar(':')),
    skipValue(parseSpace),
    parseValue,
    parseOr([parseHelperArgsOpt, success([])]),
    skipValue(parseSpace)
  ], tail);
  if (result) {
    args = [result.value[0]].concat(result.value[1]);
    return ParseResult(ArgsNode(args), result.tail);
  }
}

function parseHelperArgsOpt(tail) {
  var args;
  var result = parseDo([
    skipValue(parseChar(',')),
    skipValue(parseSpace),
    parseValue,
    parseOr([parseHelperArgsOpt, success([])])
  ], tail);
  if (result) {
    args = [result.value[0]].concat(result.value[1]);
    return ParseResult(args, result.tail);
  }
}

function success(value) {
  return function(tail) {
    return ParseResult(value, tail);
  };
}

function parseOr(parsers) {
  return function(tail) {
    var result;
    var parser;

    for(var i = 0, l = parsers.length; i < l; i++) {
      parser = parsers[i];
      result = parser(tail);
      if (result) {
        break;
      }
    }

    if (result) {
      return result;
    }
  }
}

function parseOpenTag(tail) {
  return parseRegExp(openTagRe, tail);
}

function parseCloseTag(tail) {
  return parseRegExp(closeTagRe, tail);
}

function parseValueTag(tail) {
  var result = parseValue(tail);

  if (result) {
    return ParseResult(EscapedNode(result.value), result.tail);
  }
}

function parseValue(tail) {
  var result = parseDo([
    skipValue(parseSpace),
    parseOr([
      parseName,
      parsePrimitive
    ]),
    skipValue(parseSpace)
  ], tail);
  if (result) {
    return ParseResult(result.value[0], result.tail);
  }
}

function parseSafeValueTag(tail) {
  var result = parseDo([
    skipValue(parseChar('{')),
    skipValue(parseSpace),
    parseOr([
      parseName,
      parsePrimitive
    ]),
    skipValue(parseSpace),
    skipValue(parseChar('}'))
  ], tail);

  if (result) {
    return ParseResult(UnEscapedNode(result.value[0]), result.tail);
  }
}

function parseSection(tail) {
  return parseSectionWith(parseChar('#'), SectionNode, tail);
}

function parseSectionWith(firstParser, sectionNode, tail) {
  var result = parseDo([
    skipValue(firstParser),
    skipValue(parseSpace),
    parseName,
    skipValue(parseSpace),
    skipValue(parseCloseTag)
  ], tail);
  if (result) {
    return parseEndSection(sectionNode, result.value[0], result.tail);
  }
}

function parseInvertedSection(tail) {
  return parseSectionWith(parseChar('^'), InvertedSectionNode, tail);
}

function parseEndSection(sectionNode, node, tail) {
  var value;
  var sectionEndRe = new RegExp("\{\{\/\\s*" + escapeRegExp(node.value) + "\\s*");
  var result = parseUntil(sectionEndRe, tail);
  if (!eos(result.tail)) {
    value = parseTemplate(result.value);
    result = parseRegExp(sectionEndRe, result.tail);
    return ParseResult(sectionNode(node, value), result.tail);
  }
}

function parseSpace(tail) {
  return parseRegExp(spaceRe, tail);
}

function parsePrimitive(tail) {
  var result = parseRegExp(stringRe, tail)
      || parseRegExp(numberRe, tail)
      || parseRegExp(booleanRe, tail);
  if (result) {
    return ParseResult(PrimitiveNode(result.value), result.tail);
  }
}

function parseName(tail) {
  var result = parseRegExp(nameRe, tail);
  if (result) {
    return ParseResult(NameNode(result.value), result.tail);
  }
}

function parseEverything(tail) {
  return ParseResult(TextNode(tail), '');
}

function parseDo(parsers, tail) {
  var result;
  var parser;
  var values = [];

  for(var i = 0, l = parsers.length; i < l; i++) {
    parser = parsers[i];
    result = parser(tail);
    if (result) {
      if (result.value !== null) {
        values.push(result.value);
      }
      tail = result.tail;
    } else {
      break;
    }
  }

  if (result) {
    return ParseResult(values, tail);
  }
}

function PrimitiveNode(value) {
  return {
    type: 'primitive',
    value: value,
    eval: function(env) {
      return eval(value);
    }
  };
}

function TextNode(value) {
  return {
    type: 'text',
    value: value,
    eval: function() {
      return value;
    }
  };
}

function NameNode(value) {
  return {
    type: 'name',
    value: value,
    eval: function(env) {
      var attrs = value.split('.');
      var attr;
      var result = env;
      for(var i = 0, l = attrs.length; i < l; i++) {
        attr = attrs[i];
        if (result.hasOwnProperty(attr)) {
          result = result[attr];
        } else {
          result = undefined;
          break;
        }
      }

      return result;
    }
  };
}

function HelperNode(value, args) {
  return {
    type: 'helper',
    value: value,
    eval: function(env) {
      var f = value.eval(env);
      if (f) {
        return f.apply(null, args.eval(env));
      }
    }
  };
}

function ArgsNode(value, args) {
  function evalArg(arg) {
    return arg.eval();
  }
  return {
    type: 'args',
    value: value,
    eval: function(env) {
      return value.map(evalArg);
    }
  };
}

function EscapedNode(value) {
  return {
    type: 'escaped',
    value: value,
    eval: function(env) {
      var v = value.eval(env);
      if (v) {
        return escapeHtml(v);
      }
    }
  };
}

function UnEscapedNode(value) {
  return {
    type: 'unescaped',
    value: value,
    eval: function(env) {
      return value.eval(env);
    }
  };
}

function SectionNode(context, value) {
  return {
    type: 'section',
    value: value,
    context: context,
    eval: function(env) {
      var v = context.eval(env);
      var result;
      if (isArray(v)) {
        result = [];
        for(var i = 0, l = v.length; i < l; i++) {
          result.push(
            evalAst(value, Object.assign({}, v[i], env))
          );
        }
        result = result.join('');
      } else if (v && v.constructor === Object) {
        result = evalAst(value, Object.assign({}, v, env));
      } else if (v) {
        result = evalAst(value, env);
      } else {
        return '';
      }
      return result;
    }
  };
}

function InvertedSectionNode(context, value) {
  return {
    type: 'inverted section',
    value: value,
    context: context,
    eval: function(env) {
      var v = context.eval(env);
      var result;
      if (v) {
        return '';
      } else {
        result = evalAst(value, env);
      }
      return result;
    }
  };
}

function evalAst(ast, env) {
  env = env || {};
  var output = [];
  for(var i = 0, l = ast.length; i < l; i++) {
    output.push(ast[i].eval(env));
  }
  return output.join('');
}

var ast = parseTemplate('Hello {{ "<h1>escaped</h1>" }} {{{"<h1>unescaped</h1>"}}} {{% m }} {{% m: 1, 2 }} {{#name}} Hello world {{/name}} foo bar baz {{^ name }} lol wuz {{/ name }} ah');


document.body.innerHTML = evalAst(ast, {
  foo: {
    bar: 'Audience'
  },
  m: function(a, b) {
    if (a && b) {
      return a + b;
    }
    return 'Im m';
  },
  name: false
});
