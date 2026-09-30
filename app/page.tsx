"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  Line,
} from "react-chartjs-2";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  type ChartDataset,
  Decimation,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
} from "chart.js";
import {
  type Bucket,
  type BucketType,
  type MonthlyStatsRow,
  type OutcomeUnit,
  type PathMetrics,
  type SimulationInput,
  type SimulationResult,
  createSimContext,
  simulatePath,
} from "../lib/simulation";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Decimation,
  Tooltip,
  Legend
);

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

type Point = { x: number; y: number };

const defaultBuckets: Bucket[] = [
  {
    id: "fat_tail_loss",
    name: "Fat tail loss",
    p: 0.01,
    type: "uniform",
    lo: -5,
    hi: -1.5,
  },
  { id: "hard_loss", name: "Hard loss", p: 0.49, type: "point", v: -1 },
  {
    id: "norm_loss",
    name: "Smaller loss",
    p: 0.1,
    type: "uniform",
    lo: -0.9,
    hi: -0.5,
  },
  {
    id: "scratch",
    name: "Scratch",
    p: 0.15,
    type: "uniform",
    lo: -0.5,
    hi: 0.5,
  },
  {
    id: "small_win",
    name: "Small win",
    p: 0.23,
    type: "uniform",
    lo: 0.5,
    hi: 3,
  },
  {
    id: "big_win",
    name: "Big win",
    p: 0.02,
    type: "uniform",
    lo: 15,
    hi: 30,
  },
];

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 2,
});

function roundTo(value: number, step: number) {
  if (!Number.isFinite(value) || step === 0) return value;
  return Math.round(value / step) * step;
}

function toPoints(values: ArrayLike<number>) {
  const points: Point[] = new Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    points[i] = { x: i + 1, y: values[i] };
  }
  return points;
}

function parseNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Validated as a colorblind-safe pair on both light and dark panels.
const gainColor = "#3b82f6";
const lossColor = "#ea580c";

