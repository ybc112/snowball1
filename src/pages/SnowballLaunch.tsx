import { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import {
  Flame,
  Snowflake,
  Wallet,
  Rocket,
  Droplets,
  FireExtinguisher,
  ShieldCheck,
  Copy,
  Check,
  Loader2,
  AlertCircle,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWallet } from "@/hooks/useWallet";
import { useAppStore } from "@/store";
import {
  type SnowballParams,
  type FeeBreakdown,
  previewFees,
  buildContractParams,
  FACTORY_ADDRESS,
  FACTORY_ABI,
  getFactoryInfo,
  mineSalt,
  serverMineSalt,
  createToken,
  createTokenAndAddLiquidity,
  getReadProvider,
  ADDRESSES,
} from "@/lib/contracts/snowballFactory";

const BPS = 10000;
const DEPLOY_MODES = [
  {
    key: "deploy",
    title: "普通部署",
    desc: "仅创建代币，项目方自行加池和开盘",
  },
  {
    key: "launch",
    title: "一键发射",
    desc: "创建 + 自动加池 + LP 锁黑洞 + 开盘",
  },
] as const;

const DEFAULT_PARAMS: SnowballParams = {
  name: "",
  symbol: "",
  totalSupply: "1000000000",
  currency: ADDRESSES.wbnb,
  rewardToken: ADDRESSES.usdt,
  receiver: "",
  fundAddress: "",
  totalBuyTax: 500,
  totalSellTax: 500,
  rewardShare: 4000,
  liquidityShare: 3000,
  burnShare: 2000,
  fundShare: 1000,
  maxBuyAmount: "0",
  maxSellAmount: "0",
  maxWalletAmount: "0",
  lpBurnFrequency: 3600,
  percentForLPBurn: 50,
  secondTime: 0,
  killBlocks: 0,
  airdropNumbs: 0,
  transferFee: 0,
  mushHoldNum: "0",
  enableOffTrade: false,
};

function formatBps(bps: number) {
  return `${(bps / 100).toFixed(2)}%`;
}

function shorten(addr: string) {
  if (!addr) return "--";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return { copied, copy };
}

function Card({ children, className, title, icon: Icon, number }: any) {
  return (
    <div className={cn("rounded-2xl border border-[var(--sb-border)] bg-[var(--sb-card)] p-6 shadow-sm", className)}>
      {title && (
        <div className="mb-5 flex items-center gap-2 text-lg font-semibold text-[var(--sb-text)]">
          {Icon && <Icon className="h-5 w-5 text-[var(--sb-gold)]" />}
          {number && (
            <span className="flex h-6 min-w-6 items-center justify-center rounded-md bg-[var(--sb-gold-light)] px-1 text-xs font-bold text-[var(--sb-gold)]">
              {number}
            </span>
          )}
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

// 税费分配环形图（参照 KimiMint AllocationRing 的 SVG 扇形实现）
const RING_COLORS = {
  platform: "#C84B31", // 平台（红）
  reward: "#D4A574", // 分红（金）
  liquidity: "#5B8DB8", // 回流（蓝）
  burn: "#E08E45", // 燃烧（橙）
  fund: "#8E6BB3", // 基金（紫）
};

const RING_LEGEND = [
  { key: "platform", feeKey: "platformFee", label: "平台", color: RING_COLORS.platform },
  { key: "reward", feeKey: "rewardFee", label: "分红", color: RING_COLORS.reward },
  { key: "liquidity", feeKey: "liquidityFee", label: "回流", color: RING_COLORS.liquidity },
  { key: "burn", feeKey: "burnFee", label: "燃烧", color: RING_COLORS.burn },
  { key: "fund", feeKey: "fundFee", label: "基金", color: RING_COLORS.fund },
] as const;

function feeSharePct(fee: FeeBreakdown | null | undefined, key: keyof FeeBreakdown) {
  if (!fee) return "--";
  const total = fee.platformFee + fee.rewardFee + fee.liquidityFee + fee.burnFee + fee.fundFee;
  if (total === 0) return "0.0";
  return ((fee[key] / total) * 100).toFixed(1);
}

function TaxRing({
  fee,
  label,
  totalTaxBps,
  loading,
}: {
  fee: FeeBreakdown | null;
  label: string;
  totalTaxBps: number;
  loading?: boolean;
}) {
  // 各段按占税费总额的比例画扇形（环满圈 = 总税费 100%）
  const taxPct = totalTaxBps / 100; // bps -> 百分比
  const total =
    fee ? fee.platformFee + fee.rewardFee + fee.liquidityFee + fee.burnFee + fee.fundFee : 0;
  const items = fee && total > 0
    ? [
        { key: "platform", value: (fee.platformFee / total) * 100, color: RING_COLORS.platform },
        { key: "reward", value: (fee.rewardFee / total) * 100, color: RING_COLORS.reward },
        { key: "liquidity", value: (fee.liquidityFee / total) * 100, color: RING_COLORS.liquidity },
        { key: "burn", value: (fee.burnFee / total) * 100, color: RING_COLORS.burn },
        { key: "fund", value: (fee.fundFee / total) * 100, color: RING_COLORS.fund },
      ].filter((i) => i.value > 0)
    : [];

  let cumulative = 0;
  const segments = items.map((item) => {
    const start = cumulative;
    cumulative += item.value;
    const end = cumulative;
    const largeArc = item.value > 50 ? 1 : 0;
    const startAngle = (start / 100) * Math.PI * 2 - Math.PI / 2;
    const endAngle = (end / 100) * Math.PI * 2 - Math.PI / 2;
    const x1 = 50 + 42 * Math.cos(startAngle);
    const y1 = 50 + 42 * Math.sin(startAngle);
    const x2 = 50 + 42 * Math.cos(endAngle);
    const y2 = 50 + 42 * Math.sin(endAngle);
    return {
      ...item,
      d: `M 50 50 L ${x1} ${y1} A 42 42 0 ${largeArc} 1 ${x2} ${y2} Z`,
    };
  });

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-32 w-32">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          {loading || segments.length === 0 ? (
            <circle cx="50" cy="50" r="42" fill="none" stroke="var(--sb-border)" strokeWidth="16" />
          ) : (
            <>
              {segments.map((segment) => (
                <path key={segment.key} d={segment.d} fill={segment.color} stroke="var(--sb-card)" strokeWidth="2" />
              ))}
            </>
          )}
          <circle cx="50" cy="50" r="26" fill="var(--sb-card)" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-[var(--sb-text)]">
            {loading ? "--" : `${taxPct.toFixed(2)}%`}
          </span>
          <span className="text-[10px] text-[var(--sb-muted)]">{label}</span>
        </div>
      </div>
    </div>
  );
}

function InputGroup({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  suffix,
  hint,
  error,
  disabled,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  suffix?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-[var(--sb-text)]">{label}</label>
      <div className="relative">
        <input
          type={type}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "w-full rounded-xl border bg-white/80 px-4 py-2.5 text-sm outline-none transition",
            "placeholder:text-[var(--sb-muted)]/60",
            error
              ? "border-[var(--sb-red)] focus:border-[var(--sb-red)] focus:ring-2 focus:ring-[var(--sb-red)]/10"
              : "border-[var(--sb-border)] focus:border-[var(--sb-gold)] focus:ring-2 focus:ring-[var(--sb-gold)]/10"
          )}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-[var(--sb-muted)]">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="text-xs text-[var(--sb-muted)]">{hint}</p>}
      {error && <p className="text-xs text-[var(--sb-red)]">{error}</p>}
    </div>
  );
}

