'use strict';

// TODO: rewrite internal errors as assertions, where appropriate

const ISA_WIDTH = 32;
const DATA_WIDTH = 8;

const isWhitespace = ch => " \t\n\r".indexOf(ch) !== -1;

const tokenize = text => {
  let result = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '#') i = text.indexOf("\n", i);
    if (isWhitespace(text[i])) continue;

    let token = "";
    for (; i < text.length && !isWhitespace(text[i]) && text[i] !== ','; i++)
      token += text[i];

    console.assert(token.length > 0, "empty token");
    result.push(token);
    if (text[i] === ',') result.push(',');
  }
  return result;
};

const checkComma = str => {
  if (str !== ',') {
    throw new Error(`expected comma, found: "${str}"`);
  }
};

const parseNum = str => {
  if (str === '-' || str === '')
    throw new Error(`expected number, found: "${str}"`);

  for (let i = str[0] === '-' ? 1 : 0; i < str.length; i++) {
    if (str[i] < '0' || str[i] > '9')
      throw new Error(`expected number, found: "${str}"`);
  }

  return parseInt(str);
};

const parseReg = str => {
  if (str[0] !== '$')
    throw new Error(`expected register, found: "${str}"`);

  const registerNum = parseNum(str.substr(1));
  if (registerNum < 0 || registerNum >= 32)
    throw new Error(`expected register 0~31, found: "${str}"`);
  return registerNum;
};

const parseImm = str => {
  const num = parseNum(str);
  // TODO: add constraints for immediates
  return num;
};

const parseLabel = str => {
  if (str[0] >= '0' && str[0] <= '9')
    throw new Error(`labels can't start with a number; found: "${str}"`);
  if (str.indexOf(':') !== -1)
    throw new Error(`invalid character found in label: "${str}"`);
  return str;
};

const parseOffsetAccess = str => {
  const parenStart = str.indexOf('(');
  const parenEnd = str.indexOf(')');
  if (parenStart === -1 || parenEnd === -1)
    throw new Error(`expected offset access, found: "${str}"`);

  return {
    offset: parseNum(str.substr(0, parenStart)),
    register: parseReg(str.substr(parenStart + 1, parenEnd - parenStart - 1)),
  };
};

const parse = tokens => {
  let symbols = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    let args = [];

    if (token[token.length - 1] === ':') {
      symbols.push({
        type: 'label',
        name: parseLabel(token.substr(0, token.length - 1)),
        args,
      });
      continue;
    }

    if (token === '.dw') {
      args.push(parseNum(tokens[i+1]));
      symbols.push({
        type: 'directive',
        name: '.dw',
        args,
      });
      i++;
      continue;
    }

    switch (token) {
      case 'add':
      case 'sub':
      case 'and':
      case 'or':
      case 'slt':
        args.push(parseReg(tokens[i+1]));
        checkComma(tokens[i+2]);
        args.push(parseReg(tokens[i+3]));
        checkComma(tokens[i+4]);
        args.push(parseReg(tokens[i+5]));
        i += 5;
        break;
      case 'addi':
        args.push(parseReg(tokens[i+1]));
        checkComma(tokens[i+2]);
        args.push(parseReg(tokens[i+3]));
        checkComma(tokens[i+4]);
        args.push(parseImm(tokens[i+5]));
        i += 5;
        break;
      case 'beq':
        args.push(parseReg(tokens[i+3]));
        checkComma(tokens[i+2]);
        args.push(parseReg(tokens[i+1]));
        checkComma(tokens[i+4]);
        args.push(parseLabel(tokens[i+5]));
        i += 5;
        break;
      case 'j':
        args.push(parseLabel(tokens[i+1]));
        i++;
        break;
      case 'lb':
      case 'sb':
        args.push(parseReg(tokens[i+1]));
        checkComma(tokens[i+2]);
        const { offset, register } = parseOffsetAccess(tokens[i+3]);
        args.push(register);
        args.push(offset);
        i += 3;
        break;
      default:
        throw new Error(`unknown token: "${token}"`);
    }

    symbols.push({
      type: 'op',
      name: token,
      args,
    });
  }

  return symbols;
};

const resolveLabels = symbols => {
  let jumpTable = new Map();
  let newSymbols = [];
  let pc = 0;
  for (let i = 0; i < symbols.length; i++) {
    if (symbols[i].type === 'label') {
      if (jumpTable.get(symbols[i].name) !== undefined)
        throw new Error(`multiple declerations of label: ${symbols[i].name}`);

      jumpTable.set(symbols[i].name, pc);
    } else {
      newSymbols.push(symbols[i]);
      pc++;
    }
  }

  const resolveLabel = label => {
    const ret = jumpTable.get(label);
    if (ret === undefined)
      throw new Error(`label not found: ${label}`);
    return ret;
  };

  for (let pc = 0; pc < newSymbols.length; pc++) {
    if (newSymbols[pc].type !== 'op') continue;
    switch (newSymbols[pc].name) {
      case 'beq':
        // TODO: handle jumps that are too far away
        // TODO: alignment may be wrong
        newSymbols[pc].args[2] = resolveLabel(newSymbols[pc].args[2]) - pc - 1;
        break;
      case 'j':
        // TODO: handle jumps that are too far away
        newSymbols[pc].args[0] = resolveLabel(newSymbols[pc].args[0]);
        break;
    }
  }

  return newSymbols;
};

