import { useEffect, useRef } from "react";
import Plotly from "plotly.js-dist-min";

interface Props {
  data: Partial<Plotly.PlotData>[];
  layout: Partial<Plotly.Layout>;
  config?: Partial<Plotly.Config>;
  className?: string;
  onClick?: (e: Plotly.PlotMouseEvent) => void;
}

/** Thin imperative wrapper around Plotly.react (no react-plotly dependency). */
export default function Plot({ data, layout, config, className, onClick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    void Plotly.react(el, data as Plotly.Data[], { autosize: true, ...layout }, { responsive: true, displaylogo: false, ...config }).then(() => {
      const gd = el as unknown as Plotly.PlotlyHTMLElement;
      gd.removeAllListeners?.("plotly_click");
      gd.on("plotly_click", (e) => clickRef.current?.(e));
    });
  }, [data, layout, config]);

  useEffect(() => {
    const el = ref.current;
    return () => { if (el) Plotly.purge(el); };
  }, []);

  return <div ref={ref} className={className} />;
}

export const darkLayout = (dark: boolean): Partial<Plotly.Layout> => ({
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: dark ? "#d6d3d1" : "#57534e", size: 11, family: "Inter, system-ui, sans-serif" },
});
