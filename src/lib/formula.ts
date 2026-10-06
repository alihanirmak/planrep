// Guvenli formul motoru: [KOLON_KODU] referanslari, + - * / ( ) sayilar,
// karsilastirma operatorleri (> < >= <= = <>) ve fonksiyonlar: IF, SUM, AVG, MIN, MAX, SUMIF.
// Fonksiyon argumanlari noktali virgul (;) ile ayrilir (tr-TR Excel/EGER
// konvansiyonu); virgul sadece ondalik ayirici olarak kullanilir.
// Ornek: IF([ACTUAL]>[BUDGET]; ([ACTUAL]-[BUDGET])/[BUDGET]*100; 0)
// SUMIF ornegi: SUMIF([ACTUAL]>[BUDGET]; [ACTUAL]; [ACTUAL2]>[BUDGET2]; [ACTUAL2])
//   — kosul-deger ikilileri alir, kosulu dogru olanlarin degerini toplar
//     (Excel SUMIF'in bu DSL'de tek satirlik skalar degerler uzerinde calisan
//     karsiligi; "range" kavrami yok, bunun yerine her ikili ayri bir kosul/deger
//     cifti olarak verilir).

type Tok =
  | { t: "num"; v: number }
  | { t: "ref"; v: string }
  | { t: "ident"; v: string }
  | { t: "op"; v: "+" | "-" | "*" | "/" }
  | { t: "cmp"; v: ">" | "<" | ">=" | "<=" | "=" | "<>" }
  | { t: "sep" }
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
      while (j < src.length) {
        const c = src[j];
        if (/[0-9.]/.test(c)) {
          j++;
        } else if (c === "," && /[0-9]/.test(src[j + 1] ?? "")) {
          // Ondalik virgul (tr-TR): sadece hemen ardindan rakam geliyorsa sayinin
          // parcasidir. Fonksiyon argumanlari noktali virgul (;) ile ayrilir
          // (tr-TR Excel/EGER konvansiyonu) — boylece "1,5" ile "IF(a;1,5;2)"
          // arasinda belirsizlik olmaz.
          j++;
        } else {
          break;
        }
      }
      const num = parseFloat(src.slice(i, j).replace(",", "."));
      if (Number.isNaN(num)) throw new Error(`Geçersiz sayı: ${src.slice(i, j)}`);
      toks.push({ t: "num", v: num });
      i = j;
    } else if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push({ t: "ident", v: src.slice(i, j).toUpperCase() });
      i = j;
    } else if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      toks.push({ t: "op", v: ch });
      i++;
    } else if (ch === ">" || ch === "<") {
      if (src[i + 1] === "=") {
        toks.push({ t: "cmp", v: (ch + "=") as ">=" | "<=" });
        i += 2;
      } else if (ch === "<" && src[i + 1] === ">") {
        toks.push({ t: "cmp", v: "<>" });
        i += 2;
      } else {
        toks.push({ t: "cmp", v: ch as ">" | "<" });
        i++;
      }
    } else if (ch === "=") {
      toks.push({ t: "cmp", v: "=" });
      i++;
    } else if (ch === ";") {
      toks.push({ t: "sep" });
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
  | { k: "neg"; e: Ast }
  | { k: "if"; cond: CondAst; then: Ast; else: Ast }
  | { k: "call"; name: "SUM" | "AVG" | "MIN" | "MAX"; args: Ast[] }
  | { k: "sumif"; pairs: Array<{ cond: CondAst; value: Ast }> };

type CondAst = { l: Ast; op: ">" | "<" | ">=" | "<=" | "=" | "<>"; r: Ast };

const AGG_FUNCS = new Set(["SUM", "AVG", "MIN", "MAX"]);

function parse(toks: Tok[]): Ast {
  let pos = 0;
  function peek() {
    return toks[pos];
  }
  function expect<T extends Tok["t"]>(t: T): Tok & { t: T } {
    const tok = toks[pos];
    if (!tok || tok.t !== t) throw new Error(`Beklenmeyen ifade (bekleniyordu: ${t})`);
    pos++;
    return tok as Tok & { t: T };
  }

  function cond(): CondAst {
    const l = expr();
    const cmpTok = peek();
    if (!cmpTok || cmpTok.t !== "cmp") throw new Error("IF koşulunda karşılaştırma operatörü bekleniyor");
    pos++;
    const r = expr();
    return { l, op: (cmpTok as { v: CondAst["op"] }).v, r };
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
      expect("rp");
      return inner;
    }
    if (tok.t === "ident") {
      const name = tok.v;
      pos++;
      expect("lp");
      if (name === "IF") {
        const c = cond();
        expect("sep");
        const thenE = expr();
        expect("sep");
        const elseE = expr();
        expect("rp");
        return { k: "if", cond: c, then: thenE, else: elseE };
      }
      if (AGG_FUNCS.has(name)) {
        const args: Ast[] = [expr()];
        while (peek()?.t === "sep") {
          pos++;
          args.push(expr());
        }
        expect("rp");
        return { k: "call", name: name as "SUM" | "AVG" | "MIN" | "MAX", args };
      }
      if (name === "SUMIF") {
        const pairs: Array<{ cond: CondAst; value: Ast }> = [];
        const readPair = () => {
          const c = cond();
          expect("sep");
          const v = expr();
          pairs.push({ cond: c, value: v });
        };
        readPair();
        while (peek()?.t === "sep") {
          pos++;
          readPair();
        }
        expect("rp");
        return { k: "sumif", pairs };
      }
      throw new Error(`Bilinmeyen fonksiyon: ${name}`);
    }
    throw new Error("Formül çözümlenemedi");
  }
  const ast = expr();
  if (pos !== toks.length) throw new Error("Formülün sonunda fazlalık var");
  return ast;
}

