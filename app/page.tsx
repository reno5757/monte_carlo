"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  Line,
  Scatter,
} from "react-chartjs-2";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
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

type BucketType = "uniform" | "point";

type Bucket = {
  id: string;
  name: string;
  p: number;
  type: BucketType;
  lo?: number;
  hi?: number;
  v?: number;
};

type Histogram = {
  bins: number[];
  counts: number[];
  min: number;
  max: number;
};

type MonthlyStatsRow = {
  year: number;
  month: number;
  returnValue: number;
  maxDrawdown: number;
  winRate: number;
  maxConsecutiveLosses: number;
  endEquity: number;
};

type SimulationResult = {
  equityPaths: Float64Array[];
  rPaths: Float64Array[];
  finalEquity: number[];
  maxDrawdowns: number[];
  medianIdx: number;
  bestIdx: number;
  worstIdx: number;
  equityMin: number;
  equityMax: number;
  stats: {
    final5: number;
    final50: number;
    final95: number;
    dd5: number;
    dd50: number;
    dd95: number;
    mcl5: number;
    mcl50: number;
    mcl95: number;
  };
  drawdowns: {
    median: number[];
    best: number[];
    worst: number[];
  };
  maxConsecutiveLosses: {
    median: number;
    best: number;
    worst: number;
  };
  monthlyTables: {
    median: MonthlyStatsRow[];
    best: MonthlyStatsRow[];
    worst: MonthlyStatsRow[];
  };
  histograms: {
    drawdown: Histogram;
    finalEquity: Histogram;
  };
};

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
    name: "Normal loss",
    p: 0.1,
    type: "uniform",
    lo: -0.9,
    hi: -0.5,
  },
  {
    id: "scratch",
    name: "Scratch",
    p: 0.1,
    type: "uniform",
    lo: -0.5,
    hi: 0,
  },
  {
    id: "small_win",
    name: "Small win",
    p: 0.28,
    type: "uniform",
    lo: 0.1,
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

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRng(seed?: number) {
  if (!Number.isFinite(seed)) {
    return Math.random;
  }
  return mulberry32(Math.trunc(seed as number));
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) {
    return sorted[lo];
  }
  const t = index - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * t;
}

function maxDrawdown(series: Float64Array) {
  if (series.length === 0) return 0;
  let peak = series[0];
  let minDd = 0;
  for (let i = 0; i < series.length; i += 1) {
    const v = series[i];
    if (v > peak) {
      peak = v;
    }
    const dd = v / peak - 1;
    if (dd < minDd) {
      minDd = dd;
    }
  }
  return minDd;
}

function drawdownSeries(series: Float64Array) {
  const out = new Array(series.length).fill(0);
  if (series.length === 0) return out;
  let peak = series[0];
  for (let i = 0; i < series.length; i += 1) {
    const v = series[i];
    if (v > peak) {
      peak = v;
    }
    out[i] = v / peak - 1;
  }
  return out;
}

function maxConsecutiveLosses(rPath: Float64Array) {
  let maxRun = 0;
  let run = 0;
  for (let i = 0; i < rPath.length; i += 1) {
    if (rPath[i] < 0) {
      run += 1;
      if (run > maxRun) {
        maxRun = run;
      }
    } else {
      run = 0;
    }
  }
  return maxRun;
}