function SliderGroup({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-[var(--sb-text)]">{label}</label>
        <span className="rounded-lg bg-[var(--sb-gold-light)] px-2 py-0.5 text-xs font-semibold text-[var(--sb-gold)]">
          {formatBps(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[var(--sb-border)] accent-[var(--sb-gold)] disabled:opacity-50"
      />
      {hint && <p className="text-xs text-[var(--sb-muted)]">{hint}</p>}
    </div>
  );
}

export default function SnowballLaunch() {
  const { account, isConnected, connect, connecting, signer } = useWallet();
  const showToast = useAppStore((s) => s.showToast);
  const { copied, copy } = useCopy();

  const [deployMode, setDeployMode] = useState<"deploy" | "launch">("deploy");
  const [params, setParams] = useState<SnowballParams>(DEFAULT_PARAMS);
  const [factoryInfo, setFactoryInfo] = useState<{
    createFee: string;
    rewardToken: string;
    feeRecipient: string;
    owner: string;
    requiredSuffix: string;
    router: string;
  } | null>(null);

  const [fees, setFees] = useState<{ buy: FeeBreakdown; sell: FeeBreakdown } | null>(null);
  const [feesLoading, setFeesLoading] = useState(false);

  const [mining, setMining] = useState(false);
  const [mineResult, setMineResult] = useState<{ salt: string; address: string; attempts: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ tokenAddress: string; txHash: string } | null>(null);

  // 一键加池参数
  const [liquidityBnb, setLiquidityBnb] = useState("0.1");
  const [liquidityTokenPercent, setLiquidityTokenPercent] = useState(80);

  const [factoryStatus, setFactoryStatus] = useState<"loading" | "ok" | "failed">("loading");
  useEffect(() => {
    getFactoryInfo()
      .then((info) => {
        setFactoryInfo(info);
        setFactoryStatus("ok");
      })
      .catch(() => {
        setFactoryInfo(null);
        setFactoryStatus("failed");
      });
  }, []);

  // receiver 默认用当前钱包
  useEffect(() => {
    if (account && !params.receiver) {
      setParams((p) => ({ ...p, receiver: account, fundAddress: account }));
    }
  }, [account]);

  // 异步预览费率
  useEffect(() => {
    let cancelled = false;
    setFeesLoading(true);
    previewFees(params)
      .then((f) => {
        if (!cancelled) setFees(f);
      })
      .catch(() => {
        if (!cancelled) setFees(null);
      })
      .finally(() => setFeesLoading(false));
    return () => {
      cancelled = true;
    };
  }, [
    params.totalBuyTax,
    params.totalSellTax,
    params.rewardShare,
    params.liquidityShare,
    params.burnShare,
    params.fundShare,
  ]);

  // 参数变化时清空旧的挖盐结果
  const paramsKey = useMemo(
    () =>
      JSON.stringify({
        ...params,
        deployMode,
        liquidityBnb,
        liquidityTokenPercent,
      }),
    [params, deployMode, liquidityBnb, liquidityTokenPercent]
  );
  useEffect(() => {
    setMineResult(null);
  }, [paramsKey]);

  const shareError = useMemo(() => {
    const total = params.rewardShare + params.liquidityShare + params.burnShare + params.fundShare;
    return total !== BPS ? `四项占比之和必须为 100%，当前 ${(total / 100).toFixed(2)}%` : "";
  }, [params.rewardShare, params.liquidityShare, params.burnShare, params.fundShare]);

  const taxError = useMemo(() => {
    if (params.totalBuyTax === 0 || params.totalBuyTax > 2500) return "买税需在 0.01% ~ 25% 之间";
    if (params.totalSellTax === 0 || params.totalSellTax > 2500) return "卖税需在 0.01% ~ 25% 之间";
    return "";
  }, [params.totalBuyTax, params.totalSellTax]);

  const launchParamError = useMemo(() => {
    if (deployMode !== "launch") return "";
    const bnb = Number(liquidityBnb);
    if (!bnb || bnb <= 0) return "加池 BNB 必须大于 0";
    if (liquidityTokenPercent <= 0 || liquidityTokenPercent > 100) return "加池代币比例需在 1% ~ 100% 之间";
    return "";
  }, [deployMode, liquidityBnb, liquidityTokenPercent]);

  const canCreate = useMemo(() => {
    if (!isConnected) return false;
    if (!params.name || !params.symbol || !params.totalSupply || !params.receiver) return false;
    if (shareError || taxError || launchParamError) return false;
    return true;
  }, [isConnected, params, shareError, taxError, launchParamError]);

  const totalSupplyBigint = useMemo(() => {
    try {
      return ethers.parseUnits(params.totalSupply || "0", 18);
    } catch {
      return 0n;
    }
  }, [params.totalSupply]);

  const liquidityTokens = useMemo(() => {
    if (deployMode !== "launch" || !totalSupplyBigint) return 0n;
    return (totalSupplyBigint * BigInt(liquidityTokenPercent)) / 100n;
  }, [deployMode, totalSupplyBigint, liquidityTokenPercent]);

  const remainingTokens = useMemo(() => {
    if (deployMode !== "launch") return 0n;
    return totalSupplyBigint - liquidityTokens;
  }, [deployMode, totalSupplyBigint, liquidityTokens]);

  const initialPrice = useMemo(() => {
    if (deployMode !== "launch" || !liquidityTokens || !Number(liquidityBnb)) return null;
    const bnb = ethers.parseEther(liquidityBnb);
    return Number(bnb) / Number(liquidityTokens);
  }, [deployMode, liquidityTokens, liquidityBnb]);

  const handleMine = async () => {
    if (!factoryInfo || !canCreate) return;
    setMining(true);
    setMineResult(null);
    abortRef.current = new AbortController();
    try {
      const built = await buildContractParams(params, deployMode === "launch");
      const suffix = factoryInfo.requiredSuffix && factoryInfo.requiredSuffix !== "0" ? factoryInfo.requiredSuffix : "7777";
      // 优先服务端挖盐（算力快），失败回退本地
      showToast("尝试服务端挖盐…", "info");
      const serverRes = await serverMineSalt(built, suffix);
      if (serverRes) {
        setMineResult(serverRes);
        showToast(`服务端靓号挖到：${shorten(serverRes.address)}（${serverRes.attempts.toLocaleString()} 次）`, "success");
      } else {
        const provider = getReadProvider();
        const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
        showToast("服务端不可用，改用本地挖盐…", "info");
        const res = await mineSalt(
          factory,
          built,
          suffix,
          (tried, addr) => showToast(`已尝试 ${tried} 次，当前 ${shorten(addr)}`, "info"),
          abortRef.current.signal
        );
        setMineResult(res);
        showToast(`靓号挖到：${shorten(res.address)}`, "success");
      }
    } catch (e: any) {
      showToast(e.message || "挖盐失败", "error");
    } finally {
      setMining(false);
      abortRef.current = null;
    }
  };

  const handleCreate = async () => {
    if (!signer || !factoryInfo || !canCreate || !mineResult) return;
    setCreating(true);
    try {
      let res;
      if (deployMode === "launch") {
        const bnbWei = ethers.parseEther(liquidityBnb).toString();
        res = await createTokenAndAddLiquidity(
          signer,
          params,
          mineResult.salt,
          factoryInfo.createFee,
          liquidityTokens.toString(),
          bnbWei
        );
      } else {
        res = await createToken(signer, params, mineResult.salt, factoryInfo.createFee);
      }
      setResult({ tokenAddress: res.tokenAddress, txHash: res.txHash });
      showToast("代币创建成功", "success");
    } catch (e: any) {
      showToast(e.reason || e.message || "创建失败", "error");
    } finally {
      setCreating(false);
    }
  };

  const feeBar = (fee: FeeBreakdown | null) => {
    if (!fee) return null;
    const total = fee.platformFee + fee.rewardFee + fee.liquidityFee + fee.burnFee + fee.fundFee;
    if (total === 0) return null;
    return (
      <div className="h-3 w-full overflow-hidden rounded-full bg-[var(--sb-border)]">
        <div className="flex h-full w-full">
          <div style={{ width: `${(fee.platformFee / total) * 100}%` }} className="bg-[var(--sb-red)]" />
          <div style={{ width: `${(fee.rewardFee / total) * 100}%` }} className="bg-[var(--sb-gold)]" />
          <div style={{ width: `${(fee.liquidityFee / total) * 100}%` }} className="bg-blue-400" />
          <div style={{ width: `${(fee.burnFee / total) * 100}%` }} className="bg-orange-400" />
          <div style={{ width: `${(fee.fundFee / total) * 100}%` }} className="bg-emerald-400" />
        </div>
      </div>
    );
  };

  const handleShareChange = (key: keyof SnowballParams, value: number) => {
    setParams((p) => {
      const next = { ...p, [key]: value };
      const { rewardShare, liquidityShare, burnShare } = next;
      const remaining = BPS - rewardShare - liquidityShare - burnShare;
      next.fundShare = Math.max(0, remaining);
      return next;
    });
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--sb-bg)] pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[var(--sb-border)] bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md">
              <Snowflake className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold leading-tight text-[var(--sb-text)] md:text-lg">燃烧发射台</h1>
              <p className="hidden text-xs text-[var(--sb-muted)] sm:block">LP 单边燃烧 · 自动回流 · 持币分红</p>
            </div>
          </div>

          <button
            onClick={connect}
            disabled={connecting || isConnected}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition md:px-4",
              isConnected
                ? "border border-[var(--sb-border)] bg-white text-[var(--sb-text)]"
                : "bg-[var(--sb-text)] text-white hover:bg-[var(--sb-text)]/90"
            )}
          >
            {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
            <span className="hidden sm:inline">{isConnected ? shorten(account!) : "连接钱包"}</span>
            <span className="sm:hidden">{isConnected ? shorten(account!) : "连接"}</span>
          </button>
        </div>
      </header>

      {/* Hero / status strip（Mint 风格） */}
      <section className="mx-auto max-w-6xl px-4 pb-6 pt-8">
        <div className="flex flex-col gap-5 rounded-3xl border border-[var(--sb-border)] bg-[var(--sb-card)] p-6 shadow-sm lg:flex-row lg:items-center">
          <div className="flex items-start gap-4 lg:flex-1">
            <div
              className={cn(
                "mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-[var(--sb-card)] shadow-[0_0_8px_currentColor]",
                isConnected ? "bg-[var(--sb-success)] text-[var(--sb-success)]" : "bg-[var(--sb-muted)] text-[var(--sb-muted)]"
              )}
            />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Rocket className="h-5 w-5 text-[var(--sb-gold)]" />
                <h2 className="text-2xl font-black tracking-tight text-[var(--sb-text)] lg:text-3xl">燃烧发射台</h2>
                <span className="rounded-md bg-[var(--sb-gold-light)] px-2 py-0.5 text-[10px] font-bold text-[var(--sb-gold)]">
                  LAUNCH
                </span>
              </div>
              <p className="mt-1.5 text-sm text-[var(--sb-muted)]">
                一键创建带 LP 单边燃烧机制的 meme 币：自动烧池、自动回流、持币分红
              </p>
              <p className="mt-1 text-xs text-[var(--sb-muted)]">
                {isConnected
                  ? `${shorten(account!)} · Factory ${shorten(FACTORY_ADDRESS)}`
                  : "连接钱包后会自动填入创建者接收地址"}
              </p>
              {factoryStatus === "failed" && (
                <p className="mt-2 flex items-center gap-1 text-xs text-[var(--sb-red)]">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  无法读取 Factory 信息（{shorten(FACTORY_ADDRESS)}），连接主网节点失败，请刷新重试
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[560px]">
            {[
              {
                label: "创建费",
                value: factoryInfo ? `${ethers.formatEther(factoryInfo.createFee)} BNB` : factoryStatus === "loading" ? "读取中…" : "--",
              },
              {
                label: "靓号后缀",
                value: factoryInfo ? (factoryInfo.requiredSuffix === "0" ? "无" : factoryInfo.requiredSuffix) : "--",
              },
              { label: "平台分成", value: "20%" },
              { label: "分红代币", value: "USDT" },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-[var(--sb-border)] bg-[var(--sb-bg)]/60 p-3 text-center transition-colors hover:border-[var(--sb-gold)]/40"
              >
                <div className="text-xs text-[var(--sb-muted)]">{item.label}</div>
                <div className="mt-1 text-sm font-bold text-[var(--sb-text)]">{item.value}</div>
              </div>
            ))}
          </div>

          {isConnected && (
            <button
              onClick={connect}
              className="shrink-0 rounded-xl bg-[var(--sb-text)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--sb-text)]/90"
            >
              切换网络
            </button>
          )}
        </div>
      </section>

      {/* Deploy mode */}
      <section className="mx-auto max-w-6xl px-4 pb-6">
        <div className="grid gap-4 md:grid-cols-2">
          {DEPLOY_MODES.map((mode) => (
            <button
              key={mode.key}
              onClick={() => setDeployMode(mode.key)}
              className={cn(
                "rounded-2xl border p-6 text-left transition",
                deployMode === mode.key
                  ? "border-[var(--sb-gold)] bg-[var(--sb-gold-light)]"
                  : "border-[var(--sb-border)] bg-white hover:border-[var(--sb-gold)]/50"
              )}
            >
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border",
                    deployMode === mode.key
                      ? "border-[var(--sb-gold)] bg-[var(--sb-gold)] text-white"
                      : "border-[var(--sb-muted)]"
                  )}
                >
                  {deployMode === mode.key && <Check className="h-3 w-3" />}
                </span>
                <span className="font-bold text-[var(--sb-text)]">{mode.title}</span>
              </div>
              <p className="text-sm text-[var(--sb-muted)]">{mode.desc}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Main form */}
      <main className="mx-auto grid max-w-6xl gap-6 px-4 md:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card title="基础信息" icon={Rocket} number="01">
            <div className="grid gap-5 md:grid-cols-2">
              <InputGroup
                label="代币名称"
                value={params.name}
                onChange={(v) => setParams((p) => ({ ...p, name: v }))}
                placeholder="如：Snowball Token"
              />
              <InputGroup
                label="代币符号"
                value={params.symbol}
                onChange={(v) => setParams((p) => ({ ...p, symbol: v.toUpperCase() }))}
                placeholder="如：SNOW"
              />
              <InputGroup
                label="总供应量"
                value={params.totalSupply}
                onChange={(v) => setParams((p) => ({ ...p, totalSupply: v }))}
                placeholder="1000000000"
                suffix="枚"
              />
              <InputGroup
                label="项目方收款地址"
                value={params.receiver}
                onChange={(v) => setParams((p) => ({ ...p, receiver: v }))}
                placeholder="0x..."
                hint="创建后代币所有权、未加池的币会归此地址"
              />
              <InputGroup
                label="基金/营销地址（可选）"
                value={params.fundAddress}
                onChange={(v) => setParams((p) => ({ ...p, fundAddress: v }))}
                placeholder="默认与收款地址相同"
                hint="用于接收 fundShare 部分的手续费"
              />
            </div>
          </Card>

          {deployMode === "launch" && (
            <Card title="一键加池设置" icon={Droplets} number="02">
              <div className="grid gap-5 md:grid-cols-2">
                <InputGroup
                  label="加池 BNB"
                  value={liquidityBnb}
                  onChange={setLiquidityBnb}
                  type="number"
                  suffix="BNB"
                  hint="创建时代币会先全部 mint 到 Factory，再用其中一部分加池"
                />
                <SliderGroup
                  label="加池代币比例"
                  value={liquidityTokenPercent}
                  onChange={setLiquidityTokenPercent}
                  min={1}
                  max={100}
                  step={1}
                  hint="剩余代币会转给项目方收款地址"
                />
              </div>
              <div className="mt-4 grid gap-2 text-sm text-[var(--sb-muted)]">
                <div className="flex justify-between">
                  <span>加池代币</span>
                  <span className="font-medium text-[var(--sb-text)]">{ethers.formatUnits(liquidityTokens, 18)} 枚</span>
                </div>
                <div className="flex justify-between">
                  <span>项目方保留</span>
                  <span className="font-medium text-[var(--sb-text)]">{ethers.formatUnits(remainingTokens, 18)} 枚</span>
                </div>
                <div className="flex justify-between">
                  <span>预估初始价格</span>
                  <span className="font-medium text-[var(--sb-text)]">
                    {initialPrice ? `${initialPrice.toExponential(6)} BNB/枚` : "--"}
                  </span>
                </div>
              </div>
            </Card>
          )}

          <Card title="交易税配置" icon={Droplets} number="03">
            {taxError && <p className="mb-4 text-sm text-[var(--sb-red)]">{taxError}</p>}
            <div className="grid gap-6 md:grid-cols-2">
              <SliderGroup
                label="买入税率"
                value={params.totalBuyTax}
                onChange={(v) => setParams((p) => ({ ...p, totalBuyTax: v }))}
                min={10}
                max={2500}
                step={10}
              />
              <SliderGroup
                label="卖出税率"
                value={params.totalSellTax}
                onChange={(v) => setParams((p) => ({ ...p, totalSellTax: v }))}
                min={10}
                max={2500}
                step={10}
              />
            </div>

            <div className="mt-6 border-t border-[var(--sb-border)] pt-6">
              <p className="mb-4 text-sm font-medium text-[var(--sb-text)]">
                税后分配比例（四项之和须 = 100%）
              </p>
              {shareError && <p className="mb-3 text-sm text-[var(--sb-red)]">{shareError}</p>}
              <div className="grid gap-4 md:grid-cols-2">
                <SliderGroup
                  label="持币分红 share"
                  value={params.rewardShare}
                  onChange={(v) => handleShareChange("rewardShare", v)}
                  min={0}
                  max={BPS}
                  step={100}
                  hint="持币分红占税后分配的比例"
                />
                <SliderGroup
                  label="自动回流 share"
                  value={params.liquidityShare}
                  onChange={(v) => handleShareChange("liquidityShare", v)}
                  min={0}
                  max={BPS}
                  step={100}
                />
                <SliderGroup
                  label="燃烧 share"
                  value={params.burnShare}
                  onChange={(v) => handleShareChange("burnShare", v)}
                  min={0}
                  max={BPS}
                  step={100}
                />
                <SliderGroup
                  label="基金 share"
                  value={params.fundShare}
                  onChange={(v) => handleShareChange("fundShare", v)}
                  min={0}
                  max={BPS}
                  step={100}
                  hint="自动承接剩余比例"
                />
              </div>
            </div>
          </Card>

          <Card title="燃烧与风控" icon={FireExtinguisher} number="04">
            <div className="grid gap-5 md:grid-cols-2">
              <InputGroup
                label="燃烧间隔"
                value={params.lpBurnFrequency}
                onChange={(v) => setParams((p) => ({ ...p, lpBurnFrequency: Number(v) }))}
                type="number"
                suffix="秒"
                hint="默认 3600 秒 = 1 小时，最短 3600 秒"
              />
              <SliderGroup
                label="每次燃烧池子储备比例"
                value={params.percentForLPBurn}
                onChange={(v) => setParams((p) => ({ ...p, percentForLPBurn: v }))}
                min={1}
                max={100}
                step={1}
                hint="50 = 0.5%，最大 1%"
              />
              <InputGroup
                label="单钱包最大持仓"
                value={params.maxWalletAmount}
                onChange={(v) => setParams((p) => ({ ...p, maxWalletAmount: v }))}
                placeholder="0 = 无限制"
                suffix="枚"
              />
              <InputGroup
                label="单次最大卖出"
                value={params.maxSellAmount}
                onChange={(v) => setParams((p) => ({ ...p, maxSellAmount: v }))}
                placeholder="0 = 无限制"
                suffix="枚"
              />
              <InputGroup
                label="单次最大买入"
                value={params.maxBuyAmount}
                onChange={(v) => setParams((p) => ({ ...p, maxBuyAmount: v }))}
                placeholder="0 = 无限制"
                suffix="枚"
              />
              <InputGroup
                label="杀区块数（killBlocks）"
                value={params.killBlocks}
                onChange={(v) => setParams((p) => ({ ...p, killBlocks: Number(v) }))}
                type="number"
                hint="开盘后前 N 个区块限制交易，0 = 不限制，最大 100"
              />
            </div>
          </Card>

          <Card title="高级选项" icon={ShieldCheck} number="05">
            <div className="grid gap-5 md:grid-cols-2">
              <InputGroup
                label="转账手续费"
                value={params.transferFee}
                onChange={(v) => setParams((p) => ({ ...p, transferFee: Number(v) }))}
                type="number"
                suffix="bps"
                hint="钱包之间转账的额外费率"
              />
              <InputGroup
                label="持币分红门槛"
                value={params.mushHoldNum}
                onChange={(v) => setParams((p) => ({ ...p, mushHoldNum: v }))}
                placeholder="0"
                suffix="枚"
              />
              <InputGroup
                label="开盘延迟"
                value={params.secondTime}
                onChange={(v) => setParams((p) => ({ ...p, secondTime: Number(v) }))}
                type="number"
                suffix="秒"
                hint="创建后多久可交易"
              />
              <InputGroup
                label="空投份数"
                value={params.airdropNumbs}
                onChange={(v) => setParams((p) => ({ ...p, airdropNumbs: Number(v) }))}
                type="number"
                hint="0 ~ 3"
              />
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--sb-border)] bg-white/80 p-3 md:col-span-2">
                <input
                  type="checkbox"
                  checked={params.enableOffTrade}
                  onChange={(e) => setParams((p) => ({ ...p, enableOffTrade: e.target.checked }))}
                  className="h-4 w-4 accent-[var(--sb-gold)]"
                />
                <span className="text-sm text-[var(--sb-text)]">启用 off-trade 控制（未 launch 前禁止交易）</span>
              </label>
            </div>
          </Card>
        </div>

        {/* Sidebar preview */}
        <div className="space-y-6">
          <Card title="费用预览" icon={Sparkles}>
            <div className="mb-5 grid grid-cols-2 gap-3">
              <TaxRing fee={fees?.buy ?? null} label="买入税" totalTaxBps={params.totalBuyTax} loading={feesLoading} />
              <TaxRing fee={fees?.sell ?? null} label="卖出税" totalTaxBps={params.totalSellTax} loading={feesLoading} />
            </div>
            <div className="mb-5 grid grid-cols-1 gap-1.5 rounded-xl bg-[var(--sb-bg)]/60 p-3 text-xs text-[var(--sb-muted)] sm:grid-cols-2">
              {RING_LEGEND.map((item) => (
                <div key={item.key} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: item.color }} />
                  <span>{item.label}</span>
                  <span className="ml-auto font-medium text-[var(--sb-text)]">
                    {feeSharePct(fees?.buy, item.feeKey)}% / {feeSharePct(fees?.sell, item.feeKey)}%
                  </span>
                </div>
              ))}
            </div>
            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-[var(--sb-muted)]">买入总税</span>
                  <span className="font-bold text-[var(--sb-text)]">{formatBps(params.totalBuyTax)}</span>
                </div>
                {feesLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin text-[var(--sb-muted)]" />
                ) : (
                  feeBar(fees?.buy || null)
                )}
                <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-[var(--sb-muted)]">
                  <span>平台 {formatBps(fees?.buy.platformFee || 0)}</span>
                  <span>分红 {formatBps(fees?.buy.rewardFee || 0)}</span>
                  <span>回流 {formatBps(fees?.buy.liquidityFee || 0)}</span>
                  <span>燃烧 {formatBps(fees?.buy.burnFee || 0)}</span>
                  <span className="col-span-2">基金 {formatBps(fees?.buy.fundFee || 0)}</span>
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-[var(--sb-muted)]">卖出总税</span>
                  <span className="font-bold text-[var(--sb-text)]">{formatBps(params.totalSellTax)}</span>
                </div>
                {feesLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin text-[var(--sb-muted)]" />
                ) : (
                  feeBar(fees?.sell || null)
                )}
              </div>
            </div>
          </Card>

          <Card title="LP 燃烧效果" icon={Flame}>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--sb-muted)]">每次燃烧</span>
                <span className="font-bold text-[var(--sb-red)]">{(params.percentForLPBurn / 100).toFixed(2)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--sb-muted)]">间隔</span>
                <span className="font-medium text-[var(--sb-text)]">{(params.lpBurnFrequency / 3600).toFixed(2)} 小时</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--sb-muted)]">理论日燃烧</span>
                <span className="font-bold text-[var(--sb-red)]">
                  {Math.min((params.percentForLPBurn / 100) * (86400 / params.lpBurnFrequency), 100).toFixed(2)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--sb-muted)]">复利后日减少</span>
                <span className="font-bold text-[var(--sb-gold)]">
                  {((1 - Math.pow(1 - params.percentForLPBurn / 10000, 86400 / params.lpBurnFrequency)) * 100).toFixed(2)}%
                </span>
              </div>
              <p className="text-xs text-[var(--sb-muted)]">
                实际触发条件：达到间隔后，下一笔非免税地址向主 Pair 的卖出交易才会燃烧；期间没有触发交易则不补算。
              </p>
            </div>
          </Card>

          <Card title="靓号挖盐" icon={Sparkles}>
            <div className="space-y-4">
              <p className="text-sm text-[var(--sb-muted)]">
                使用 CREATE2 离线预测地址，找到符合后缀的 salt 后再上链创建。模式或参数变化后需重新挖盐。
              </p>
              <button
                onClick={handleMine}
                disabled={mining || !canCreate || !factoryInfo}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white transition",
                  mining || !canCreate || !factoryInfo
                    ? "cursor-not-allowed bg-[var(--sb-muted)]"
                    : "bg-gradient-to-r from-[var(--sb-gold)] to-orange-500 hover:shadow-lg"
                )}
              >
                {mining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {mining ? "挖盐中..." : "开始挖靓号"}
              </button>
              {mineResult && (
                <div className="rounded-xl border border-[var(--sb-gold)]/30 bg-[var(--sb-gold-light)] p-3 text-sm">
                  <p className="mb-1 text-[var(--sb-muted)]">预测地址</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="break-all font-mono font-medium text-[var(--sb-text)]">{mineResult.address}</span>
                    <button onClick={() => copy(mineResult.address)} className="shrink-0 text-[var(--sb-gold)] hover:text-[var(--sb-text)]">
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-[var(--sb-muted)]">尝试次数：{mineResult.attempts.toLocaleString()}</p>
                </div>
              )}
            </div>
          </Card>

          <div className="space-y-3">
            <button
              onClick={handleCreate}
              disabled={creating || !canCreate || !mineResult}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--sb-text)] py-3 text-sm font-bold text-white transition hover:bg-[var(--sb-text)]/90",
                (creating || !canCreate || !mineResult) && "cursor-not-allowed opacity-60"
              )}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
              {deployMode === "launch" ? "创建并加池开盘" : "仅创建代币"}
            </button>
            <p className="text-center text-xs text-[var(--sb-muted)]">
              {deployMode === "launch"
                ? `需支付 ${factoryInfo ? ethers.formatEther(factoryInfo.createFee) : "--"} BNB 创建费 + ${liquidityBnb} BNB 加池`
                : `需支付 ${factoryInfo ? ethers.formatEther(factoryInfo.createFee) : "--"} BNB 创建费`}
            </p>
          </div>
        </div>
      </main>

      {/* Result modal */}
      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--sb-gold-light)] text-[var(--sb-gold)]">
              <Check className="h-7 w-7" />
            </div>
            <h3 className="mb-2 text-xl font-bold text-[var(--sb-text)]">代币创建成功</h3>
            <div className="mb-4 space-y-2 rounded-xl bg-[var(--sb-bg)] p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--sb-muted)]">合约地址</span>
                <button onClick={() => copy(result.tokenAddress)} className="flex items-center gap-1 break-all font-mono text-[var(--sb-text)] hover:text-[var(--sb-gold)]">
                  {shorten(result.tokenAddress)}
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--sb-muted)]">交易哈希</span>
                <a
                  href={`https://bscscan.com/tx/${result.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-mono text-[var(--sb-text)] hover:text-[var(--sb-gold)]"
                >
                  {shorten(result.txHash)}
                </a>
              </div>
            </div>
            <p className="mb-4 mt-2 flex items-start gap-1.5 text-xs text-[var(--sb-muted)]">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--sb-gold)]" />
              服务端自动开源监控已启动：代币创建后会自动向 BscScan 提交源码验证，可在链上查看验证状态。
            </p>
            <button
              onClick={() => setResult(null)}
              className="w-full rounded-xl bg-[var(--sb-text)] py-3 text-sm font-bold text-white"
            >
              再创建一个
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