export type Getter = (ref: string) => number | undefined;

function evalCond(c: CondAst, get: Getter): boolean | undefined {
  const l = evalAst(c.l, get);
  const r = evalAst(c.r, get);
  if (l == null || r == null) return undefined;
  switch (c.op) {
    case ">":
      return l > r;
    case "<":
      return l < r;
    case ">=":
      return l >= r;
    case "<=":
      return l <= r;
    case "=":
      return l === r;
    case "<>":
      return l !== r;
  }
}

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
    case "if": {
      const c = evalCond(ast.cond, get);
      if (c == null) return undefined;
      return evalAst(c ? ast.then : ast.else, get);
    }
    case "call": {
      // SUM/AVG/MIN/MAX: eksik (undefined) argumanlar atlanir (Excel SUMIF/AVERAGEIF
      // davranisina benzer); tum argumanlar eksikse sonuc undefined'dir.
      const vals = ast.args.map((a) => evalAst(a, get)).filter((v): v is number => v != null);
      if (vals.length === 0) return undefined;
      switch (ast.name) {
        case "SUM":
          return vals.reduce((a, b) => a + b, 0);
        case "AVG":
          return vals.reduce((a, b) => a + b, 0) / vals.length;
        case "MIN":
          return Math.min(...vals);
        case "MAX":
          return Math.max(...vals);
      }
    }
    case "sumif": {
      // Kosulu dogru olan ikililerin degerini toplar; kosulu eksik referans
      // nedeniyle hesaplanamayan (undefined) veya yanlis olan ikililer atlanir
      // (SUM/AVG ile ayni "eksigi atla" felsefesi). Hic eslesen ikili yoksa
      // (veya eslesenlerin degeri eksikse) sonuc undefined olur.
      const vals = ast.pairs
        .filter((p) => evalCond(p.cond, get) === true)
        .map((p) => evalAst(p.value, get))
        .filter((v): v is number => v != null);
      if (vals.length === 0) return undefined;
      return vals.reduce((a, b) => a + b, 0);
    }
  }
}

function collectRefs(ast: Ast, out: string[]) {
  switch (ast.k) {
    case "ref":
      out.push(ast.v);
      break;
    case "neg":
      collectRefs(ast.e, out);
      break;
    case "bin":
      collectRefs(ast.l, out);
      collectRefs(ast.r, out);
      break;
    case "if":
      collectRefs(ast.cond.l, out);
      collectRefs(ast.cond.r, out);
      collectRefs(ast.then, out);
      collectRefs(ast.else, out);
      break;
    case "call":
      for (const a of ast.args) collectRefs(a, out);
      break;
    case "sumif":
      for (const p of ast.pairs) {
        collectRefs(p.cond.l, out);
        collectRefs(p.cond.r, out);
        collectRefs(p.value, out);
      }
      break;
  }
}

export type CompiledFormula = { refs: string[]; run: (get: Getter) => number | undefined };

export function compileFormula(src: string): CompiledFormula {
  const toks = tokenize(src);
  const ast = parse(toks);
  const refs: string[] = [];
  collectRefs(ast, refs);
  return { refs, run: (get) => evalAst(ast, get) };
}
