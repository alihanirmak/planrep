// Buyuk pivot tablolari (coklu-tenant demo verisinde oldugu gibi binlerce
// satirli hiyerarsik tablolar) icin satir sanallastirma (virtualization)
// matematigini icerir. Kasitli olarak React/DOM'dan bagimsiz, saf bir
// fonksiyon olarak tutuldu — hem PivotGrid.tsx'te kullanilabilsin hem de
// (bu projenin test altyapisi jsdom/@testing-library icermedigi icin,
// bkz. vitest.config.ts "environment: node") DOM render'i gerektirmeden
// birim test edilebilsin.
export type VirtualRangeInput = {
  totalCount: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscan?: number;
};

export type VirtualRange = {
  // [startIndex, endIndex) — endIndex haric ust sinir (Array.slice semantigi)
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
};

// Verilen kaydirma konumuna gore gorunur satir araligini + ustte/altta
// bosluk (spacer) yuksekliklerini hesaplar. Tum satirlarin AYNI yukseklige
// sahip oldugu (fixed row height) varsayilir — PivotGrid'deki satirlar
// tek satirlik, sabit padding'li (whitespace-nowrap) oldugundan bu varsayim
// gecerlidir.
export function computeVirtualRange(input: VirtualRangeInput): VirtualRange {
  const { totalCount, rowHeight, viewportHeight, scrollTop, overscan = 8 } = input;

  if (totalCount <= 0 || rowHeight <= 0) {
    return { startIndex: 0, endIndex: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 };
  }

  // viewportHeight henuz olculmemisse (ilk render, ResizeObserver callback'i
  // calismadan once) tum satirlari "gorunur" kabul et — bir sonraki olcumde
  // gercek araliga daralir, bu arada hicbir satir eksik gorunmez.
  const visibleCount =
    viewportHeight > 0 ? Math.ceil(viewportHeight / rowHeight) : totalCount;

  const rawStart = Math.floor(scrollTop / rowHeight) - overscan;
  const startIndex = Math.max(0, Math.min(rawStart, totalCount - 1));
  const endIndex = Math.min(totalCount, startIndex + visibleCount + overscan * 2);

  return {
    startIndex,
    endIndex,
    topSpacerHeight: startIndex * rowHeight,
    bottomSpacerHeight: (totalCount - endIndex) * rowHeight,
  };
}