function monthlyStatsFromPath(
  equityPath: Float64Array,
  rPath: Float64Array,
  startEquity: number,
  tradesPerMonth: number,
  startYear: number,
  startMonth: number
) {
  const nTrades = equityPath.length;
  const safeTradesPerMonth = Math.max(1, tradesPerMonth);
  const nMonths = Math.ceil(nTrades / safeTradesPerMonth);
  const rows: MonthlyStatsRow[] = [];
  let prevEquity = startEquity;
  let year = startYear;
  let month = startMonth;

  for (let m = 0; m < nMonths; m += 1) {
    const startIdx = m * safeTradesPerMonth;
    const endIdx = Math.min((m + 1) * safeTradesPerMonth, nTrades) - 1;
    if (endIdx < startIdx) break;

    const endEquity = equityPath[endIdx];
    const returnValue = endEquity / prevEquity - 1;

    let peak = prevEquity;
    let minDd = 0;
    for (let i = startIdx; i <= endIdx; i += 1) {
      const value = equityPath[i];
      if (value > peak) peak = value;
      const dd = value / peak - 1;
      if (dd < minDd) minDd = dd;
    }

    let wins = 0;
    let losses = 0;
    let maxLossStreak = 0;
    let lossStreak = 0;
    for (let i = startIdx; i <= endIdx; i += 1) {
      const r = rPath[i];
      if (r > 0) {
        wins += 1;
        lossStreak = 0;
      } else if (r < 0) {
        losses += 1;
        lossStreak += 1;
        if (lossStreak > maxLossStreak) maxLossStreak = lossStreak;
      } else {
        lossStreak = 0;
      }
    }
    const trades = wins + losses;
    const winRate = trades === 0 ? 0 : wins / trades;

    rows.push({
      year,
      month,
      returnValue,
      maxDrawdown: minDd,
      winRate,
      maxConsecutiveLosses: maxLossStreak,
      endEquity,
    });

    prevEquity = endEquity;
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }

  return rows;
}

function histogram(values: number[], binCount: number) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const bins = new Array(binCount).fill(0).map((_, i) => min + (i * span) / binCount);
  const counts = new Array(binCount).fill(0);
  for (const v of values) {
    const idx = Math.min(
      binCount - 1,
      Math.max(0, Math.floor(((v - min) / span) * binCount))
    );
    counts[idx] += 1;
  }
  return { bins, counts, min, max } satisfies Histogram;
}

