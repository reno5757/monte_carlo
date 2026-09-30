export type BucketType = "uniform" | "point";

/**
 * "r": bucket values are R multiples, sized by the risk per trade.
 * "percent": bucket values are the trade's gain/loss as a % of total equity.
 */
export type OutcomeUnit = "r" | "percent";

export type Bucket = {
  id: string;
  name: string;
  p: number;
  type: BucketType;
  lo?: number;
  hi?: number;
  v?: number;
};

export type Histogram = {
  bins: number[];
  counts: number[];
  min: number;
  max: number;
};

export type MonthlyStatsRow = {
  year: number;
  month: number;
  returnValue: number;
  maxDrawdown: number;
  winRate: number;
  maxConsecutiveLosses: number;
  endEquity: number;
};

export type PathMetrics = {
  label: string;
  totalReturn: number;
  sharpe: number;
  calmar: number;
  maxDrawdown: number;
  stdDev: number;
};

/**
 * In "r" mode minRisk/maxRisk are fractions of equity risked per trade.
 * In "percent" mode they are size multiples applied to the bucket outcomes (1 = as entered).
 */
export type ProgressiveExposure = {
  lossStreakThreshold: number;
  winStreakThreshold: number;
  minRisk: number;
  maxRisk: number;
};

export type SimulationInput = {
  outcomeUnit: OutcomeUnit;
  startEquity: number;
  nTrades: number;
  nPaths: number;
  riskFraction: number;
  seed: number | null;
  tradesPerMonth: number;
  startYear: number;
  startMonth: number;
  buckets: Bucket[];
  progressive: ProgressiveExposure | null;
};

/** The input actually used for a run: counts sanitized and the seed always resolved. */
export type ResolvedInput = Omit<SimulationInput, "seed"> & { seed: number };

export type SimulationResult = {
  input: ResolvedInput;
  nPaths: number;
  nTrades: number;
  /** Max drawdown of every path, sorted ascending (worst first). */
  maxDrawdowns: Float64Array;
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
  /** Equity of the actual paths closest to the 10th..90th final-equity percentiles. */
  percentilePaths: { p: number; equity: Float64Array }[];
  worstPath: Float64Array;
  /** Worst path first, then one row per percentile path. */
  metrics: PathMetrics[];
  drawdowns: {
    median: Float64Array;
    best: Float64Array;
    worst: Float64Array;
  };
  monthlyTables: {
    median: MonthlyStatsRow[];
    p5: MonthlyStatsRow[];
    p95: MonthlyStatsRow[];
  };
  histograms: {
    drawdown: Histogram;
    finalEquity: Histogram;
  };
};

export const chartPercentiles = [10, 20, 30, 40, 50, 60, 70, 80, 90];

// sfc32 seeded from (baseSeed, pathIndex): every path gets its own independent
// stream, so any single path can be regenerated later without storing it.
function createPathRng(baseSeed: number, pathIndex: number) {
  let a = 0x9e3779b9;
  let b = baseSeed | 0;
  let c = pathIndex | 0;
  let d = 1;
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i += 1) next();
  return next;
}

export function resolveInput(input: SimulationInput): ResolvedInput {
  return {
    ...input,
    nTrades: Math.max(1, Math.trunc(input.nTrades)),
    nPaths: Math.max(1, Math.trunc(input.nPaths)),
    seed:
      input.seed !== null && Number.isFinite(input.seed)
        ? Math.trunc(input.seed) >>> 0
        : (Math.random() * 4294967296) >>> 0,
  };
}

export type SimContext = {
  startEquity: number;
  nTrades: number;
  riskFraction: number;
  seed: number;
  cumProbs: Float64Array;
  isPoint: Uint8Array;
  lo: Float64Array;
  span: Float64Array;
  progressive: {
    lossStreakThreshold: number;
    winStreakThreshold: number;
    minRisk: number;
    maxRisk: number;
  } | null;
};

export function createSimContext(input: ResolvedInput): SimContext {
  const { buckets } = input;
  const n = buckets.length;
  const probSum = buckets.reduce((acc, b) => acc + Math.max(0, b.p), 0) || 1;
  const cumProbs = new Float64Array(n);
  const isPoint = new Uint8Array(n);
  const lo = new Float64Array(n);
  const span = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    const b = buckets[i];
    acc += Math.max(0, b.p) / probSum;
    cumProbs[i] = acc;
    if (b.type === "point") {
      isPoint[i] = 1;
      lo[i] = b.v ?? 0;
    } else {
      lo[i] = b.lo ?? 0;
      span[i] = (b.hi ?? 0) - lo[i];
    }
  }
  // Percent outcomes are the R-mode formula with a fixed 1% "risk":
  // equity *= 1 + 0.01 * sample, scaled by the progressive size multiple.
  const unitScale = input.outcomeUnit === "percent" ? 0.01 : 1;
  const { progressive } = input;
  return {
    startEquity: input.startEquity,
    nTrades: input.nTrades,
    riskFraction: input.outcomeUnit === "percent" ? unitScale : input.riskFraction,
    seed: input.seed,
    cumProbs,
    isPoint,
    lo,
    span,
    progressive: progressive
      ? {
          lossStreakThreshold: Math.max(1, Math.trunc(progressive.lossStreakThreshold)),
          winStreakThreshold: Math.max(1, Math.trunc(progressive.winStreakThreshold)),
          minRisk: progressive.minRisk * unitScale,
          maxRisk: progressive.maxRisk * unitScale,
        }
      : null,
  };
}

