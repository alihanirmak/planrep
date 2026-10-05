export default function Placeholder({
  title,
  note,
}: {
  title: string;
  note: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">{title}</h1>
      <div className="mt-6 rounded-xl border-2 border-dashed border-slate-300 bg-white/50 p-10 text-center text-sm text-slate-500">
        🚧 {note}
      </div>
    </div>
  );
}