const regToBin = registerNum => {
  if (registerNum < 0 || registerNum >= 32)
    throw new Error(`expected register 0~31, found: "${registerNum}"`);

  return registerNum.toString(2).padStart(5, '0');
}

const immToBin = imm => {
 if (imm >= 2**15 || imm < -(2**15))
    throw new Error(`expected immediate value between [-2^15, 2^15), found: "${imm}`);
  return (imm >= 0 ? imm : (2**16 + imm)).toString(2).padStart(16, '0');
};

const genR = (args, functionCode) => {
  let argsStr = "";
  argsStr += regToBin(args[1]);
  argsStr += regToBin(args[2]);
  argsStr += regToBin(args[0]);
  return `000000${argsStr}00000${functionCode}`;
};

const genI = (args, opcode) => {
  let argsStr = "";
  argsStr += regToBin(args[1]);
  argsStr += regToBin(args[1]);
  return `${opcode}${argsStr}${immToBin(args[2])}`;
};

const genJ = (args, opcode) => {
  if (args[0] >= 2**26 || args[0] < 0)
    throw new Error(`expected jump target to be between [0, 2^26), found: "${args[0]}`);
  return `${opcode}${args[0].toString(2).padStart(26, '0')}`;
};

const emitMachineCode = symbol => {
  const f = symbol => {
    switch (symbol.type) {
      case 'label':
        throw new Error('internal error: unexpected label');
      case 'op':
        switch (symbol.name) {
          case 'add':  return genR(symbol.args, '100000');
          case 'sub':  return genR(symbol.args, '100010');
          case 'and':  return genR(symbol.args, '100100');
          case 'or':   return genR(symbol.args, '100101');
          case 'slt':  return genR(symbol.args, '101010');
          case 'addi': return genI(symbol.args, '001000');
          case 'beq':  return genI(symbol.args, '000100');
          case 'j':    return genJ(symbol.args, '000010');
          case 'lb':   return genI(symbol.args, '100000');
          case 'sb':   return genI(symbol.args, '101000');
          default:
            throw new Error(`internal error: unexpected op name: ${symbol.name}`);
        }
        break;
      case 'directive':
        if (symbol.name !== '.dw')
          throw new Error(`unexpected directive, found: "${symbol.name}"`);

        // TODO: support this
        if (symbol.args[0] < 0)
          throw new Error(`.dw directive unsupported for negative values: "${symbol.args[0]}"`);

        return symbol.args[0]
          .toString(2)
          .padStart(DATA_WIDTH, '0')
          .padEnd(ISA_WIDTH, '0');
      default:
        throw new Error(`internal error: unexpected symbol type: ${symbol.type}`);
    }
  };
  const result = f(symbol);
  //console.log(symbol, result);
  console.assert(result.length === ISA_WIDTH, `expected result.length to be ${ISA_WIDTH} but was ${result.length}`);
  return result;
};

const binaryToHex = inst => parseInt(inst, 2).toString(16).padStart(8, '0');

const assemble = (source) => {
  const tokens = tokenize(source); 
  //console.log(contents);
  //console.log(tokens);
  const symbols = parse(tokens);
  //console.log(symbols);
  const newSymbols = resolveLabels(symbols);
  //console.log(newSymbols);
  const machineCode = newSymbols.map(emitMachineCode).map(binaryToHex);
  //console.log(machineCode);
  return machineCode.join("\n");
};

const nodeMain = () => {
  const fs = require('fs');
  const fileName = process.argv[2];

  fs.readFile(fileName, 'utf8', (err, contents) => {
    if (err) throw err;

    console.log(assemble(contents));
  });
};

const browserMain = () => {
  const e = (name, attrs, children) => {
    const el = document.createElement(name);
    attrs.forEach(([attrName, value]) => el.setAttribute(attrName, value));
    children.forEach(el2 => el.appendChild(el2));
    return el;
  };

  const t = (el, text) => {
    el.innerText = text;
    return el;
  };

  const div = (attrs, children) => e('div', attrs, children);

  const l = (el, ev, f) => {
    el.addEventListener(ev, f);
    return el;
  };

  // c.f. https://stackoverflow.com/a/4835406
  const escapeHTML = text =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const errorMessageView = e('span', [['style', 'color:red']], []);
  const showError = err => errorMessageView.innerHTML = escapeHTML(err);

  const outputTextarea = e('textarea', [['id', 'output'], ['readonly', true]], []);
  const setOutput = text => outputTextarea.innerHTML = escapeHTML(text);

  const inputTextarea =
    l(e('textarea', [['id', 'input']], []), 'input', (e) => {
      try {
        const result = assemble(e.srcElement.value);

        console.log(result);
        setOutput(result)
      } catch (err) {
        console.error(err);
        showError(err.toString());
      }
    });

  document.write(); // clear DOM
  const view =
    div([['style', 'display:flex; flex-direction: column; height: 100%']], [
      errorMessageView,
      div([['style', 'display:flex; flex-direction: row; height: 100%']], [
        div([['class', 'field_container']], [
          t(e('label', [['for', 'input']], []), 'assembly'),
          inputTextarea,
        ]),
        div([['class', 'field_container']], [
          t(e('label', [['for', 'output']], []), 'machine code'),
          outputTextarea,
        ]),
      ]),
    ]);
  document.body.appendChild(view);
}

if (typeof window === 'undefined') nodeMain();
else browserMain();
