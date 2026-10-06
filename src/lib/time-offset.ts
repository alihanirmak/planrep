// Zaman-serisi referans ofsetleri: formul motorunun [REF] sozdizimine ek bir
// konvansiyon katmani. Formul motoru (lib/formula.ts) herhangi bir karakteri
// (nokta dahil) ref metni olarak kabul eder; bu modul CALLER tarafinda
// (lib/report-types.ts computeCalcCells, components/ReportView.tsx calcRowsComputed)
// kullanilan Getter'i sarmalayarak ".PY" (onceki yil, ayni donem) ve
// ".MOVAVG(n)" (son n donemin hareketli ortalamasi) soneklerini cozer.
//
// Donem kod formati, veritabani seed'indeki TIME boyutu ile ayni kabul edilir:
// "YYYY" (yil) veya "YYYY-MM" (ay). Baska bir formatta kod verilirse (orn.
// standart bir boyutun kodu), sonek eslesmezse referans degismeden alt
// getter'a iletilir.

const PY_RE = /^(.+)\.PY$/i;
const MOVAVG_RE = /^(.+)\.MOVAVG\((\d+)\)$/i;

function shiftYear(code: string, deltaYears: number): string | null {
  const m = code.match(/^(\d{4})(-(\d{2}))?$/);
  if (!m) return null;
  const year = Number(m[1]) + deltaYears;
  return m[3] ? `${year}-${m[3]}` : String(year);
}

function shiftMonth(code: string, deltaMonths: number): string | null {
  const m = code.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  let year = Number(m[1]);
  let month = Number(m[2]) + deltaMonths;
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

// code'dan geriye dogru n donemlik pencere (code dahil, en yeniden en eskiye).
// Ay formatinda (YYYY-MM) ay bazinda, yil formatinda (YYYY) yil bazinda kayar.
function periodWindow(code: string, n: number): string[] {
  const isMonth = /^\d{4}-\d{2}$/.test(code);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = i === 0 ? code : isMonth ? shiftMonth(code, -i) : shiftYear(code, -i);
    if (c) out.push(c);
  }
  return out;
}

export type RefGetter = (ref: string) => number | undefined;

// Verilen temel getter'i ".PY"/".MOVAVG(n)" soneklerini anlayacak sekilde sarar.
export function withTimeOffsets(baseGet: RefGetter): RefGetter {
  return (ref: string) => {
    const py = ref.match(PY_RE);
    if (py) {
      const prev = shiftYear(py[1], -1);
      return prev != null ? baseGet(prev) : undefined;
    }
    const mov = ref.match(MOVAVG_RE);
    if (mov) {
      const n = Number(mov[2]);
      if (!n || n < 1) return undefined;
      const codes = periodWindow(mov[1], n);
      const vals = codes.map(baseGet).filter((v): v is number => v != null);
      if (vals.length === 0) return undefined;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    return baseGet(ref);
  };
}
