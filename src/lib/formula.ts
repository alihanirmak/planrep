// Guvenli formul motoru: [KOLON_KODU] referanslari, + - * / ( ) ve sayilar.
// Ornek: ([BUDGET]-[ACTUAL])/[BUDGET]*100

type Tok =
  | { t: "num"; v: number }
  | { t: "ref"; v: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" }
  | { t: "lp" }
  | { t: "rp" };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t") {
      i++;
    } else if (ch === "[") {
      const end = src.indexOf("]", i);
      if (end < 0) throw new Error("Kapanmayan köşeli parantez");
      toks.push({ t: "ref", v: src.slice(i + 1, end).trim() });
      i = end + 1;
    } else if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.,]/.test(src[j])) j++;
      const num = parseFloat(src.slice(i, j).replace(",", "."));
      if (Number.isNaN(num)) throw new Error(`Geçersiz sayı: ${src.slice(i, j)}`);
      toks.push({ t: "num", v: num });
      i = j;
    } else if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      toks.push({ t: "op", v: ch });
      i++;
    } else if (ch === "(") {
      toks.push({ t: "lp" });
      i++;
    } else if (ch === ")") {
      toks.push({ t: "rp" });
      i++;
    } else {
      throw new Error(`Beklenmeyen karakter: "${ch}"`);
    }
  }
  return toks;
}

type Ast =
  | { k: "num"; v: number }
  | { k: "ref"; v: string }
  | { k: "bin"; op: "+" | "-" | "*" | "/"; l: Ast; r: Ast }
  | { k: "neg"; e: Ast };

function parse(toks: Tok[]): Ast {
  let pos = 0;
  function peek() {
    return toks[pos];
  }
  function expr(): Ast {
    let node = term();
    while (peek()?.t === "op" && (peek() as { v: string }).v.match(/[+\-]/)) {
      const op = (toks[pos++] as { v: "+" | "-" }).v;
      node = { k: "bin", op, l: node, r: term() };
    }
    return node;
  }
  function term(): Ast {
    let node = factor();
    while (peek()?.t === "op" && (peek() as { v: string }).v.match(/[*/]/)) {
      const op = (toks[pos++] as { v: "*" | "/" }).v;
      node = { k: "bin", op, l: node, r: factor() };
    }
    return node;
  }
  function factor(): Ast {
    const tok = toks[pos];
    if (!tok) throw new Error("Formül eksik bitti");
    if (tok.t === "num") {
      pos++;
      return { k: "num", v: tok.v };
    }
    if (tok.t === "ref") {
      pos++;
      return { k: "ref", v: tok.v };
    }
    if (tok.t === "op" && tok.v === "-") {
      pos++;
      return { k: "neg", e: factor() };
    }
    if (tok.t === "lp") {
      pos++;
      const inner = expr();
      if (toks[pos]?.t !== "rp") throw new Error("Kapanmayan parantez");
      pos++;
      return inner;
    }
    throw new Error("Formül çözümlenemedi");
  }
  const ast = expr();
  if (pos !== toks.length) throw new Error("Formülün sonunda fazlalık var");
  return ast;
}

export type Getter = (ref: string) => number | undefined;

function evalAst(ast: Ast, get: Getter): number | undefined {
  switch (ast.k) {
    case "num":
      return ast.v;
    case "ref":
      return get(ast.v);
    case "neg": {
      const v = evalAst(ast.e, get);
      return v == null ? undefined : -v;
    }
    case "bin": {
      const l = evalAst(ast.l, get);
      const r = evalAst(ast.r, get);
      if (l == null || r == null) return undefined;
      switch (ast.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r === 0 ? undefined : l / r;
      }
    }
  }
}

export type CompiledFormula = { refs: string[]; run: (get: Getter) => number | undefined };

export function compileFormula(src: string): CompiledFormula {
  const toks = tokenize(src);
  const ast = parse(toks);
  const refs = toks.filter((t): t is Extract<Tok, { t: "ref" }> => t.t === "ref").map((t) => t.v);
  return { refs, run: (get) => evalAst(ast, get) };
}