const MonthlyReturnsChart = memo(function MonthlyReturnsChart({
  title,
  rows,
  yRange,
}: {
  title: string;
  rows: MonthlyStatsRow[];
  /** Shared across the three charts so their bars compare directly. */
  yRange: { min: number; max: number };
}) {
  const totalReturn =
    rows.length === 0
      ? 0
      : rows.reduce((acc, row) => acc * (1 + row.returnValue), 1) - 1;
  const positiveMonths = rows.filter((row) => row.returnValue > 0).length;

  const data = useMemo(
    () => ({
      labels: rows.map((row) => `${monthNames[row.month - 1]} ${String(row.year).slice(-2)}`),
      datasets: [
        {
          label: "Monthly return",
          data: rows.map((row) => row.returnValue),
          backgroundColor: rows.map((row) => (row.returnValue >= 0 ? gainColor : lossColor)),
          borderRadius: 4,
          borderSkipped: "start" as const,
          categoryPercentage: 0.85,
          barPercentage: 0.9,
          maxBarThickness: 28,
        },
      ],
    }),
    [rows]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      plugins: {
        legend: { display: false },
        tooltip: {
          intersect: false,
          mode: "index" as const,
          callbacks: {
            title: (items: { dataIndex: number }[]) => {
              const row = rows[items[0].dataIndex];
              return `${monthNames[row.month - 1]} ${row.year}`;
            },
            label: (item: { dataIndex: number }) => {
              const row = rows[item.dataIndex];
              return [
                `Return: ${percentFormatter.format(row.returnValue)}`,
                `Max DD: ${percentFormatter.format(row.maxDrawdown)}`,
                `Win rate: ${percentFormatter.format(row.winRate)}`,
                `Max losses in a row: ${row.maxConsecutiveLosses}`,
                `End equity: ${currencyFormatter.format(row.endEquity)}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            autoSkip: true,
            maxRotation: 0,
            maxTicksLimit: 8,
            color: "#9ca3af",
          },
        },
        y: {
          min: yRange.min,
          max: yRange.max,
          grid: {
            color: (ctx: { tick: { value: number } }) =>
              ctx.tick.value === 0 ? "rgba(148, 163, 184, 0.6)" : "rgba(0,0,0,0.05)",
          },
          ticks: {
            maxTicksLimit: 6,
            color: "#9ca3af",
            callback: (value: string | number) => percentFormatter.format(Number(value)),
          },
        },
      },
    }),
    [rows, yRange]
  );

  return (
    <div className="panel rounded-2xl border border-black/5 p-4 shadow-lg shadow-black/5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex flex-col">
          <h3 className="text-lg font-semibold text-[color:var(--panel-ink)]">{title}</h3>
          <span className="text-xs text-[color:var(--muted)]">
            Total return: {percentFormatter.format(totalReturn)} · {positiveMonths} of{" "}
            {rows.length} months positive
          </span>
        </div>
        <span className="mono text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
          Monthly Returns
        </span>
      </div>
      <div className="h-[240px] w-full">
        <Bar data={data} options={options} />
      </div>
    </div>
  );
});

const MetricsTable = memo(function MetricsTable({ metrics }: { metrics: PathMetrics[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse border border-white/20 text-xs">
        <thead className="text-center uppercase tracking-[0.2em] text-[color:var(--muted)]">
          <tr>
            <th className="border border-white/20 px-2 py-2">Pct</th>
            <th className="border border-white/20 px-2 py-2">Total Ret (Ann)</th>
            <th className="border border-white/20 px-2 py-2">Max DD</th>
            <th className="border border-white/20 px-2 py-2">Std Dev</th>
            <th className="border border-white/20 px-2 py-2">Sharpe (Ann)</th>
            <th className="border border-white/20 px-2 py-2">Calmar (Ann)</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric) => (
            <tr key={metric.label}>
              <td className="border border-white/20 px-2 py-2 text-center font-semibold">
                {metric.label}
              </td>
              <td className="border border-white/20 px-2 py-2 text-center">
                {percentFormatter.format(metric.totalReturn)}
              </td>
              <td className="border border-white/20 px-2 py-2 text-center">
                {percentFormatter.format(metric.maxDrawdown)}
              </td>
              <td className="border border-white/20 px-2 py-2 text-center">
                {percentFormatter.format(metric.stdDev)}
              </td>
              <td className="border border-white/20 px-2 py-2 text-center">
                {metric.sharpe.toFixed(2)}
              </td>
              <td className="border border-white/20 px-2 py-2 text-center">
                {metric.calmar.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

export default function Home() {
  const [startEquity, setStartEquity] = useState(300000);
  const [startEquityInput, setStartEquityInput] = useState(() =>
    numberFormatter.format(300000)
  );
  const [nTrades, setNTrades] = useState(600);
  const [nPaths, setNPaths] = useState(1000);
  const [riskFraction, setRiskFraction] = useState(0.003);
  const [seed, setSeed] = useState<string>("25");
  const [riskOfRuinThreshold, setRiskOfRuinThreshold] = useState(30);
  const [tradesPerMonth, setTradesPerMonth] = useState(50);
  const [startYear, setStartYear] = useState(2026);
  const [startMonth, setStartMonth] = useState(1);
  const [outcomeUnit, setOutcomeUnit] = useState<OutcomeUnit>("r");
  const [buckets, setBuckets] = useState<Bucket[]>(defaultBuckets);
  // Created from the R buckets the first time "% of equity" is selected.
  const [bucketsPct, setBucketsPct] = useState<Bucket[] | null>(null);
  const [useProgressiveExposure, setUseProgressiveExposure] = useState(false);
  const [lossStreakThreshold, setLossStreakThreshold] = useState(3);
  const [winStreakThreshold, setWinStreakThreshold] = useState(3);
  const [minRiskPercent, setMinRiskPercent] = useState(0.1);
  const [maxRiskPercent, setMaxRiskPercent] = useState(1.0);
  const [minSizeMultiple, setMinSizeMultiple] = useState(0.25);
  const [maxSizeMultiple, setMaxSizeMultiple] = useState(4);
  const [selectedPathIndex, setSelectedPathIndex] = useState(1);
  const [results, setResults] = useState<SimulationResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  // Saving waits until stored inputs are restored; otherwise the first save
  // (and Strict Mode's second mount) would overwrite them with the defaults.
  const [storageLoaded, setStorageLoaded] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("../lib/simulation.worker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent<SimulationResult>) => {
      setResults(event.data);
      setSelectedPathIndex(1);
      setIsRunning(false);
    };
    worker.onerror = (event) => {
      console.error("Simulation failed", event.message);
      setIsRunning(false);
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("mc_inputs_v1");
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<{
        startEquity: number;
        startEquityInput: string;
        nTrades: number;
        nPaths: number;
        riskFraction: number;
        seed: string;
        riskOfRuinThreshold: number;
        tradesPerMonth: number;
        startYear: number;
        startMonth: number;
        outcomeUnit: OutcomeUnit;
        buckets: Bucket[];
        bucketsPct: Bucket[] | null;
        useProgressiveExposure: boolean;
        lossStreakThreshold: number;
        winStreakThreshold: number;
        minRiskPercent: number;
        maxRiskPercent: number;
        minSizeMultiple: number;
        maxSizeMultiple: number;
        selectedPathIndex: number;
      }>;

      if (typeof saved.startEquity === "number") setStartEquity(saved.startEquity);
      if (typeof saved.startEquityInput === "string") setStartEquityInput(saved.startEquityInput);
      if (typeof saved.nTrades === "number") setNTrades(saved.nTrades);
      if (typeof saved.nPaths === "number") setNPaths(saved.nPaths);
      if (typeof saved.riskFraction === "number") setRiskFraction(saved.riskFraction);
      if (typeof saved.seed === "string") setSeed(saved.seed);
      if (typeof saved.riskOfRuinThreshold === "number")
        setRiskOfRuinThreshold(saved.riskOfRuinThreshold);
      if (typeof saved.tradesPerMonth === "number") setTradesPerMonth(saved.tradesPerMonth);
      if (typeof saved.startYear === "number") setStartYear(saved.startYear);
      if (typeof saved.startMonth === "number") setStartMonth(saved.startMonth);
      if (saved.outcomeUnit === "r" || saved.outcomeUnit === "percent")
        setOutcomeUnit(saved.outcomeUnit);
      if (Array.isArray(saved.buckets) && saved.buckets.length > 0) setBuckets(saved.buckets);
      if (Array.isArray(saved.bucketsPct) && saved.bucketsPct.length > 0)
        setBucketsPct(saved.bucketsPct);
      if (typeof saved.useProgressiveExposure === "boolean")
        setUseProgressiveExposure(saved.useProgressiveExposure);
      if (typeof saved.lossStreakThreshold === "number")
        setLossStreakThreshold(saved.lossStreakThreshold);
      if (typeof saved.winStreakThreshold === "number")
        setWinStreakThreshold(saved.winStreakThreshold);
      if (typeof saved.minRiskPercent === "number") setMinRiskPercent(saved.minRiskPercent);
      if (typeof saved.maxRiskPercent === "number") setMaxRiskPercent(saved.maxRiskPercent);
      if (typeof saved.minSizeMultiple === "number") setMinSizeMultiple(saved.minSizeMultiple);
      if (typeof saved.maxSizeMultiple === "number") setMaxSizeMultiple(saved.maxSizeMultiple);
      if (typeof saved.selectedPathIndex === "number") setSelectedPathIndex(saved.selectedPathIndex);
    } catch {
      // ignore invalid or unavailable storage
    } finally {
      setStorageLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!storageLoaded) return;
    const payload = {
      startEquity,
      startEquityInput,
      nTrades,
      nPaths,
      riskFraction,
      seed,
      riskOfRuinThreshold,
      tradesPerMonth,
      startYear,
      startMonth,
      outcomeUnit,
      buckets,
      bucketsPct,
      useProgressiveExposure,
      lossStreakThreshold,
      winStreakThreshold,
      minRiskPercent,
      maxRiskPercent,
      minSizeMultiple,
      maxSizeMultiple,
      selectedPathIndex,
    };
    const timer = setTimeout(() => {
      try {
        localStorage.setItem("mc_inputs_v1", JSON.stringify(payload));
      } catch {
        // storage full or unavailable
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [
    storageLoaded,
    startEquity,
    startEquityInput,
    nTrades,
    nPaths,
    riskFraction,
    seed,
    riskOfRuinThreshold,
    tradesPerMonth,
    startYear,
    startMonth,
    outcomeUnit,
    buckets,
    bucketsPct,
    useProgressiveExposure,
    lossStreakThreshold,
    winStreakThreshold,
    minRiskPercent,
    maxRiskPercent,
    minSizeMultiple,
    maxSizeMultiple,
    selectedPathIndex,
  ]);

  const isPercent = outcomeUnit === "percent";
  const activeBuckets = isPercent ? (bucketsPct ?? buckets) : buckets;
  const setActiveBuckets = isPercent ? setBucketsPct : setBuckets;
  const unitSuffix = isPercent ? "%" : "R";

  const handleOutcomeUnitChange = (next: OutcomeUnit) => {
    if (next === "percent" && !bucketsPct) {
      // Seed the % buckets with what the R buckets mean at the current risk,
      // so switching starts from an equivalent setup.
      const toPct = (r: number | undefined) =>
        r === undefined ? undefined : Number((r * riskFraction * 100).toFixed(2));
      setBucketsPct(
        buckets.map((b) => ({ ...b, lo: toPct(b.lo), hi: toPct(b.hi), v: toPct(b.v) }))
      );
    }
    setOutcomeUnit(next);
  };

  const probSum = useMemo(
    () => activeBuckets.reduce((acc, bucket) => acc + Math.max(0, bucket.p), 0),
    [activeBuckets]
  );

  const percentileEquityData = useMemo(() => {
    if (!results) return null;
    const palette = [
      "#7a7a7a",
      "#1d4ed8",
      "#0ea5e9",
      "#14b8a6",
      "#22c55e",
      "#f59e0b",
      "#f97316",
      "#ef4444",
      "#a855f7",
    ];

    const datasets: ChartDataset<"line", Point[]>[] = results.percentilePaths.map(
      ({ p, equity }, pIdx) => ({
        label: `${p}th percentile path`,
        data: toPoints(equity),
        borderColor: palette[pIdx % palette.length],
        borderWidth: p === 50 ? 3.5 : 1,
        pointRadius: 0,
        tension: 0,
      })
    );

    datasets.push({
      label: "Worst path",
      data: toPoints(results.worstPath),
      borderColor: "#ef4444",
      borderWidth: 2.5,
      pointRadius: 0,
      tension: 0,
      borderDash: [6, 4],
    });

    // A flat line only needs its two endpoints.
    const runStartEquity = results.input.startEquity;
    datasets.push({
      label: "Starting equity",
      data: [
        { x: 1, y: runStartEquity },
        { x: results.nTrades, y: runStartEquity },
      ],
      borderColor: "rgba(148, 163, 184, 0.9)",
      borderWidth: 1.8,
      pointRadius: 0,
      tension: 0,
      borderDash: [4, 4],
    });

    return { datasets };
  }, [results]);

  const drawdownData = useMemo(() => {
    if (!results) return null;
    return {
      datasets: [
        {
          label: "Median",
          data: toPoints(results.drawdowns.median),
          borderColor: "#2563eb",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: "Best",
          data: toPoints(results.drawdowns.best),
          borderColor: "#16a34a",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
        {
          label: "Worst",
          data: toPoints(results.drawdowns.worst),
          borderColor: "#dc2626",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0,
        },
      ],
    };
  }, [results]);

  const riskOfRuin = useMemo(() => {
    if (!results) return null;
    const threshold = Math.abs(riskOfRuinThreshold) / 100;
    let count = 0;
    for (const dd of results.maxDrawdowns) {
      if (Math.abs(dd) >= threshold) count += 1;
    }
    return {
      threshold,
      probability: count / results.maxDrawdowns.length,
    };
  }, [results, riskOfRuinThreshold]);

  const monthlyReturnRange = useMemo(() => {
    if (!results) return null;
    const { median, p5, p95 } = results.monthlyTables;
    let min = 0;
    let max = 0;
    for (const row of [...median, ...p5, ...p95]) {
      if (row.returnValue < min) min = row.returnValue;
      if (row.returnValue > max) max = row.returnValue;
    }
    const pad = (max - min) * 0.08 || 0.01;
    return { min: min < 0 ? min - pad : 0, max: max + pad };
  }, [results]);

  const drawdownHistogramData = useMemo(() => {
    if (!results) return null;
    return {
      labels: results.histograms.drawdown.bins.map((v) =>
        percentFormatter.format(roundTo(v, 0.01))
      ),
      datasets: [
        {
          label: "Max drawdown",
          data: results.histograms.drawdown.counts,
          backgroundColor: "rgba(220, 38, 38, 0.7)",
        },
      ],
    };
  }, [results]);

  const finalEquityHistogramData = useMemo(() => {
    if (!results) return null;
    return {
      labels: results.histograms.finalEquity.bins.map((v) =>
        currencyFormatter.format(roundTo(v, 1000))
      ),
      datasets: [
        {
          label: "Final equity",
          data: results.histograms.finalEquity.counts,
          backgroundColor: "rgba(37, 99, 235, 0.75)",
        },
      ],
    };
  }, [results]);

  const simContext = useMemo(
    () => (results ? createSimContext(results.input) : null),
    [results]
  );

  const tradeResultsData = useMemo(() => {
    if (!results || !simContext) return null;
    const clampedIndex = Math.min(
      Math.max(1, Math.trunc(selectedPathIndex)),
      results.nPaths
    );
    // Only a few paths are kept after a run; regenerate the selected one from its seed.
    const n = results.nTrades;
    const rPath = new Float64Array(n);
    const equityPath = new Float64Array(n);
    simulatePath(simContext, clampedIndex - 1, equityPath, rPath);

    // The R-size bands only mean something in R mode; % outcomes are colored by sign.
    const rMode = results.input.outcomeUnit === "r";
    const colors: string[] = new Array(n);
    const rPoints: Point[] = new Array(n);
    const equityPoints: Point[] = new Array(n);
    for (let i = 0; i < n; i += 1) {
      const y = rPath[i];
      colors[i] = !rMode
        ? y < 0
          ? "rgba(239, 68, 68, 0.85)"
          : "rgba(59, 130, 246, 0.6)"
        : y <= -0.5
          ? "rgba(239, 68, 68, 0.85)"
          : y < 0
            ? "rgba(249, 115, 22, 0.75)"
            : y >= 5
              ? "rgba(34, 197, 94, 0.85)"
              : "rgba(59, 130, 246, 0.6)";
      rPoints[i] = { x: i + 1, y };
      equityPoints[i] = { x: i + 1, y: equityPath[i] };
    }
    return {
      datasets: [
        {
          label: `Path ${clampedIndex}`,
          data: rPoints,
          pointRadius: 2.5,
          pointHoverRadius: 4,
          borderColor: "rgba(37, 99, 235, 0.25)",
          backgroundColor: colors,
          yAxisID: "yR",
          showLine: false,
        },
        {
          label: `Equity ${clampedIndex}`,
          type: "line" as const,
          data: equityPoints,
          borderColor: "rgba(168, 85, 247, 0.95)",
          backgroundColor: "rgba(168, 85, 247, 0.95)",
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 0,
          yAxisID: "yEquity",
          showLine: true,
          tension: 0,
        },
      ],
    };
  }, [results, simContext, selectedPathIndex]);

  // Line charts get {x, y} data on a linear x axis with parsing disabled, which
  // skips Chart.js's parse step and lets the decimation plugin thin long paths.
  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      parsing: false as const,
      normalized: true,
      plugins: {
        decimation: {
          enabled: true,
          algorithm: "lttb" as const,
        },
        legend: {
          display: true,
          position: "bottom" as const,
          labels: {
            usePointStyle: true,
            boxWidth: 8,
            boxHeight: 8,
            color: "#9ca3af",
            padding: 12,
            font: {
              size: 11,
              family: "var(--font-mono)",
            },
          },
        },
        tooltip: {
          intersect: false,
          mode: "index" as const,
        },
      },
      scales: {
        x: {
          type: "linear" as const,
          grid: {
            color: "rgba(0,0,0,0.05)",
          },
          ticks: {
            maxTicksLimit: 10,
            color: "#9ca3af",
          },
        },
        y: {
          grid: {
            color: "rgba(0,0,0,0.05)",
          },
          ticks: {
            color: "#9ca3af",
          },
        },
      },
    }),
    []
  );

  const histogramOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      plugins: {
        legend: {
          display: false,
        },
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 6,
            color: "#9ca3af",
          },
          grid: {
            display: false,
          },
        },
        y: {
          grid: {
            color: "rgba(0,0,0,0.05)",
          },
          ticks: {
            color: "#9ca3af",
          },
        },
      },
    }),
    []
  );

  const scatterUnit = results?.input.outcomeUnit ?? outcomeUnit;
  const scatterOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      parsing: false as const,
      normalized: true,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          intersect: false,
          mode: "nearest" as const,
        },
      },
      scales: {
        x: {
          type: "linear" as const,
          ticks: {
            maxTicksLimit: 10,
            color: "#9ca3af",
          },
          grid: {
            color: "rgba(0,0,0,0.05)",
          },
          title: {
            display: true,
            text: "Trade #",
            color: "#9ca3af",
          },
        },
        yR: {
          type: "linear" as const,
          position: "left" as const,
          grid: {
            color: "rgba(0,0,0,0.05)",
          },
          ticks: {
            color: "#9ca3af",
          },
          title: {
            display: true,
            text: scatterUnit === "percent" ? "% of equity" : "R multiple",
            color: "#9ca3af",
          },
        },
        yEquity: {
          type: "linear" as const,
          position: "right" as const,
          grid: {
            drawOnChartArea: false,
          },
          ticks: {
            color: "#9ca3af",
          },
          title: {
            display: true,
            text: "Equity",
            color: "#9ca3af",
          },
        },
      },
    }),
    [scatterUnit]
  );

  const handleRun = () => {
    const worker = workerRef.current;
    if (!worker) return;
    setIsRunning(true);
    const seedNumber = seed.trim() === "" ? null : Number(seed);
    const input: SimulationInput = {
      outcomeUnit,
      startEquity,
      nTrades,
      nPaths,
      riskFraction,
      seed: Number.isFinite(seedNumber as number) ? (seedNumber as number) : null,
      tradesPerMonth,
      startYear,
      startMonth,
      buckets: activeBuckets,
      progressive: useProgressiveExposure
        ? {
            lossStreakThreshold,
            winStreakThreshold,
            minRisk: isPercent ? minSizeMultiple : minRiskPercent / 100,
            maxRisk: isPercent ? maxSizeMultiple : maxRiskPercent / 100,
          }
        : null,
    };
    worker.postMessage(input);
  };

  const handleStartEquityBlur = () => {
    const normalized = startEquityInput.replace(/,/g, "");
    const value = parseNumber(normalized);
    setStartEquity(value);
    setStartEquityInput(numberFormatter.format(value));
  };

  return (
    <div className="min-h-screen px-6 py-10 text-[color:var(--foreground)]">
      <div className="mx-auto flex w-full max-w-[100%] flex-col gap-8">
        <header className="flex flex-col gap-4">
          <span className="mono text-xs uppercase tracking-[0.4em] text-[color:var(--accent-2)]">
            Monte Carlo Engine
          </span>
          <div className="flex flex-col gap-3">
            <h1 className="text-4xl font-semibold sm:text-5xl">Monte Carlo Simulation</h1>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[560px_1fr] xl:grid-cols-[620px_1fr]">
          <section className="panel flex flex-col gap-6 rounded-3xl border border-black/5 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Inputs</h2>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-6 rounded-2xl border border-black/10 p-5 shadow-sm shadow-black/5">
                <div className="grid gap-4">
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Start equity
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[color:var(--muted)]">
                        $
                      </span>
                      <input
                        className="w-full rounded-xl border border-black/10 bg-transparent py-2 pl-7 pr-3 text-base"
                        type="text"
                        inputMode="decimal"
                        value={startEquityInput}
                        onChange={(e) => {
                          const next = e.target.value.replace(/[^\d.,-]/g, "");
                          setStartEquityInput(next);
                        }}
                        onBlur={handleStartEquityBlur}
                      />
                    </div>
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Trades per path
                    <input
                      className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-base"
                      type="number"
                      value={nTrades}
                      onChange={(e) => setNTrades(parseNumber(e.target.value))}
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Paths
                    <input
                      className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-base"
                      type="number"
                      value={nPaths}
                      onChange={(e) => setNPaths(parseNumber(e.target.value))}
                    />
                  </label>
                  {/* % outcomes already are the equity change, so there is no risk to size by. */}
                  {!isPercent && (
                    <label className="flex flex-col gap-2 text-sm font-medium">
                      Risk Per Trade
                      <div className="relative">
                        <input
                          className="w-full rounded-xl border border-black/10 bg-transparent py-2 pl-3 pr-8 text-base"
                          type="number"
                          step="0.01"
                          value={Number((riskFraction * 100).toFixed(4))}
                          onChange={(e) => setRiskFraction(parseNumber(e.target.value) / 100)}
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[color:var(--muted)]">
                          %
                        </span>
                      </div>
                    </label>
                  )}
              <label className="flex flex-col gap-2 text-sm font-medium">
                Random seed (blank = random)
                <input
                  className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-base"
                  type="text"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium">
                <span className="inline-flex items-center gap-2">
                  Ruin threshold
                  <span className="group relative inline-flex h-5 w-5 items-center justify-center rounded-full border border-black/20 text-[10px] text-[color:var(--muted)]">
                    i
                    <span className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-56 -translate-x-1/2 rounded-lg border border-black/10 bg-[color:var(--panel)] px-2 py-2 text-[10px] text-[color:var(--panel-ink)] opacity-0 shadow-lg shadow-black/10 transition group-hover:opacity-100">
                      Ruin is defined as a drawdown from peak equity.
                    </span>
                  </span>
                </span>
                <div className="relative">
                  <input
                    className="w-full rounded-xl border border-black/10 bg-transparent py-2 pl-3 pr-8 text-base"
                    type="number"
                    step="0.1"
                    min={0}
                    value={riskOfRuinThreshold}
                    onChange={(e) => setRiskOfRuinThreshold(parseNumber(e.target.value))}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[color:var(--muted)]">
                    %
                  </span>
                </div>
              </label>
            </div>

                <div className="grid gap-4">
                  <h3 className="text-base font-semibold text-[color:var(--muted)]">Calendar</h3>
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Trades per month
                    <input
                      className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-base"
                      type="number"
                      value={tradesPerMonth}
                      onChange={(e) => setTradesPerMonth(parseNumber(e.target.value))}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-2 text-sm font-medium">
                      Start year
                      <input
                        className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-base"
                        type="number"
                        value={startYear}
                        onChange={(e) => setStartYear(parseNumber(e.target.value))}
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm font-medium">
                      Start month
                      <select
                        className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-base"
                        value={startMonth}
                        onChange={(e) => setStartMonth(parseNumber(e.target.value))}
                      >
                        {monthNames.map((name, idx) => (
                          <option key={name} value={idx + 1}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-black/10 p-5 shadow-sm shadow-black/5">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-[color:var(--muted)]">
                    {isPercent ? "Buckets % of equity" : "Buckets R multiples"}
                  </h3>
                  <span className="mono text-xs text-[color:var(--muted)]">
                    Sum = {numberFormatter.format(probSum)}
                  </span>
                </div>
                <div
                  role="radiogroup"
                  aria-label="Outcome unit"
                  className="grid grid-cols-2 gap-1 rounded-xl border border-black/10 p-1 text-xs font-semibold"
                >
                  {(
                    [
                      ["r", "R multiples"],
                      ["percent", "% of equity"],
                    ] as const
                  ).map(([unit, label]) => (
                    <button
                      key={unit}
                      type="button"
                      role="radio"
                      aria-checked={outcomeUnit === unit}
                      onClick={() => handleOutcomeUnitChange(unit)}
                      className={`rounded-lg px-2 py-1.5 transition ${
                        outcomeUnit === unit
                          ? "bg-indigo-500 text-white"
                          : "text-[color:var(--muted)] hover:bg-black/5"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-[color:var(--muted)]">
                  {isPercent
                    ? "Each outcome is the trade's gain or loss as a % of total equity."
                    : "Each outcome is a multiple of the amount risked per trade."}
                </p>
                <div className="grid gap-3">
                  {activeBuckets.map((bucket, idx) => (
                    <div key={bucket.id} className="rounded-2xl border border-black/5 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <input
                          className="w-full rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm font-semibold"
                          value={bucket.name}
                          onChange={(e) => {
                            const next = [...activeBuckets];
                            next[idx] = { ...bucket, name: e.target.value };
                            setActiveBuckets(next);
                          }}
                        />
                        <select
                          className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs uppercase"
                          value={bucket.type}
                          onChange={(e) => {
                            const next = [...activeBuckets];
                            next[idx] = { ...bucket, type: e.target.value as BucketType };
                            setActiveBuckets(next);
                          }}
                        >
                          <option value="uniform">Range</option>
                          <option value="point">Fixed</option>
                        </select>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <label className="flex flex-col gap-1">
                          Prob
                        <div className="relative">
                          <input
                            className="w-full rounded-lg border border-black/10 bg-transparent py-1 pl-2 pr-6"
                            type="number"
                            step="0.1"
                            value={Number((bucket.p * 100).toFixed(2))}
                            onChange={(e) => {
                              const next = [...activeBuckets];
                              next[idx] = { ...bucket, p: parseNumber(e.target.value) / 100 };
                              setActiveBuckets(next);
                            }}
                          />
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[color:var(--muted)]">
                            %
                          </span>
                        </div>
                        </label>
                        {bucket.type === "uniform" ? (
                          <>
                            <label className="flex flex-col gap-1">
                              Min {unitSuffix}
                              <input
                                className="rounded-lg border border-black/10 bg-transparent px-2 py-1"
                                type="number"
                                step="0.1"
                                value={bucket.lo ?? 0}
                                onChange={(e) => {
                                  const next = [...activeBuckets];
                                  next[idx] = { ...bucket, lo: parseNumber(e.target.value) };
                                  setActiveBuckets(next);
                                }}
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              Max {unitSuffix}
                              <input
                                className="rounded-lg border border-black/10 bg-transparent px-2 py-1"
                                type="number"
                                step="0.1"
                                value={bucket.hi ?? 0}
                                onChange={(e) => {
                                  const next = [...activeBuckets];
                                  next[idx] = { ...bucket, hi: parseNumber(e.target.value) };
                                  setActiveBuckets(next);
                                }}
                              />
                            </label>
                          </>
                        ) : (
                          <label className="flex flex-col gap-1">
                            {isPercent ? "Value %" : "R"}
                            <input
                              className="rounded-lg border border-black/10 bg-transparent px-2 py-1"
                              type="number"
                              step="0.1"
                              value={bucket.v ?? 0}
                              onChange={(e) => {
                                const next = [...activeBuckets];
                                next[idx] = { ...bucket, v: parseNumber(e.target.value) };
                                setActiveBuckets(next);
                              }}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-black/10 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold">Progressive exposure</h3>
                  <p className="text-xs text-[color:var(--muted)]">
                    {isPercent
                      ? "Scale position size based on streaks. Loss streak halves size, win streak doubles it (1× = outcomes as entered)."
                      : "Adjust risk based on streaks. Loss streak halves risk, win streak doubles it."}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={useProgressiveExposure}
                    onChange={(e) => setUseProgressiveExposure(e.target.checked)}
                  />
                  Enabled
                </label>
              </div>

              {useProgressiveExposure && (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Losses in a row
                    <input
                      className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-base"
                      type="number"
                      min={1}
                      value={lossStreakThreshold}
                      onChange={(e) => setLossStreakThreshold(parseNumber(e.target.value))}
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Wins in a row
                    <input
                      className="rounded-xl border border-black/10 bg-transparent px-3 py-2 text-base"
                      type="number"
                      min={1}
                      value={winStreakThreshold}
                      onChange={(e) => setWinStreakThreshold(parseNumber(e.target.value))}
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    {isPercent ? "Min size" : "Min risk"}
                    <div className="relative">
                      <input
                        className="w-full rounded-xl border border-black/10 bg-transparent py-2 pl-3 pr-8 text-base"
                        type="number"
                        step="0.01"
                        min={0}
                        value={isPercent ? minSizeMultiple : minRiskPercent}
                        onChange={(e) =>
                          (isPercent ? setMinSizeMultiple : setMinRiskPercent)(
                            parseNumber(e.target.value)
                          )
                        }
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[color:var(--muted)]">
                        {isPercent ? "×" : "%"}
                      </span>
                    </div>
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    {isPercent ? "Max size" : "Max risk"}
                    <div className="relative">
                      <input
                        className="w-full rounded-xl border border-black/10 bg-transparent py-2 pl-3 pr-8 text-base"
                        type="number"
                        step="0.01"
                        min={0}
                        value={isPercent ? maxSizeMultiple : maxRiskPercent}
                        onChange={(e) =>
                          (isPercent ? setMaxSizeMultiple : setMaxRiskPercent)(
                            parseNumber(e.target.value)
                          )
                        }
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[color:var(--muted)]">
                        {isPercent ? "×" : "%"}
                      </span>
                    </div>
                  </label>
                </div>
              )}
            </div>

            <button
              className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-500 via-blue-500 to-violet-500 px-5 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-white shadow-lg shadow-indigo-500/30 transition hover:-translate-y-0.5 hover:from-violet-500 hover:via-indigo-500 hover:to-blue-500"
              onClick={handleRun}
              disabled={isRunning}
            >
              <span className="pointer-events-none absolute inset-0 bg-white/10 opacity-0 transition group-hover:opacity-30" />
              {isRunning ? "Running..." : "Run Simulation"}
            </button>
          </section>

          <section className="flex flex-col gap-6">
            <div className="panel rounded-3xl border border-black/5 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <h2 className="text-xl font-semibold">Summary</h2>
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
                    <span className="rounded-full border border-black/10 px-2 py-1">
                      {results
                        ? `${results.nPaths.toLocaleString()} paths`
                        : "0 paths"}
                    </span>
                    <span className="rounded-full border border-black/10 px-2 py-1">
                      {results
                        ? `${results.nTrades.toLocaleString()} trades`
                        : "0 trades"}
                    </span>
                  </div>
                </div>
              </div>

              {results ? (
                <div className="mt-6 grid gap-4 md:grid-cols-5">
                  <div className="rounded-2xl border border-black/5 p-4 md:col-span-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
                        Trade Results
                      </p>
                      <label className="flex items-center gap-2 text-xs text-[color:var(--muted)]">
                        Path
                        <input
                          className="w-16 rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs"
                          type="number"
                          min={1}
                          max={results.nPaths}
                          value={selectedPathIndex}
                          onChange={(e) => setSelectedPathIndex(parseNumber(e.target.value))}
                        />
                      </label>
                    </div>
                    <div className="mt-3 h-[220px] w-full rounded-2xl border border-black/5">
                      {tradeResultsData ? <Line data={tradeResultsData} options={scatterOptions} /> : null}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-black/5 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
                      Payoff Buckets
                    </p>
                    <div className="mt-3 grid gap-2 text-xs">
                      {activeBuckets.map((bucket) => (
                        <div key={bucket.id} className="flex items-center justify-between gap-2">
                          <span className="truncate text-[color:var(--muted)]">
                            {bucket.type === "point"
                              ? `${bucket.name} (${bucket.v}${unitSuffix})`
                              : `${bucket.name} (${bucket.lo}${unitSuffix} to ${bucket.hi}${unitSuffix})`}
                          </span>
                          <span className="mono text-[color:var(--panel-ink)]">
                            {(bucket.p * 100).toFixed(1)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-black/5 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
                      Final Equity 
                    </p>
                    <div className="mt-3 grid gap-2 text-xs font-semibold">
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">95% chance</span>
                        <span>{currencyFormatter.format(results.stats.final5)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">50% chance</span>
                        <span>{currencyFormatter.format(results.stats.final50)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">5% chance</span>
                        <span>{currencyFormatter.format(results.stats.final95)}</span>
                      </div>
                    </div>
                    <div className="mt-3 border-t border-black/5 pt-3 text-xs">
                      <div className="flex items-center justify-between text-[color:var(--muted)]">
                        <span>Risk of ruin (DD ≥ {riskOfRuinThreshold}%)</span>
                        <span className="font-semibold text-[color:var(--panel-ink)]">
                          {riskOfRuin ? percentFormatter.format(riskOfRuin.probability) : "-"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-black/5 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
                      Max Drawdown & Max Consecutive Losses
                    </p>
                    <div className="mt-3 grid gap-3 text-xs font-semibold">
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">Max drawdown 95% chance</span>
                        <span>{percentFormatter.format(results.stats.dd5)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">Max drawdown 50% chance</span>
                        <span>{percentFormatter.format(results.stats.dd50)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">Max drawdown 5% chance</span>
                        <span>{percentFormatter.format(results.stats.dd95)}</span>
                      </div>
                      <div className="my-1 border-t border-black/5" />
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">Consecutive losses 95% chance</span>
                        <span>{numberFormatter.format(results.stats.mcl5)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">Consecutive losses 50% chance</span>
                        <span>{numberFormatter.format(results.stats.mcl50)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">Consecutive losses 5% chance</span>
                        <span>{numberFormatter.format(results.stats.mcl95)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-dashed border-black/10 p-6 text-sm text-[color:var(--muted)]">
                  Configure inputs and run the simulation to see paths, drawdowns, and monthly tables.
                </div>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="panel rounded-3xl border border-black/5 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Equity Percentiles</h2>
              </div>
              <p className="mt-2 text-sm text-[color:var(--muted)]">
                Each line is an actual path whose final equity is closest to the 10–90th percentiles.
              </p>
                <div className="h-[320px] w-full rounded-2xl border border-black/5">
                  {percentileEquityData ? <Line data={percentileEquityData} options={chartOptions} /> : null}
                </div>
            </div>
            <div className="panel rounded-3xl border border-black/5 p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Metrics</h3>
              </div>
              {results ? (
                <MetricsTable metrics={results.metrics} />
              ) : (
                <p className="mt-3 text-xs text-[color:var(--muted)]">
                  Run the simulation to see metrics for each percentile path.
                </p>
              )}
            </div>
            </div>

            {results && monthlyReturnRange && (
              <div className="grid gap-6 lg:grid-cols-3">
                <MonthlyReturnsChart
                  title="Median Path"
                  rows={results.monthlyTables.median}
                  yRange={monthlyReturnRange}
                />
                <MonthlyReturnsChart
                  title="95% Chance Path"
                  rows={results.monthlyTables.p5}
                  yRange={monthlyReturnRange}
                />
                <MonthlyReturnsChart
                  title="5% Chance Path"
                  rows={results.monthlyTables.p95}
                  yRange={monthlyReturnRange}
                />
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-3">
              <div className="panel rounded-3xl border border-black/5 p-6">
                <h2 className="text-xl font-semibold">Drawdown Paths</h2>
                <p className="mt-2 text-sm text-[color:var(--muted)]">
                  Median, best, and worst drawdown trajectories.
                </p>
                <div className="mt-4 h-[240px] w-full rounded-2xl border border-black/5">
                  {drawdownData ? <Line data={drawdownData} options={chartOptions} /> : null}
                </div>
              </div>
              <div className="panel rounded-3xl border border-black/5 p-6">
                <h2 className="text-xl font-semibold">Max Drawdown Distribution</h2>
                <p className="mt-2 text-sm text-[color:var(--muted)]">
                  Distribution of maximum drawdown per path.
                </p>
                <div className="mt-4 h-[240px] w-full rounded-2xl border border-black/5">
                  {drawdownHistogramData ? (
                    <Bar data={drawdownHistogramData} options={histogramOptions} />
                  ) : null}
                </div>
              </div>
              <div className="panel rounded-3xl border border-black/5 p-6">
                <h2 className="text-xl font-semibold">Final Equity Distribution</h2>
                <p className="mt-2 text-sm text-[color:var(--muted)]">
                  Histogram of final equity across all paths.
                </p>
                <div className="mt-4 h-[240px] w-full rounded-2xl border border-black/5">
                  {finalEquityHistogramData ? (
                    <Bar data={finalEquityHistogramData} options={histogramOptions} />
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