type PathSummary = { finalEquity: number; maxDrawdown: number; maxConsecutiveLosses: number };

/**
 * Simulates one path. Pass output arrays (length nTrades) to record the
 * equity and R-multiple of every trade; omit them to only get the summary.
 */
export function simulatePath(
  ctx: SimContext,
  pathIndex: number,
  equityOut?: Float64Array,
  rOut?: Float64Array
): PathSummary {
  const { cumProbs, isPoint, lo, span, progressive, nTrades } = ctx;
  const lastBucket = cumProbs.length - 1;
  const rng = createPathRng(ctx.seed, pathIndex);
  let equity = ctx.startEquity;
  let currentRisk = ctx.riskFraction;
  let peak = equity;
  let minDd = 0;
  let lossRun = 0;
  let maxLossRun = 0;
  let winStreak = 0;
  let lossStreak = 0;

  for (let t = 0; t < nTrades; t += 1) {
    const r = rng();
    let idx = 0;
    while (idx < lastBucket && r > cumProbs[idx]) idx += 1;
    const sample = isPoint[idx] === 1 ? lo[idx] : lo[idx] + span[idx] * rng();

    equity *= 1 + currentRisk * sample;
    if (equityOut) equityOut[t] = equity;
    if (rOut) rOut[t] = sample;

    if (equity > peak) peak = equity;
    const dd = equity / peak - 1;
    if (dd < minDd) minDd = dd;

    if (sample < 0) {
      lossRun += 1;
      if (lossRun > maxLossRun) maxLossRun = lossRun;
    } else {
      lossRun = 0;
    }

    if (progressive) {
      if (sample > 0) {
        winStreak += 1;
        lossStreak = 0;
        if (winStreak >= progressive.winStreakThreshold) {
          currentRisk = Math.min(progressive.maxRisk, currentRisk * 2);
          winStreak = 0;
        }
      } else if (sample < 0) {
        lossStreak += 1;
        winStreak = 0;
        if (lossStreak >= progressive.lossStreakThreshold) {
          currentRisk = Math.max(progressive.minRisk, currentRisk / 2);
          lossStreak = 0;
        }
      } else {
        winStreak = 0;
        lossStreak = 0;
      }
    }
  }

  return { finalEquity: equity, maxDrawdown: minDd, maxConsecutiveLosses: maxLossRun };
}

