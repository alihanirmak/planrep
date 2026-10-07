// AI ile Gelistirme ozelliginin (bkz. lib/ai/dev-actions.ts) olusturdugu
// kayitlari insan-olusturdugundan ayirt eden kucuk, tek amacli bir rozet —
// SADECE goruntuleme amacli, hicbir yetki/is mantigi tasimaz.
export default function AiBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="AI ile oluşturuldu"
      className={`rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ${className}`}
    >
      🤖 AI
    </span>
  );
}
