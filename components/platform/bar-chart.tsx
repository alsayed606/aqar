// A monthly bar chart drawn as SVG on the server — no chart library, no client JS, and it renders
// inside the RSC stream like the rest of the page.
//
// Two deliberate choices:
//   • Time runs left→right even though the page is RTL. Months are a number line, and every finance
//     tool the reader already uses (Excel, the bank's statement) draws them that way; flipping only
//     this one chart would be the surprising thing. The wrapper is dir="ltr" so the axis agrees.
//   • Zero months are drawn as zero-height bars, not skipped. A gap that closes over a month claims
//     revenue continued when it did not.

export type BarPoint = { label: string; value: number; title?: string };

const W = 720;
const PAD_X = 8;
const PAD_TOP = 12;

export function BarChart({
  data,
  height = 150,
  emptyText = "لا بيانات في هذه الفترة.",
}: {
  data: BarPoint[];
  height?: number;
  emptyText?: string;
}) {
  if (data.length === 0) return <p className="py-8 text-center text-sm text-slate-500">{emptyText}</p>;

  const max = Math.max(...data.map((d) => d.value));
  if (max <= 0) return <p className="py-8 text-center text-sm text-slate-500">{emptyText}</p>;

  const slot = (W - PAD_X * 2) / data.length;
  const barW = Math.min(slot * 0.62, 46);
  const plot = height - PAD_TOP;

  return (
    <div dir="ltr" className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${height + 22}`} className="h-auto w-full min-w-[420px]" role="img">
        <line x1={PAD_X} y1={height} x2={W - PAD_X} y2={height} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="1" />
        {data.map((d, i) => {
          const h = Math.max((d.value / max) * plot, d.value > 0 ? 2 : 0);
          const x = PAD_X + i * slot + (slot - barW) / 2;
          return (
            <g key={d.label}>
              <title>{d.title ?? `${d.label}: ${d.value}`}</title>
              <rect
                x={x}
                y={height - h}
                width={barW}
                height={h}
                rx="3"
                className="fill-brand/80 transition-[fill] hover:fill-brand"
              />
              <text
                x={x + barW / 2}
                y={height + 15}
                textAnchor="middle"
                className="fill-slate-400 text-[10px]"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