function percentileSorted(sorted: ArrayLike<number>, p: number) {
  if (sorted.length === 0) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

/** Rank (into the sorted array) of the value closest to the p-th percentile. */
function closestRank(sorted: ArrayLike<number>, p: number) {
  const index = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  const target = percentileSorted(sorted, p);
  return Math.abs(sorted[hi] - target) < Math.abs(sorted[lo] - target) ? hi : lo;
}

function drawdownSeries(series: Float64Array, startEquity: number) {
  const out = new Float64Array(series.length);
  let peak = startEquity;
  for (let i = 0; i < series.length; i += 1) {
    const v = series[i];
    if (v > peak) peak = v;
    out[i] = v / peak - 1;
  }
  return out;
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
    let wins = 0;
    let losses = 0;
    let maxLossStreak = 0;
    let lossStreak = 0;
    for (let i = startIdx; i <= endIdx; i += 1) {
      const value = equityPath[i];
      if (value > peak) peak = value;
      const dd = value / peak - 1;
      if (dd < minDd) minDd = dd;

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

    rows.push({
      year,
      month,
      returnValue,
      maxDrawdown: minDd,
      winRate: trades === 0 ? 0 : wins / trades,
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

function histogram(sorted: Float64Array, binCount: number): Histogram {
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const span = max - min || 1;
  const bins = Array.from({ length: binCount }, (_, i) => min + (i * span) / binCount);
  const counts = new Array<number>(binCount).fill(0);
  for (let i = 0; i < sorted.length; i += 1) {
    const idx = Math.min(
      binCount - 1,
      Math.max(0, Math.floor(((sorted[i] - min) / span) * binCount))
    );
    counts[idx] += 1;
  }
  return { bins, counts, min, max };
}

function pathMetrics(
  label: string,
  equityPath: Float64Array,
  maxDrawdown: number,
  startEquity: number,
  tradesPerYear: number
): PathMetrics {
  const n = equityPath.length;
  const totalReturn = equityPath[n - 1] / startEquity - 1;
  const annualizedReturn = n === 0 ? 0 : Math.pow(1 + totalReturn, tradesPerYear / n) - 1;

  // Welford's single-pass mean/variance of per-trade returns.
  let mean = 0;
  let m2 = 0;
  let prev = startEquity;
  for (let i = 0; i < n; i += 1) {
    const value = equityPath[i];
    const ret = prev === 0 ? 0 : value / prev - 1;
    prev = value;
    const delta = ret - mean;
    mean += delta / (i + 1);
    m2 += delta * (ret - mean);
  }
  const stdDev = Math.sqrt(m2 / Math.max(1, n - 1));
  const annualFactor = Math.sqrt(tradesPerYear);

  return {
    label,
    totalReturn: annualizedReturn,
    sharpe: stdDev === 0 ? 0 : (mean / stdDev) * annualFactor,
    calmar: maxDrawdown === 0 ? 0 : annualizedReturn / Math.abs(maxDrawdown),
    maxDrawdown,
    stdDev: stdDev * annualFactor,
  };
}

function sortedCopy(values: Float64Array) {
  return Float64Array.from(values).sort();
}

export function runSimulation(rawInput: SimulationInput): SimulationResult {
  const input = resolveInput(rawInput);
  const { nPaths, nTrades, startEquity, tradesPerMonth, startYear, startMonth } = input;
  const ctx = createSimContext(input);

  // Pass 1: summaries only, no per-trade storage.
  const finalEquity = new Float64Array(nPaths);
  const maxDrawdowns = new Float64Array(nPaths);
  const maxLosses = new Float64Array(nPaths);
  for (let path = 0; path < nPaths; path += 1) {
    const summary = simulatePath(ctx, path);
    finalEquity[path] = summary.finalEquity;
    maxDrawdowns[path] = summary.maxDrawdown;
    maxLosses[path] = summary.maxConsecutiveLosses;
  }

  // Sort once; every percentile and percentile-path lookup reads from these.
  const order = new Uint32Array(nPaths);
  for (let i = 0; i < nPaths; i += 1) order[i] = i;
  order.sort((a, b) => finalEquity[a] - finalEquity[b]);
  const sortedFinal = new Float64Array(nPaths);
  for (let i = 0; i < nPaths; i += 1) sortedFinal[i] = finalEquity[order[i]];
  const sortedDd = sortedCopy(maxDrawdowns);
  const sortedMcl = sortedCopy(maxLosses);

  const pathAt = (p: number) => order[closestRank(sortedFinal, p)];
  const worstIdx = order[0];
  const bestIdx = order[nPaths - 1];
  const medianIdx = pathAt(50);
  const p5Idx = pathAt(5);
  const p95Idx = pathAt(95);
  const percentileIdx = chartPercentiles.map(pathAt);

  // Pass 2: regenerate only the handful of paths that are displayed.
  const stored = new Map<number, { equity: Float64Array; r: Float64Array }>();
  const getPath = (idx: number) => {
    let path = stored.get(idx);
    if (!path) {
      path = { equity: new Float64Array(nTrades), r: new Float64Array(nTrades) };
      simulatePath(ctx, idx, path.equity, path.r);
      stored.set(idx, path);
    }
    return path;
  };

  const tradesPerYear = Math.max(1, Math.trunc(tradesPerMonth)) * 12;
  const percentilePaths = chartPercentiles.map((p, i) => ({
    p,
    equity: getPath(percentileIdx[i]).equity,
  }));
  const worstPath = getPath(worstIdx).equity;
  const metrics = [
    pathMetrics("Worst", worstPath, maxDrawdowns[worstIdx], startEquity, tradesPerYear),
    ...percentilePaths.map(({ p, equity }, i) =>
      pathMetrics(`${p}th`, equity, maxDrawdowns[percentileIdx[i]], startEquity, tradesPerYear)
    ),
  ];

  const monthly = (idx: number) => {
    const path = getPath(idx);
    return monthlyStatsFromPath(
      path.equity,
      path.r,
      startEquity,
      tradesPerMonth,
      startYear,
      startMonth
    );
  };

  return {
    input,
    nPaths,
    nTrades,
    maxDrawdowns: sortedDd,
    stats: {
      final5: percentileSorted(sortedFinal, 5),
      final50: percentileSorted(sortedFinal, 50),
      final95: percentileSorted(sortedFinal, 95),
      dd5: percentileSorted(sortedDd, 5),
      dd50: percentileSorted(sortedDd, 50),
      dd95: percentileSorted(sortedDd, 95),
      mcl5: percentileSorted(sortedMcl, 5),
      mcl50: percentileSorted(sortedMcl, 50),
      mcl95: percentileSorted(sortedMcl, 95),
    },
    percentilePaths,
    worstPath,
    metrics,
    drawdowns: {
      median: drawdownSeries(getPath(medianIdx).equity, startEquity),
      best: drawdownSeries(getPath(bestIdx).equity, startEquity),
      worst: drawdownSeries(worstPath, startEquity),
    },
    monthlyTables: {
      median: monthly(medianIdx),
      p5: monthly(p5Idx),
      p95: monthly(p95Idx),
    },
    histograms: {
      drawdown: histogram(sortedDd, 60),
      finalEquity: histogram(sortedFinal, 60),
    },
  };
}