function runSimulation({
  startEquity,
  nTrades,
  nPaths,
  riskFraction,
  seed,
  tradesPerMonth,
  startYear,
  startMonth,
  buckets,
  progressive,
}: {
  startEquity: number;
  nTrades: number;
  nPaths: number;
  riskFraction: number;
  seed: number | null;
  tradesPerMonth: number;
  startYear: number;
  startMonth: number;
  buckets: Bucket[];
  progressive: {
    lossStreakThreshold: number;
    winStreakThreshold: number;
    minRisk: number;
    maxRisk: number;
  } | null;
}): SimulationResult {
  const safeTrades = Math.max(1, Math.trunc(nTrades));
  const safePaths = Math.max(1, Math.trunc(nPaths));
  const probs = buckets.map((b) => Math.max(0, b.p));
  const probSum = probs.reduce((acc, p) => acc + p, 0) || 1;
  const normProbs = probs.map((p) => p / probSum);
  const cumProbs = normProbs.reduce((acc: number[], p) => {
    const prev = acc.length ? acc[acc.length - 1] : 0;
    acc.push(prev + p);
    return acc;
  }, []);
  const rng = createRng(seed ?? undefined);

  const equityPaths: Float64Array[] = new Array(safePaths);
  const rPaths: Float64Array[] = new Array(safePaths);
  const finalEquity: number[] = new Array(safePaths).fill(0);
  const maxDrawdowns: number[] = new Array(safePaths).fill(0);
  const maxConsecutiveLossesAll: number[] = new Array(safePaths).fill(0);
  let equityMin = Number.POSITIVE_INFINITY;
  let equityMax = Number.NEGATIVE_INFINITY;

  for (let path = 0; path < safePaths; path += 1) {
    const equityPath = new Float64Array(safeTrades);
    const rPath = new Float64Array(safeTrades);
    let equity = startEquity;
    let currentRisk = riskFraction;
    let lossStreak = 0;
    let winStreak = 0;
    let peak = equity;
    let minDd = 0;

    for (let t = 0; t < safeTrades; t += 1) {
      const r = rng();
      const idx = cumProbs.findIndex((p) => r <= p);
      const bucket = buckets[idx === -1 ? buckets.length - 1 : idx];
      let sample = 0;
      if (bucket.type === "point") {
        sample = bucket.v ?? 0;
      } else {
        const lo = bucket.lo ?? 0;
        const hi = bucket.hi ?? 0;
        sample = lo + (hi - lo) * rng();
      }
      rPath[t] = sample;
      equity *= 1 + currentRisk * sample;
      equityPath[t] = equity;
      if (equity > peak) {
        peak = equity;
      }
      const dd = equity / peak - 1;
      if (dd < minDd) {
        minDd = dd;
      }

      if (progressive) {
        if (sample > 0) {
          winStreak += 1;
          lossStreak = 0;
          if (winStreak >= Math.max(1, Math.trunc(progressive.winStreakThreshold))) {
            currentRisk = Math.min(progressive.maxRisk, currentRisk * 2);
            winStreak = 0;
          }
        } else if (sample < 0) {
          lossStreak += 1;
          winStreak = 0;
          if (lossStreak >= Math.max(1, Math.trunc(progressive.lossStreakThreshold))) {
            currentRisk = Math.max(progressive.minRisk, currentRisk / 2);
            lossStreak = 0;
          }
        } else {
          winStreak = 0;
          lossStreak = 0;
        }
      }
    }

    for (let i = 0; i < equityPath.length; i += 1) {
      const value = equityPath[i];
      if (value < equityMin) equityMin = value;
      if (value > equityMax) equityMax = value;
    }
    equityPaths[path] = equityPath;
    rPaths[path] = rPath;
    finalEquity[path] = equityPath[safeTrades - 1] ?? equity;
    maxDrawdowns[path] = minDd;
    maxConsecutiveLossesAll[path] = maxConsecutiveLosses(rPath);
  }

  const final5 = percentile(finalEquity, 5);
  const final50 = percentile(finalEquity, 50);
  const final95 = percentile(finalEquity, 95);
  const dd5 = percentile(maxDrawdowns, 5);
  const dd50 = percentile(maxDrawdowns, 50);
  const dd95 = percentile(maxDrawdowns, 95);
  const mcl5 = percentile(maxConsecutiveLossesAll, 5);
  const mcl50 = percentile(maxConsecutiveLossesAll, 50);
  const mcl95 = percentile(maxConsecutiveLossesAll, 95);

  const medianValue = final50;
  let medianIdx = 0;
  let bestIdx = 0;
  let worstIdx = 0;
  let bestValue = Number.NEGATIVE_INFINITY;
  let worstValue = Number.POSITIVE_INFINITY;
  let closest = Number.POSITIVE_INFINITY;

  for (let i = 0; i < finalEquity.length; i += 1) {
    const value = finalEquity[i];
    if (value > bestValue) {
      bestValue = value;
      bestIdx = i;
    }
    if (value < worstValue) {
      worstValue = value;
      worstIdx = i;
    }
    const distance = Math.abs(value - medianValue);
    if (distance < closest) {
      closest = distance;
      medianIdx = i;
    }
  }

  const drawdowns = {
    median: drawdownSeries(equityPaths[medianIdx]),
    best: drawdownSeries(equityPaths[bestIdx]),
    worst: drawdownSeries(equityPaths[worstIdx]),
  };

  const maxConsecutiveLossesByPath = {
    median: maxConsecutiveLossesAll[medianIdx],
    best: maxConsecutiveLossesAll[bestIdx],
    worst: maxConsecutiveLossesAll[worstIdx],
  };

  const monthlyTables = {
    median: monthlyStatsFromPath(
      equityPaths[medianIdx],
      rPaths[medianIdx],
      startEquity,
      tradesPerMonth,
      startYear,
      startMonth
    ),
    best: monthlyStatsFromPath(
      equityPaths[bestIdx],
      rPaths[bestIdx],
      startEquity,
      tradesPerMonth,
      startYear,
      startMonth
    ),
    worst: monthlyStatsFromPath(
      equityPaths[worstIdx],
      rPaths[worstIdx],
      startEquity,
      tradesPerMonth,
      startYear,
      startMonth
    ),
  };

  const histograms = {
    drawdown: histogram(maxDrawdowns, 60),
    finalEquity: histogram(finalEquity, 60),
  };

  return {
    equityPaths,
    rPaths,
    finalEquity,
    maxDrawdowns,
    medianIdx,
    bestIdx,
    worstIdx,
    equityMin,
    equityMax,
    stats: { final5, final50, final95, dd5, dd50, dd95, mcl5, mcl50, mcl95 },
    drawdowns,
    maxConsecutiveLosses: maxConsecutiveLossesByPath,
    monthlyTables,
    histograms,
  };
}

function parseNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function MonthlyTableView({ title, rows }: { title: string; rows: MonthlyStatsRow[] }) {
  const cellStyle = (value: number) => {
    if (value >= 0.1) return "bg-emerald-500/20 text-emerald-200";
    if (value >= 0.03) return "bg-emerald-500/10 text-emerald-100";
    if (value > 0) return "bg-emerald-500/5 text-emerald-100";
    if (value <= -0.1) return "bg-rose-500/20 text-rose-200";
    if (value <= -0.03) return "bg-rose-500/10 text-rose-100";
    return "bg-rose-500/5 text-rose-100";
  };

  return (
    <div className="panel rounded-2xl border border-black/5 p-4 shadow-lg shadow-black/5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-[color:var(--panel-ink)]">{title}</h3>
        <span className="mono text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
          Monthly Returns
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[520px] table-fixed text-sm">
          <thead className="text-center text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
            <tr>
              <th className="w-[80px] pb-2 pr-2">Month</th>
              <th className="w-[52px] pb-2 pr-2">Return</th>
              <th className="w-[52px] pb-2 pr-2">DD</th>
              <th className="w-[52px] pb-2 pr-2">WR</th>
              <th className="w-[52px] pb-2 pr-2">Max Losses</th>
              <th className="w-[96px] pb-2 pr-2">Equity</th>
            </tr>
          </thead>
          <tbody className="text-[color:var(--panel-ink)]">
            {rows.map((row) => {
              const label = `${monthNames[row.month - 1]} ${row.year}`;
              return (
                <tr key={`${row.year}-${row.month}`} className="border-t border-black/5">
                  <td className="w-[80px] py-2 pr-2 text-center font-semibold">{label}</td>
                  <td className="py-2 pr-1">
                    <span
                      className={`inline-flex w-[52px] justify-center rounded-lg px-1 py-0.5 text-[10px] font-semibold ${cellStyle(
                        row.returnValue
                      )}`}
                    >
                      {percentFormatter.format(row.returnValue)}
                    </span>
                  </td>
                  <td className="py-2 pr-1">
                    <span className="inline-flex w-[52px] justify-center rounded-lg border border-black/5 px-1 py-0.5 text-[10px] font-semibold">
                      {percentFormatter.format(row.maxDrawdown)}
                    </span>
                  </td>
                  <td className="py-2 pr-1">
                    <span className="inline-flex w-[52px] justify-center rounded-lg border border-black/5 px-1 py-0.5 text-[10px] font-semibold">
                      {percentFormatter.format(row.winRate)}
                    </span>
                  </td>
                  <td className="py-2 pr-1">
                    <span className="inline-flex w-[52px] justify-center rounded-lg border border-black/5 px-1 py-0.5 text-[10px] font-semibold">
                      {numberFormatter.format(row.maxConsecutiveLosses)}
                    </span>
                  </td>
                  <td className="w-[96px] py-2 pr-1 text-center">
                    <span className="inline-flex w-full justify-center rounded-lg border border-black/5 px-2 py-1 text-xs font-semibold">
                      {currencyFormatter.format(row.endEquity)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Home() {
  const [startEquity, setStartEquity] = useState(300000);
  const [startEquityInput, setStartEquityInput] = useState(
    new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(300000)
  );
  const [nTrades, setNTrades] = useState(600);
  const [nPaths, setNPaths] = useState(1000);
  const [riskFraction, setRiskFraction] = useState(0.003);
  const [seed, setSeed] = useState<string>("25");
  const [riskOfRuinThreshold, setRiskOfRuinThreshold] = useState(30);
  const [tradesPerMonth, setTradesPerMonth] = useState(50);
  const [startYear, setStartYear] = useState(2026);
  const [startMonth, setStartMonth] = useState(1);
  const [buckets, setBuckets] = useState<Bucket[]>(defaultBuckets);
  const [useProgressiveExposure, setUseProgressiveExposure] = useState(false);
  const [lossStreakThreshold, setLossStreakThreshold] = useState(3);
  const [winStreakThreshold, setWinStreakThreshold] = useState(3);
  const [minRiskPercent, setMinRiskPercent] = useState(0.1);
  const [maxRiskPercent, setMaxRiskPercent] = useState(1.0);
  const [selectedPathIndex, setSelectedPathIndex] = useState(1);
  const [results, setResults] = useState<SimulationResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem("mc_inputs_v1");
    if (!raw) return;
    try {
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
        buckets: Bucket[];
        useProgressiveExposure: boolean;
        lossStreakThreshold: number;
        winStreakThreshold: number;
        minRiskPercent: number;
        maxRiskPercent: number;
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
      if (Array.isArray(saved.buckets) && saved.buckets.length > 0) setBuckets(saved.buckets);
      if (typeof saved.useProgressiveExposure === "boolean")
        setUseProgressiveExposure(saved.useProgressiveExposure);
      if (typeof saved.lossStreakThreshold === "number")
        setLossStreakThreshold(saved.lossStreakThreshold);
      if (typeof saved.winStreakThreshold === "number")
        setWinStreakThreshold(saved.winStreakThreshold);
      if (typeof saved.minRiskPercent === "number") setMinRiskPercent(saved.minRiskPercent);
      if (typeof saved.maxRiskPercent === "number") setMaxRiskPercent(saved.maxRiskPercent);
      if (typeof saved.selectedPathIndex === "number") setSelectedPathIndex(saved.selectedPathIndex);
    } catch {
      // ignore invalid storage
    }
  }, []);

  useEffect(() => {
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
      buckets,
      useProgressiveExposure,
      lossStreakThreshold,
      winStreakThreshold,
      minRiskPercent,
      maxRiskPercent,
      selectedPathIndex,
    };
    localStorage.setItem("mc_inputs_v1", JSON.stringify(payload));
  }, [
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
    buckets,
    useProgressiveExposure,
    lossStreakThreshold,
    winStreakThreshold,
    minRiskPercent,
    maxRiskPercent,
    selectedPathIndex,
  ]);

  const probSum = useMemo(
    () => buckets.reduce((acc, bucket) => acc + Math.max(0, bucket.p), 0),
    [buckets]
  );

  const tradeLabels = useMemo(() => {
    const length = results?.equityPaths[0]?.length ?? Math.max(1, Math.trunc(nTrades));
    return Array.from({ length }, (_, i) => `${i + 1}`);
  }, [results, nTrades]);

  const percentileEquityData = useMemo(() => {
    if (!results) return null;
    const percentiles = [10, 20, 30, 40, 50, 60, 70, 80, 90];
    const tradeCount = results.equityPaths[0]?.length ?? 0;
    if (tradeCount === 0) return null;

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

    const datasets = percentiles.map((p, pIdx) => {
      const target = percentile(results.finalEquity, p);
      let closestIdx = 0;
      let closest = Number.POSITIVE_INFINITY;
      for (let i = 0; i < results.finalEquity.length; i += 1) {
        const dist = Math.abs(results.finalEquity[i] - target);
        if (dist < closest) {
          closest = dist;
          closestIdx = i;
        }
      }

      const path = results.equityPaths[closestIdx];
      const color = palette[pIdx % palette.length];

      return {
        label: `${p}th percentile path`,
        data: Array.from(path),
        borderColor: color,
        borderWidth: p === 50 ? 3.5 : 1,
        pointRadius: 0,
        tension: 0.2,
      };
    });

    return { labels: tradeLabels, datasets };
  }, [results, tradeLabels]);

  const percentilePathMetrics = useMemo(() => {
    if (!results) return null;
    const percentiles = [10, 20, 30, 40, 50, 60, 70, 80, 90];
    const tradesPerYear = Math.max(1, Math.trunc(tradesPerMonth)) * 12;
    return percentiles.map((p) => {
      const target = percentile(results.finalEquity, p);
      let closestIdx = 0;
      let closest = Number.POSITIVE_INFINITY;
      for (let i = 0; i < results.finalEquity.length; i += 1) {
        const dist = Math.abs(results.finalEquity[i] - target);
        if (dist < closest) {
          closest = dist;
          closestIdx = i;
        }
      }

      const equityPath = results.equityPaths[closestIdx];
      const totalReturn = equityPath[equityPath.length - 1] / startEquity - 1;
      const nTrades = equityPath.length;
      const annualizedReturn =
        nTrades === 0
          ? 0
          : Math.pow(1 + totalReturn, tradesPerYear / nTrades) - 1;

      const tradeReturns: number[] = new Array(nTrades);
      for (let i = 0; i < nTrades; i += 1) {
        const prev = i === 0 ? startEquity : equityPath[i - 1];
        tradeReturns[i] = prev === 0 ? 0 : equityPath[i] / prev - 1;
      }
      const meanReturn = tradeReturns.reduce((acc, v) => acc + v, 0) / Math.max(1, nTrades);
      const variance =
        tradeReturns.reduce((acc, v) => acc + (v - meanReturn) ** 2, 0) /
        Math.max(1, nTrades - 1);
      const stdDev = Math.sqrt(variance);
      const sharpe = stdDev === 0 ? 0 : (meanReturn / stdDev) * Math.sqrt(tradesPerYear);
      const dd = maxDrawdown(equityPath);
      const calmar = dd === 0 ? 0 : annualizedReturn / Math.abs(dd);

      return {
        percentile: p,
        totalReturn: annualizedReturn,
        sharpe,
        calmar,
        maxDrawdown: dd,
        stdDev: stdDev * Math.sqrt(tradesPerYear),
      };
    });
  }, [results, startEquity, tradesPerMonth]);

  const drawdownData = useMemo(() => {
    if (!results) return null;
    return {
      labels: tradeLabels,
      datasets: [
        {
          label: "Median",
          data: results.drawdowns.median,
          borderColor: "#2563eb",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.2,
        },
        {
          label: "Best",
          data: results.drawdowns.best,
          borderColor: "#16a34a",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.2,
        },
        {
          label: "Worst",
          data: results.drawdowns.worst,
          borderColor: "#dc2626",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.2,
        },
      ],
    };
  }, [results, tradeLabels]);

  const riskOfRuin = useMemo(() => {
    if (!results) return null;
    const threshold = Math.abs(riskOfRuinThreshold) / 100;
    const count = results.maxDrawdowns.filter((dd) => Math.abs(dd) >= threshold).length;
    return {
      threshold,
      probability: count / results.maxDrawdowns.length,
    };
  }, [results, riskOfRuinThreshold]);

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

  const tradeResultsData = useMemo(() => {
    if (!results) return null;
    const totalPaths = results.rPaths.length;
    const clampedIndex = Math.min(
      Math.max(1, Math.trunc(selectedPathIndex)),
      totalPaths
    );
    const rPath = results.rPaths[clampedIndex - 1];
    if (!rPath) return null;
    const colors = Array.from(rPath).map((y) => {
      if (y <= -0.5) return "rgba(239, 68, 68, 0.85)";
      if (y < 0) return "rgba(249, 115, 22, 0.75)";
      if (y >= 5) return "rgba(34, 197, 94, 0.85)";
      return "rgba(59, 130, 246, 0.6)";
    });
    return {
      datasets: [
        {
          label: `Path ${clampedIndex}`,
          data: Array.from(rPath).map((r, i) => ({ x: i + 1, y: r })),
          pointRadius: 2.5,
          pointHoverRadius: 4,
          borderColor: "rgba(37, 99, 235, 0.25)",
          backgroundColor: colors,
          showLine: false,
        },
      ],
    };
  }, [results, selectedPathIndex]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
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

  const scatterOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
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
        y: {
          grid: {
            color: "rgba(0,0,0,0.05)",
          },
          ticks: {
            color: "#9ca3af",
          },
          title: {
            display: true,
            text: "R multiple",
            color: "#9ca3af",
          },
        },
      },
    }),
    []
  );

  const handleRun = () => {
    setIsRunning(true);
    const seedNumber = seed.trim() === "" ? null : Number(seed);
    const simulation = runSimulation({
      startEquity,
      nTrades,
      nPaths,
      riskFraction,
      seed: Number.isFinite(seedNumber as number) ? (seedNumber as number) : null,
      tradesPerMonth,
      startYear,
      startMonth,
      buckets,
      progressive: useProgressiveExposure
        ? {
            lossStreakThreshold,
            winStreakThreshold,
            minRisk: minRiskPercent / 100,
            maxRisk: maxRiskPercent / 100,
          }
        : null,
    });
    setResults(simulation);
    setSelectedPathIndex(1);
    setIsRunning(false);
  };

  const handleStartEquityBlur = () => {
    const normalized = startEquityInput.replace(/,/g, "");
    const value = parseNumber(normalized);
    setStartEquity(value);
    setStartEquityInput(
      new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)
    );
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
                  <h3 className="text-base font-semibold text-[color:var(--muted)]">Buckets R multiples</h3>
                  <span className="mono text-xs text-[color:var(--muted)]">
                    Sum = {numberFormatter.format(probSum)}
                  </span>
                </div>
                <div className="grid gap-3">
                  {buckets.map((bucket, idx) => (
                    <div key={bucket.id} className="rounded-2xl border border-black/5 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <input
                          className="w-full rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm font-semibold"
                          value={bucket.name}
                          onChange={(e) => {
                            const next = [...buckets];
                            next[idx] = { ...bucket, name: e.target.value };
                            setBuckets(next);
                          }}
                        />
                        <select
                          className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-xs uppercase"
                          value={bucket.type}
                          onChange={(e) => {
                            const next = [...buckets];
                            next[idx] = { ...bucket, type: e.target.value as BucketType };
                            setBuckets(next);
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
                              const next = [...buckets];
                              next[idx] = { ...bucket, p: parseNumber(e.target.value) / 100 };
                              setBuckets(next);
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
                              Min R
                              <input
                                className="rounded-lg border border-black/10 bg-transparent px-2 py-1"
                                type="number"
                                step="0.1"
                                value={bucket.lo ?? 0}
                                onChange={(e) => {
                                  const next = [...buckets];
                                  next[idx] = { ...bucket, lo: parseNumber(e.target.value) };
                                  setBuckets(next);
                                }}
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              Max R
                              <input
                                className="rounded-lg border border-black/10 bg-transparent px-2 py-1"
                                type="number"
                                step="0.1"
                                value={bucket.hi ?? 0}
                                onChange={(e) => {
                                  const next = [...buckets];
                                  next[idx] = { ...bucket, hi: parseNumber(e.target.value) };
                                  setBuckets(next);
                                }}
                              />
                            </label>
                          </>
                        ) : (
                          <label className="flex flex-col gap-1">
                            R
                            <input
                              className="rounded-lg border border-black/10 bg-transparent px-2 py-1"
                              type="number"
                              step="0.1"
                              value={bucket.v ?? 0}
                              onChange={(e) => {
                                const next = [...buckets];
                                next[idx] = { ...bucket, v: parseNumber(e.target.value) };
                                setBuckets(next);
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
                    Adjust risk based on streaks. Loss streak halves risk, win streak doubles it.
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
                    Min risk
                    <div className="relative">
                      <input
                        className="w-full rounded-xl border border-black/10 bg-transparent py-2 pl-3 pr-8 text-base"
                        type="number"
                        step="0.01"
                        min={0}
                        value={minRiskPercent}
                        onChange={(e) => setMinRiskPercent(parseNumber(e.target.value))}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[color:var(--muted)]">
                        %
                      </span>
                    </div>
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Max risk
                    <div className="relative">
                      <input
                        className="w-full rounded-xl border border-black/10 bg-transparent py-2 pl-3 pr-8 text-base"
                        type="number"
                        step="0.01"
                        min={0}
                        value={maxRiskPercent}
                        onChange={(e) => setMaxRiskPercent(parseNumber(e.target.value))}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[color:var(--muted)]">
                        %
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
                        ? `${results.equityPaths.length.toLocaleString()} paths`
                        : "0 paths"}
                    </span>
                    <span className="rounded-full border border-black/10 px-2 py-1">
                      {results
                        ? `${(results.equityPaths[0]?.length ?? 0).toLocaleString()} trades`
                        : "0 trades"}
                    </span>
                  </div>
                </div>
              </div>

              {results ? (
                <div className="mt-6 grid gap-4 md:grid-cols-5">
                  <div className="rounded-2xl border border-black/5 p-4">
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
                          max={results.equityPaths.length}
                          value={selectedPathIndex}
                          onChange={(e) => setSelectedPathIndex(parseNumber(e.target.value))}
                        />
                      </label>
                    </div>
                    <div className="mt-3 h-[200px] w-full rounded-2xl border border-black/5">
                      {tradeResultsData ? <Scatter data={tradeResultsData} options={scatterOptions} /> : null}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-black/5 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
                      Payoff Buckets
                    </p>
                    <div className="mt-3 grid gap-2 text-xs">
                      {buckets.map((bucket) => (
                        <div key={bucket.id} className="flex items-center justify-between gap-2">
                          <span className="truncate text-[color:var(--muted)]">
                            {bucket.type === "point"
                              ? `${bucket.name} (${bucket.v}R)`
                              : `${bucket.name} (${bucket.lo}R to ${bucket.hi}R)`}
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
                    <div className="mt-3 grid gap-2 text-sm font-semibold">
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">5th percentile</span>
                        <span>{currencyFormatter.format(results.stats.final5)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">50th percentile</span>
                        <span>{currencyFormatter.format(results.stats.final50)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">95th percentile</span>
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
                      Max Drawdown 
                    </p>
                    <div className="mt-3 grid gap-2 text-sm font-semibold">
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">5th percentile</span>
                        <span>{percentFormatter.format(results.stats.dd5)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">50th percentile</span>
                        <span>{percentFormatter.format(results.stats.dd50)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">95th percentile</span>
                        <span>{percentFormatter.format(results.stats.dd95)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-black/5 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--muted)]">
                      Max Consecutive Losses
                    </p>
                    <div className="mt-3 grid gap-2 text-sm font-semibold">
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">5th percentile</span>
                        <span>{numberFormatter.format(results.stats.mcl5)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">50th percentile</span>
                        <span>{numberFormatter.format(results.stats.mcl50)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[color:var(--muted)]">95th percentile</span>
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
              {percentilePathMetrics ? (
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
                      {percentilePathMetrics.map((metric) => (
                        <tr key={metric.percentile}>
                          <td className="border border-white/20 px-2 py-2 text-center font-semibold">
                            {metric.percentile}th
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
              ) : (
                <p className="mt-3 text-xs text-[color:var(--muted)]">
                  Run the simulation to see metrics for each percentile path.
                </p>
              )}
            </div>
            </div>

            {results && (
              <div className="grid gap-6 lg:grid-cols-3">
                <MonthlyTableView title="Median Path" rows={results.monthlyTables.median} />
                <MonthlyTableView title="Best Path" rows={results.monthlyTables.best} />
                <MonthlyTableView title="Worst Path" rows={results.monthlyTables.worst} />
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
