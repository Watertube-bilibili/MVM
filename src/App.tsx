import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  FluentProvider,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  ProgressBar,
  Tooltip,
  webLightTheme,
} from "@fluentui/react-components";
import {
  Apps24Regular,
  Archive24Regular,
  ArrowDownload24Regular,
  ArrowClockwise24Regular,
  ArrowUpload24Regular,
  Box24Regular,
  CheckmarkCircle24Filled,
  ChevronDown20Regular,
  Code24Regular,
  Cube24Regular,
  Delete24Regular,
  Dismiss24Regular,
  DocumentText24Regular,
  FolderOpen24Regular,
  Info24Regular,
  MoreHorizontal24Regular,
  Play24Filled,
  PlugConnected24Regular,
  Save24Regular,
  Search24Regular,
  Settings24Regular,
  ShieldCheckmark24Regular,
  Warning24Regular,
  WindowConsole20Regular,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createDemoSnapshot, EMPTY_RUNTIME, STRUCTURE_FIXTURE } from "./demo";
import {
  formatArchitectureLabel,
  getDesktopApi,
  type AppFinding,
  type DarlingInstallPlan,
  type DarlingInstallProgress,
  type DesktopSnapshot,
  type ImportProgress,
  type MvmAppRecord,
  type NativeAppRunResult,
  type RuntimeSnapshot,
} from "./mvm-api";
import { getViewportMetrics, type ViewportMetrics } from "./viewport";

type StationId = "package" | "architecture" | "frameworks" | "backend";

const STATIONS: readonly {
  readonly id: StationId;
  readonly label: string;
  readonly icon: typeof Box24Regular;
}[] = [
  { id: "package", label: "封装", icon: Archive24Regular },
  { id: "architecture", label: "架构", icon: Code24Regular },
  { id: "frameworks", label: "框架", icon: Apps24Regular },
  { id: "backend", label: "后端", icon: PlugConnected24Regular },
];

const PHASE_LABELS: Readonly<Record<ImportProgress["phase"], string>> = {
  queued: "已排队",
  acquiring: "复制并校验来源",
  probing: "识别容器格式",
  indexing: "检查归档路径",
  materializing: "安全展开所需内容",
  discovering: "查找应用封装",
  analyzing: "分析 Info.plist 与 Mach-O",
  committing: "写入应用库",
  ready: "检测完成",
  "ready-with-warnings": "检测完成，有警告",
  unsupported: "格式暂不支持",
  failed: "检测失败",
};

function useInitialSnapshot(): DesktopSnapshot {
  const preview = new URLSearchParams(window.location.search).get("demo") === "1";
  return createDemoSnapshot(preview);
}

function useViewportMetrics(): ViewportMetrics {
  const measure = useCallback(() => getViewportMetrics(
    window.innerWidth,
    window.innerHeight,
    window.devicePixelRatio,
    window.matchMedia("(pointer: coarse)").matches
      ? "coarse"
      : window.matchMedia("(pointer: fine)").matches
        ? "fine"
        : "none",
  ), []);
  const [metrics, setMetrics] = useState(measure);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = measure();
        setMetrics(current => current.width === next.width && current.height === next.height && current.devicePixelRatio === next.devicePixelRatio && current.pointer === next.pointer ? current : next);
      });
    };
    const observer = new ResizeObserver(update);
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    const finePointer = window.matchMedia("(pointer: fine)");
    observer.observe(document.documentElement);
    window.addEventListener("resize", update, { passive: true });
    window.visualViewport?.addEventListener("resize", update, { passive: true });
    coarsePointer.addEventListener("change", update);
    finePointer.addEventListener("change", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      coarsePointer.removeEventListener("change", update);
      finePointer.removeEventListener("change", update);
    };
  }, [measure]);

  return metrics;
}

function shortPath(value: string): string {
  if (value.length <= 44) {
    return value;
  }
  return `${value.slice(0, 18)}…${value.slice(-23)}`;
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function statusLabel(app: MvmAppRecord): string {
  if (app.launchability === "candidate") return "可以尝试启动";
  if (app.launchability === "blocked") return "存在阻断项";
  if (app.launchability === "no-backend") return "需要运行后端";
  return "尚未测试";
}

function nativeTranslatorProbe(runtime: RuntimeSnapshot): RuntimeSnapshot["nativeTranslator"] {
  return runtime.nativeTranslator ?? {
    available: false,
    label: "MVM 原生转译器",
    detail: "等待桌面运行时探测",
  };
}

function nativeRunNotice(app: MvmAppRecord, result: NativeAppRunResult): {
  readonly tone: "info" | "error" | "success";
  readonly text: string;
} {
  if (result.status === "completed") {
    return {
      tone: "success",
      text: `${app.displayName} 已结束，退出码 ${result.exitCode}。${result.dialogsShown ? `已完成 ${result.dialogsShown} 个 Windows 对话框。` : '程序输出见下方。'}`,
    };
  }
  return {
    tone: result.status === "blocked" ? "error" : "info",
    text: `${app.displayName}：原生直译未完成（${result.code}）。${result.message}`,
  };
}

function severityIcon(severity: AppFinding["severity"]) {
  if (severity === "blocker") return <Warning24Regular aria-hidden />;
  if (severity === "warning") return <Info24Regular aria-hidden />;
  return <CheckmarkCircle24Filled aria-hidden />;
}

function AppMark({ small = false }: { readonly small?: boolean }) {
  return (
    <span className={small ? "app-mark app-mark--small" : "app-mark"} aria-hidden>
      <Cube24Regular />
    </span>
  );
}

function ToolRow({
  probe,
  optionalFallback = false,
}: {
  readonly probe: RuntimeSnapshot["sevenZip"];
  readonly optionalFallback?: boolean;
}) {
  const discoveredOnly = optionalFallback && probe.available;
  return (
    <div className="tool-row">
      <span className={probe.available ? discoveredOnly ? "tool-state tool-state--discovered" : "tool-state tool-state--ready" : "tool-state"} aria-hidden />
      <span className="tool-copy">
        <strong>{probe.label}{optionalFallback ? " · 可选回退" : ""}</strong>
        <span>{probe.version ? `${probe.version} · ${probe.detail}` : probe.detail}</span>
      </span>
      <span className="tool-result">{probe.available ? discoveredOnly ? "已发现" : "就绪" : "未就绪"}</span>
    </div>
  );
}

function AppLibrary({
  apps,
  selectedId,
  query,
  onQuery,
  onSelect,
  onCreateFixture,
}: {
  readonly apps: readonly MvmAppRecord[];
  readonly selectedId: string | null;
  readonly query: string;
  readonly onQuery: (value: string) => void;
  readonly onSelect: (appId: string) => void;
  readonly onCreateFixture: () => void;
}) {
  return (
    <aside className="library" id="application-library" aria-label="应用库" tabIndex={-1}>
      <div className="panel-heading library-heading">
        <div>
          <h2>应用库</h2>
          <p>{apps.length === 0 ? "还没有应用" : `${apps.length} 个记录`}</p>
        </div>
        <Tooltip content="创建默认测试应用" relationship="label">
          <Button appearance="subtle" icon={<Cube24Regular />} onClick={onCreateFixture} aria-label="创建默认测试应用" />
        </Tooltip>
      </div>

      <div className="library-search">
        <Input
          aria-label="搜索应用库"
          value={query}
          onChange={(_, data) => onQuery(data.value)}
          contentBefore={<Search24Regular aria-hidden />}
          placeholder="搜索名称或 Bundle ID"
          size="medium"
        />
      </div>

      <div className="library-list" role="listbox" aria-label="已导入应用">
        {apps.length === 0 ? (
          <div className="library-empty">
            <Box24Regular aria-hidden />
            <span>导入后会保存在这里</span>
          </div>
        ) : (
          apps.map((app) => (
            <button
              className={app.id === selectedId ? "library-item is-selected" : "library-item"}
              type="button"
              role="option"
              aria-selected={app.id === selectedId}
              aria-label={`${app.displayName}，${formatArchitectureLabel(app)}`}
              title={`${app.displayName} · ${formatArchitectureLabel(app)}`}
              key={app.id}
              onClick={() => onSelect(app.id)}
            >
              <AppMark small />
              <span className="library-item-rail-label" aria-hidden>{app.displayName}</span>
              <span className="library-item-copy">
                <strong>{app.displayName}</strong>
                <span>{formatArchitectureLabel(app)}</span>
              </span>
              {app.isFixture ? <span className="fixture-label">测试应用</span> : null}
            </button>
          ))
        )}
      </div>

      <div className="library-foot">
        <Settings24Regular aria-hidden />
        <span>数据仅保存在此电脑</span>
      </div>
    </aside>
  );
}

function EmptyWorkbench({
  dragging,
  desktopAvailable,
  onImportPackage,
  onImportFolder,
  onCreateFixture,
}: {
  readonly dragging: boolean;
  readonly desktopAvailable: boolean;
  readonly onImportPackage: () => void;
  readonly onImportFolder: () => void;
  readonly onCreateFixture: () => void;
}) {
  return (
    <section className={dragging ? "empty-workbench is-dragging" : "empty-workbench"} aria-labelledby="empty-title">
      <div className="empty-ruler" aria-hidden />
      <div className="empty-slab" aria-hidden>
        <div className="empty-slab-mark">
          <ArrowUpload24Regular />
        </div>
      </div>
      <div className="empty-copy">
        <h2 id="empty-title">把 Mac 应用放到原生直译台</h2>
        <p>拖入 DMG、PKG、ZIP，或选择一个 .app 文件夹。MVM 会在载入后立即尝试 Windows 兼容引擎，无需 WSL；PKG 安装脚本仍不会执行。</p>
        <div className="empty-actions">
          <Button appearance="primary" size="large" icon={<ArrowUpload24Regular />} onClick={onImportPackage}>
            载入安装包并直译
          </Button>
          <Button appearance="secondary" size="large" icon={<FolderOpen24Regular />} onClick={onImportFolder}>
            载入 .app 并直译
          </Button>
        </div>
        <button className="text-action" type="button" onClick={onCreateFixture}>
          没有样本？加载默认测试应用
        </button>
        {!desktopAvailable ? <p className="preview-note">当前是浏览器预览。文件导入需要在 MVM 桌面窗口中测试。</p> : null}
      </div>
    </section>
  );
}

function ImportingWorkbench({ progress }: { readonly progress: ImportProgress }) {
  return (
    <section className="importing-workbench" aria-live="polite" aria-busy="true">
      <div className="importing-heading">
        <div>
          <h2>{PHASE_LABELS[progress.phase]}</h2>
          <p>{progress.label}</p>
        </div>
        <strong>{Math.round(progress.progress * 100)}%</strong>
      </div>
      <ProgressBar value={progress.progress} thickness="large" />
      <div className="loading-runway" aria-hidden>
        {STATIONS.map((station, index) => (
          <div className={index === 0 ? "loading-station is-active" : "loading-station"} key={station.id}>
            <div className="skeleton skeleton-icon" />
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line skeleton-line--short" />
          </div>
        ))}
      </div>
      <p className="import-safety"><ShieldCheckmark24Regular aria-hidden /> 安装脚本不会在 Windows 上执行</p>
    </section>
  );
}

function StageDetail({
  app,
  station,
  runtime,
}: {
  readonly app: MvmAppRecord;
  readonly station: StationId;
  readonly runtime: RuntimeSnapshot;
}) {
  if (station === "package") {
    return (
      <div className="stage-detail-grid">
        <div><span>来源类型</span><strong>{app.sourceKind === "fixture" ? "默认测试应用" : app.sourceKind.toUpperCase()}</strong></div>
        <div><span>Bundle ID</span><strong className="mono">{app.bundleIdentifier ?? "未提供"}</strong></div>
        <div><span>入口程序</span><strong className="mono">{app.executableName ?? "未识别"}</strong></div>
        <div><span>来源指纹</span><strong className="mono" title={app.sourceSha256}>{shortPath(app.sourceSha256 ?? "未计算")}</strong></div>
      </div>
    );
  }

  if (station === "architecture") {
    return (
      <div className="slice-list">
        {app.architectures.map((slice, index) => (
          <div className="slice-row" key={`${slice.name}-${index}`}>
            <span className="arch-chip mono">{slice.name}</span>
            <span>{slice.fileType}</span>
            <span>最低 macOS {slice.minimumOs ?? app.minimumSystemVersion ?? "未知"}</span>
            <span>{slice.encrypted ? "已加密，不能分析执行内容" : "未发现 Mach-O 加密标记"}</span>
          </div>
        ))}
      </div>
    );
  }

  if (station === "frameworks") {
    return app.frameworks.length > 0 ? (
      <div className="framework-list">
        {app.frameworks.map((framework) => (
          <span className="framework-item" key={framework}><Apps24Regular aria-hidden />{framework}</span>
        ))}
      </div>
    ) : (
      <p className="detail-empty">主程序没有暴露可归类的 Framework 依赖。</p>
    );
  }

  const nativeTranslator = nativeTranslatorProbe(runtime);
  return (
    <div className="backend-plan">
      <div>
        <span>当前计划</span>
        <strong>{nativeTranslator.available ? "MVM Windows 兼容引擎" : "等待原生转译器"}</strong>
      </div>
      <div>
        <span>直译入口</span>
        <strong>{nativeTranslator.available ? "可直接尝试" : "当前不可用"}</strong>
      </div>
      <p>{nativeTranslator.available
        ? "MVM 会直接在 Windows 进程内解析 x86_64 Mach-O，并把已支持指令转成受限微指令执行。入口返回不代表窗口出现、图形界面可用或完整应用兼容。"
        : `原生转译器尚未就绪。${runtime.darling.available ? "已发现的 Darling 只作为可选回退。" : "Darling/WSL 可选回退不会阻塞原生路径。"}`}</p>
    </div>
  );
}

function InspectionWorkbench({
  app,
  station,
  runtime,
  dragging,
  onStation,
  onExport,
  onReveal,
  onRemove,
  onRun,
  running,
  result,
}: {
  readonly app: MvmAppRecord;
  readonly station: StationId;
  readonly runtime: RuntimeSnapshot;
  readonly dragging: boolean;
  readonly onStation: (station: StationId) => void;
  readonly onExport: () => void;
  readonly onReveal: () => void;
  readonly onRemove: () => void;
  readonly onRun: () => void;
  readonly running: boolean;
  readonly result: NativeAppRunResult | null;
}) {
  const uniqueArchitectures = [...new Set(app.architectures.map((slice) => slice.name))];
  const nativeTranslator = nativeTranslatorProbe(runtime);
  const handleStationKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % STATIONS.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + STATIONS.length) % STATIONS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = STATIONS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextStation = STATIONS[nextIndex];
    if (!nextStation) return;
    onStation(nextStation.id);
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    requestAnimationFrame(() => tabs?.[nextIndex]?.focus());
  };
  return (
    <section className={dragging ? "workbench is-dragging" : "workbench"} aria-label={`${app.displayName} 检测台`}>
      <header className="specimen-heading">
        <div className="specimen-identity">
          <AppMark />
          <div>
            <div className="title-line">
              <h2>{app.displayName}</h2>
              {app.isFixture ? <span className="fixture-label">测试应用</span> : null}
            </div>
            <p>{app.fileName} · {app.version ? `版本 ${app.version}` : "未提供版本"}</p>
          </div>
        </div>
        <div className="specimen-actions">
          <Button appearance="primary" icon={<Play24Filled />} disabled={running} onClick={onRun}>{running ? '运行中' : '运行应用'}</Button>
          <Button appearance="secondary" icon={<Save24Regular />} onClick={onExport}>导出报告</Button>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button appearance="subtle" icon={<MoreHorizontal24Regular />} aria-label="更多应用操作" />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<Save24Regular />} onClick={onExport}>导出兼容性报告</MenuItem>
                <MenuItem icon={<FolderOpen24Regular />} onClick={onReveal}>在资源管理器中显示来源</MenuItem>
                <MenuItem icon={<Delete24Regular />} onClick={onRemove}>从应用库移除</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      </header>

      {result?.appId === app.id ? <section className="program-output" aria-label="程序运行结果">
        <div className="program-output-heading"><strong>程序输出</strong><span>{result.status === 'completed' ? `退出码 ${result.exitCode}` : '运行未完成'} · {result.engine ?? 'MVM'} · {result.executedInstructionCount} 条指令</span></div>
        <pre tabIndex={0}>{[result.stdout, result.stderr, result.status !== 'completed' ? result.message : ''].filter(Boolean).join('\n') || '程序没有输出文本。'}</pre>
        {result.dialogsShown ? <p>应用通过系统接口显示了 {result.dialogsShown} 个 Windows 对话框。</p> : null}
      </section> : null}

      <div className="runway" role="tablist" aria-label="检测工位">
        {STATIONS.map(({ id, label, icon: Icon }, index) => {
          const selected = station === id;
          let summary: string;
          if (id === "package") summary = app.sourceKind === "fixture" ? "结构已生成" : app.sourceKind.toUpperCase();
          else if (id === "architecture") summary = formatArchitectureLabel(app);
          else if (id === "frameworks") summary = `${app.frameworks.length} 个直接框架`;
          else summary = nativeTranslator.available ? "Windows 原生已就绪" : "原生转译器待探测";
          return (
            <button
              className={`station station--${id}${selected ? " is-selected" : ""}`}
              type="button"
              role="tab"
              id={`station-tab-${id}`}
              aria-selected={selected}
              aria-controls="stage-detail"
              tabIndex={selected ? 0 : -1}
              key={id}
              onClick={() => onStation(id)}
              onKeyDown={(event) => handleStationKeyDown(event, index)}
            >
              <span className="station-index" aria-hidden><Icon /></span>
              {index < STATIONS.length - 1 ? <span className="station-connector" aria-hidden /> : null}
              <span className="station-label">{label}</span>
              <strong>{summary}</strong>
              {id === "package" ? (
                <span className="specimen-card">
                  <AppMark />
                  <span><b>{app.fileName}</b><small>{app.bundleIdentifier ?? "Bundle ID 未提供"}</small></span>
                </span>
              ) : null}
              {id === "architecture" ? (
                <span className="station-values">{uniqueArchitectures.map((arch) => <code key={arch}>{arch}</code>)}</span>
              ) : null}
              {id === "frameworks" ? (
                <span className="station-values">{app.frameworks.slice(0, 3).map((name) => <code key={name}>{name}</code>)}</span>
              ) : null}
              {id === "backend" ? <span className="backend-symbol"><PlugConnected24Regular /></span> : null}
            </button>
          );
        })}
      </div>

      <div className="stage-detail" id="stage-detail" role="tabpanel" aria-labelledby={`station-tab-${station}`} aria-live="polite">
        <div className="stage-detail-heading">
          <div>
            <h3>{STATIONS.find((item) => item.id === station)?.label}</h3>
            <p>{station === "package" ? shortPath(app.sourcePath) : "基于主程序的静态证据"}</p>
          </div>
          <span className={nativeTranslator.available ? "launchability launchability--candidate" : `launchability launchability--${app.launchability}`}>
            {nativeTranslator.available ? "原生直译可尝试" : statusLabel(app)}
          </span>
        </div>
        <StageDetail app={app} station={station} runtime={runtime} />
      </div>
    </section>
  );
}

const TERMINAL_INSTALL_PHASES = new Set<DarlingInstallProgress["phase"]>([
  "ready",
  "ready-cli-only",
  "canceled",
  "failed",
]);

function installProgressMessage(progress: DarlingInstallProgress): string {
  switch (progress.phase) {
    case "ready":
      return "Darling CLI 与 WSLg 通道均已验证；GUI 应用仍属实验兼容。";
    case "ready-cli-only":
      return "Darling CLI 已验证，但没有检测到 WSLg 图形通道。";
    case "failed":
      return "安装没有被标记为就绪。请查看下方日志后重试。";
    case "canceled":
      return "安装已在安全步骤边界停止；已完成的专用发行版内容会保留以便恢复。";
    case "canceling":
      return "取消请求已记录。MVM 会在当前不可强杀步骤完成后停止，不会破坏 WSL 注册或 APT 状态。";
    case "creating-distro":
      return "WSL 正在注册专用发行版；若请求取消，会先完成注册并写入 MVM 所有权标记。";
    case "installing-packages":
    case "configuring-user":
      return "软件包和系统配置步骤会完整结束后再响应取消，避免留下损坏的 dpkg/用户状态。";
    case "smoke-testing":
      return "正在以无 sudo 的 mvm 用户验证独立 Prefix；这里不代表任意 Mac 应用都兼容。";
    default:
      return "请保持 MVM 运行；下载、校验和展开可安全取消，已验证缓存可用于后续恢复。";
  }
}

function byteLabel(bytes: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "unit",
    unit: "megabyte",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(bytes / 1_048_576);
}

function DarlingInstallWizard({
  open,
  preparing,
  starting,
  acceptedRisk,
  plan,
  progress,
  logs,
  onAcceptedRisk,
  onStart,
  onCancel,
  onClose,
}: {
  readonly open: boolean;
  readonly preparing: boolean;
  readonly starting: boolean;
  readonly acceptedRisk: boolean;
  readonly plan: DarlingInstallPlan | null;
  readonly progress: DarlingInstallProgress | null;
  readonly logs: readonly string[];
  readonly onAcceptedRisk: (accepted: boolean) => void;
  readonly onStart: () => void;
  readonly onCancel: () => void;
  readonly onClose: () => void;
}) {
  const busy = progress !== null && !TERMINAL_INSTALL_PHASES.has(progress.phase);
  const terminal = progress !== null && TERMINAL_INSTALL_PHASES.has(progress.phase);
  const preventDismiss = preparing || starting || busy;

  return (
    <Dialog
      open={open}
      modalType="modal"
      onOpenChange={(_, data) => {
        if (!data.open && !preventDismiss) onClose();
      }}
    >
      <DialogSurface className="darling-installer-surface">
        <DialogBody className="darling-installer-body">
          <DialogTitle>安装实验运行后端</DialogTitle>
          <DialogContent className="darling-installer-content">
            {preparing ? (
              <div className="installer-preparing" aria-busy="true">
                <ProgressBar />
                <strong>正在检查 WSL 与专用发行版能力</strong>
                <span>确认前不会写入、安装或修改任何 Linux 发行版；检查现有专用发行版时可能短暂启动它。</span>
              </div>
            ) : progress ? (
              <div className="installer-progress" aria-live="polite" aria-busy={busy}>
                <div className="installer-progress-heading">
                  <div>
                    <strong>{progress.label}</strong>
                    <span>{progress.detail ?? "正在按固定清单执行"}</span>
                  </div>
                  <b>{Math.round(progress.progress * 100)}%</b>
                </div>
                <ProgressBar value={progress.progress} thickness="large" />
                {progress.downloadedBytes !== undefined && progress.totalBytes !== undefined ? (
                  <p className="installer-transfer">{byteLabel(progress.downloadedBytes)} / {byteLabel(progress.totalBytes)}</p>
                ) : null}
                <div className={`installer-state installer-state--${progress.phase}`}>
                  <ShieldCheckmark24Regular aria-hidden />
                  <span>{installProgressMessage(progress)}</span>
                </div>
                <div className="installer-log" role="log" aria-label="Darling 安装日志">
                  {logs.length > 0
                    ? logs.map((line, index) => <code key={`${index}-${line}`}>{line}</code>)
                    : <span>等待第一条安装日志…</span>}
                </div>
              </div>
            ) : plan ? (
              <div className="installer-plan">
                <div className="installer-truth">
                  <div>
                    <strong>专用 MVM-Darling</strong>
                    <span>Ubuntu 24.04 · WSL 2 · x86_64</span>
                  </div>
                  <span className={plan.canInstall ? "install-eligibility is-ready" : "install-eligibility"}>
                    {plan.canInstall ? "可以安装" : "需要处理"}
                  </span>
                </div>

                <dl className="installer-spec">
                  <div><dt>固定版本</dt><dd>{plan.releaseTag}</dd></div>
                  <div><dt>包版本</dt><dd>{plan.packageVersion}</dd></div>
                  <div><dt>来源</dt><dd title={plan.assetUrl}>github.com/darlinghq/darling</dd></div>
                  <div><dt>官方下载</dt><dd>{byteLabel(plan.assetBytes)}</dd></div>
                  <div className="installer-hash"><dt>SHA-256</dt><dd title={plan.assetSha256}>{plan.assetSha256}</dd></div>
                </dl>

                {plan.blockers.length > 0 ? (
                  <div className="installer-blockers" role="alert">
                    <strong>当前不能自动安装</strong>
                    {plan.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}
                  </div>
                ) : null}

                <ol className="installer-steps">
                  {plan.steps.map((step) => <li key={step}>{step}</li>)}
                </ol>

                <div className="installer-warning">
                  <Warning24Regular aria-hidden />
                  <div>
                    <strong>安装成功不等于 Mac 应用一定能运行</strong>
                    <p>官方 Debian 打包仍属实验；复杂 AppKit、Metal、WebKit 与 Apple 服务兼容性不能保证。</p>
                    {plan.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  </div>
                </div>

                {plan.canInstall ? (
                  <Checkbox
                    checked={acceptedRisk}
                    onChange={(_, data) => onAcceptedRisk(data.checked === true)}
                    label="我同意创建专用 WSL2 发行版，并在其中以 Linux root 安装上述固定官方包。"
                  />
                ) : null}
              </div>
            ) : (
              <div className="installer-blockers" role="alert">无法生成安装计划，请关闭后重试。</div>
            )}
          </DialogContent>
          <DialogActions className="darling-installer-actions">
            {busy ? (
              <Button appearance="secondary" disabled={!progress.canCancel} onClick={onCancel}>
                {progress.canCancel ? "取消安装" : "完成当前步骤后停止"}
              </Button>
            ) : null}
            {!progress && plan?.canInstall ? (
              <Button appearance="primary" icon={<ArrowDownload24Regular />} disabled={!acceptedRisk || starting} onClick={onStart}>
                {starting ? "正在启动安装…" : "一键安装 Darling"}
              </Button>
            ) : null}
            {!preventDismiss || terminal ? <Button appearance="secondary" onClick={onClose}>关闭</Button> : null}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function InstrumentBay({
  app,
  runtime,
  probing,
  launching,
  compact,
  open,
  onProbe,
  onInstallDarling,
  onLaunch,
  onClose,
  returnFocusId,
  nativeRun,
}: {
  readonly app: MvmAppRecord | null;
  readonly runtime: RuntimeSnapshot;
  readonly probing: boolean;
  readonly launching: boolean;
  readonly compact: boolean;
  readonly open: boolean;
  readonly onProbe: () => void;
  readonly onInstallDarling: () => void;
  readonly onLaunch: () => void;
  readonly onClose: () => void;
  readonly returnFocusId: string;
  readonly nativeRun: NativeAppRunResult | null;
}) {
  const findings = app?.findings ?? [];
  const nativeTranslator = nativeTranslatorProbe(runtime);
  const launchEnabled = app !== null && nativeTranslator.available;
  const selectedNativeRun = app && nativeRun?.appId === app.id ? nativeRun : null;
  const drawerRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!compact) {
      wasOpen.current = false;
      return undefined;
    }
    if (!open) {
      if (wasOpen.current) document.getElementById(returnFocusId)?.focus();
      wasOpen.current = false;
      return undefined;
    }

    wasOpen.current = true;
    const drawer = drawerRef.current;
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])';
    requestAnimationFrame(() => drawer?.querySelector<HTMLElement>(".instrument-close")?.focus());
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || drawer === null) return;
      const focusable = [...drawer.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => !element.hasAttribute("disabled"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        drawer.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    drawer?.addEventListener("keydown", keepFocusInside);
    return () => drawer?.removeEventListener("keydown", keepFocusInside);
  }, [compact, onClose, open, returnFocusId]);

  const hidden = compact && !open;
  return (
    <aside
      ref={drawerRef}
      className={open ? "instrument-bay is-open" : "instrument-bay"}
      id="runtime-panel"
      aria-label="运行时与发现"
      role={compact && open ? "dialog" : undefined}
      aria-modal={compact && open ? true : undefined}
      aria-hidden={hidden || undefined}
      inert={hidden}
      tabIndex={-1}
    >
      <section className="instrument-section">
        <div className="panel-heading compact-heading">
          <div>
            <h2>此电脑</h2>
            <p>运行能力探测</p>
          </div>
          <Tooltip content="重新探测本机工具" relationship="label">
            <Button
              appearance="subtle"
              icon={<ArrowClockwise24Regular />}
              aria-label="重新探测本机工具"
              disabled={probing}
              onClick={onProbe}
            />
          </Tooltip>
          <Button className="instrument-close" appearance="subtle" icon={<Dismiss24Regular />} aria-label="关闭诊断抽屉" onClick={onClose} />
        </div>
        <div className="tool-list" aria-live="polite">
          <ToolRow probe={nativeTranslator} />
          <ToolRow probe={runtime.sevenZip} />
          <ToolRow probe={runtime.wsl} />
          <ToolRow probe={runtime.darling} optionalFallback />
        </div>
        {!runtime.darling.available ? (
          <div className="runtime-install-callout">
            <div>
              <strong>可选 Darling 回退</strong>
              <span>兼容引擎遇到未支持的 Darwin 能力时可选；主流程无需 WSL。</span>
            </div>
            <Button appearance="secondary" icon={<ArrowDownload24Regular />} onClick={onInstallDarling}>
              一键安装回退
            </Button>
          </div>
        ) : null}
      </section>

      <section className="instrument-section findings-section" id="findings-panel">
        <div className="panel-heading compact-heading">
          <div>
            <h2>发现</h2>
            <p>{app === null ? "选择应用后显示" : findings.length === 0 ? "未发现阻断项" : `${findings.length} 条证据`}</p>
          </div>
        </div>
        <div className="findings-list">
          {app === null ? (
            <div className="bay-empty"><DocumentText24Regular aria-hidden /><span>导入或选择一个应用</span></div>
          ) : findings.length === 0 ? (
            <div className="bay-empty bay-empty--success"><CheckmarkCircle24Filled aria-hidden /><span>静态检查未发现明确阻断项</span></div>
          ) : (
            findings.map((finding) => (
              <details className={`finding finding--${finding.severity}`} key={finding.code} open={finding.severity === "blocker"}>
                <summary>
                  <span className="finding-icon">{severityIcon(finding.severity)}</span>
                  <span><strong>{finding.title}</strong><code>{finding.code}</code></span>
                  <ChevronDown20Regular className="finding-chevron" aria-hidden />
                </summary>
                <div className="finding-body">
                  <p>{finding.description}</p>
                  {finding.action ? <p className="finding-action">建议：{finding.action}</p> : null}
                </div>
              </details>
            ))
          )}
        </div>
      </section>

      <section className="launch-section">
        <div className={`launch-copy${selectedNativeRun ? ` native-run native-run--${selectedNativeRun.status}` : ""}`} id="native-launch-status" role="status" aria-live="polite">
          <strong>{app === null
            ? "等待应用"
            : selectedNativeRun?.status === "completed"
              ? `应用已结束 · 退出码 ${selectedNativeRun.exitCode}`
              : selectedNativeRun
                ? `原生直译未完成 · ${selectedNativeRun.code}`
                : launchEnabled
                  ? "运行 Mac 应用"
                  : "原生转译器未就绪"}</strong>
          <span>{app === null
            ? "拖入或选择应用后，MVM 会立即尝试原生直译。"
            : selectedNativeRun?.status === "completed"
              ? `本次完成 ${selectedNativeRun.dialogsShown ?? 0} 个系统对话框。详细结果见程序输出。`
              : selectedNativeRun
                ? selectedNativeRun.message
                : launchEnabled
                  ? "无需 WSL；遇到未支持指令或系统调用会明确停止。"
                  : nativeTranslator.detail}</span>
        </div>
        <Button
          className="native-launch-button"
          appearance="primary"
          size="large"
          icon={<Play24Filled />}
          disabled={!launchEnabled || launching}
          onClick={onLaunch}
          aria-describedby="native-launch-status"
          aria-busy={launching}
        >
          {launching ? "应用运行中" : <><span className="native-action-label native-action-label--full">运行应用</span><span className="native-action-label native-action-label--compact">运行</span></>}
        </Button>
      </section>
    </aside>
  );
}

function EventStrip({ snapshot, onExport }: { readonly snapshot: DesktopSnapshot; readonly onExport: () => void }) {
  return (
    <section className="event-strip" id="event-strip" aria-label="事件日志">
      <div className="event-strip-heading">
        <div><WindowConsole20Regular aria-hidden /><strong>事件</strong><span>{snapshot.events.length === 0 ? "等待检测" : `${snapshot.events.length} 条`}</span></div>
        <Tooltip content="导出全部事件" relationship="label">
          <Button appearance="subtle" icon={<Save24Regular />} aria-label="导出全部事件" onClick={onExport} disabled={snapshot.events.length === 0} />
        </Tooltip>
      </div>
      <div className="event-list">
        {snapshot.events.length === 0 ? (
          <p>导入、探测和启动事件会按顺序出现在这里。</p>
        ) : (
          snapshot.events.slice(0, 4).map((event) => (
            <div className={`event-row event-row--${event.level}`} key={event.id}>
              <time dateTime={event.at}>{timeLabel(event.at)}</time>
              <strong>{event.title}</strong>
              <span>{event.detail}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function App() {
  const api = useMemo(() => getDesktopApi(), []);
  const [snapshot, setSnapshot] = useState<DesktopSnapshot>(useInitialSnapshot);
  const [selectedId, setSelectedId] = useState<string | null>(() => snapshot.apps[0]?.id ?? null);
  const [station, setStation] = useState<StationId>("package");
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [probing, setProbing] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [operationBusy, setOperationBusy] = useState(false);
  const [nativeRun, setNativeRun] = useState<NativeAppRunResult | null>(null);
  const operationLockRef = useRef(false);
  const [instrumentOpen, setInstrumentOpen] = useState(false);
  const viewport = useViewportMetrics();
  const compactInstrument = (
    viewport.profile !== "wide" && viewport.profile !== "ultrawide"
  ) || viewport.heightProfile !== "tall";
  const closeInstrument = useCallback(() => setInstrumentOpen(false), []);
  const [notice, setNotice] = useState<{ readonly tone: "info" | "error" | "success"; readonly text: string } | null>(null);
  const [darlingInstallerOpen, setDarlingInstallerOpen] = useState(false);
  const [darlingPreparing, setDarlingPreparing] = useState(false);
  const [darlingStarting, setDarlingStarting] = useState(false);
  const [darlingAcceptedRisk, setDarlingAcceptedRisk] = useState(false);
  const [darlingPlan, setDarlingPlan] = useState<DarlingInstallPlan | null>(null);
  const [darlingProgress, setDarlingProgress] = useState<DarlingInstallProgress | null>(null);
  const [darlingLogs, setDarlingLogs] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!compactInstrument) setInstrumentOpen(false);
  }, [compactInstrument]);

  const refresh = useCallback(async () => {
    if (api === null) return;
    try {
      const next = await api.getSnapshot();
      setSnapshot(next);
      setSelectedId((current) => current && next.apps.some((app) => app.id === current) ? current : next.apps[0]?.id ?? null);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "无法读取本地应用库。" });
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (api === null) return undefined;
    return api.onImportProgress((next) => {
      setProgress(next);
      if (next.phase === "failed" || next.phase === "unsupported") {
        setNotice({ tone: "error", text: next.label });
      }
    });
  }, [api]);

  useEffect(() => {
    if (api === null) return undefined;
    return api.onDarlingInstallProgress((next) => {
      setDarlingProgress((current) => {
        if (current?.phase !== next.phase) {
          setDarlingLogs((lines) => [...lines, `[${next.phase}] ${next.label}`].slice(-200));
        }
        return next;
      });
      if (next.logLine) setDarlingLogs((lines) => [...lines, next.logLine!].slice(-200));
    });
  }, [api]);

  const filteredApps = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return snapshot.apps;
    return snapshot.apps.filter((app) =>
      `${app.displayName} ${app.fileName} ${app.bundleIdentifier ?? ""}`.toLocaleLowerCase("zh-CN").includes(normalized),
    );
  }, [query, snapshot.apps]);

  const selectedApp = snapshot.apps.find((app) => app.id === selectedId) ?? null;

  const importResolvedPath = useCallback(async (path: string | null) => {
    if (!path || api === null) return;
    if (operationLockRef.current) return;
    operationLockRef.current = true;
    setOperationBusy(true);
    setLaunching(true);
    setNativeRun(null);
    setNotice(null);
    setProgress({ jobId: crypto.randomUUID(), phase: "queued", progress: 0, label: "准备载入并原生直译" });
    try {
      const result = await api.importAndRunNative(path);
      setProgress(null);
      await refresh();
      if (result.importResult.canceled) return;
      if (result.importResult.app) {
        const importedApp = result.importResult.app;
        setSelectedId(importedApp.id);
        setStation("backend");
        if (result.runResult) {
          setNativeRun(result.runResult);
          setNotice(nativeRunNotice(importedApp, result.runResult));
        } else {
          setNotice({ tone: "info", text: `${importedApp.displayName} 已载入，但本次没有产生原生入口执行结果。` });
        }
      } else if (result.importResult.error) {
        setNotice({ tone: "error", text: `${result.importResult.error.title}：${result.importResult.error.description}` });
      }
    } catch (error) {
      setProgress(null);
      await refresh();
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "载入或原生直译失败，请查看事件日志。" });
    } finally {
      setProgress(null);
      setLaunching(false);
      setOperationBusy(false);
      operationLockRef.current = false;
    }
  }, [api, refresh]);

  const chooseInput = useCallback(async (kind: "package" | "app-folder") => {
    if (api === null) {
      setNotice({ tone: "info", text: "当前是浏览器预览。请从 MVM 桌面窗口选择本地文件。" });
      return;
    }
    if (operationLockRef.current) return;
    operationLockRef.current = true;
    setOperationBusy(true);
    let path: string | null = null;
    try {
      path = await api.chooseInput(kind);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "无法打开本地文件选择器。" });
    } finally {
      operationLockRef.current = false;
      setOperationBusy(false);
    }
    await importResolvedPath(path);
  }, [api, importResolvedPath]);

  const createFixture = useCallback(async () => {
    if (api === null) {
      const demo = createDemoSnapshot(true);
      setSnapshot(demo);
      setSelectedId(STRUCTURE_FIXTURE.id);
      setStation("package");
      setNotice({ tone: "info", text: "已加载浏览器内的结构样本。它不是可运行应用。" });
      return;
    }
    if (operationLockRef.current) return;
    operationLockRef.current = true;
    setOperationBusy(true);
    setLaunching(true);
    setNativeRun(null);
    try {
      const result = await api.createFixture();
      if (result.app) {
        const fixture = result.app;
        await refresh();
        setSelectedId(fixture.id);
        setStation("backend");
        const runResult = await api.runNative(fixture.id);
        setNativeRun(runResult);
        setNotice(nativeRunNotice(fixture, runResult));
        await refresh();
      } else if (result.error) {
        setNotice({ tone: "error", text: `${result.error.title}：${result.error.description}` });
      }
    } catch (error) {
      await refresh();
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "结构样本的原生直译未完成。" });
    } finally {
      setLaunching(false);
      setOperationBusy(false);
      operationLockRef.current = false;
    }
  }, [api, refresh]);

  const probeRuntime = useCallback(async () => {
    if (api === null) {
      setNotice({ tone: "info", text: "运行时探测只在桌面窗口中可用。" });
      return;
    }
    setProbing(true);
    try {
      const runtime = await api.probeRuntime();
      setSnapshot((current) => ({ ...current, runtime }));
      setNotice({ tone: "info", text: nativeTranslatorProbe(runtime).available
        ? "本机工具探测完成；MVM Windows 兼容引擎已就绪，无需 WSL。"
        : "本机工具探测完成；兼容引擎器当前不可用，Darling 仍只是可选回退。" });
    } finally {
      setProbing(false);
    }
  }, [api]);

  const openDarlingInstaller = useCallback(async () => {
    if (api === null) {
      setNotice({ tone: "info", text: "Darling 安装向导只在 MVM 桌面窗口中可用。" });
      return;
    }
    setDarlingInstallerOpen(true);
    if (darlingProgress && !TERMINAL_INSTALL_PHASES.has(darlingProgress.phase)) return;
    setDarlingPreparing(true);
    setDarlingPlan(null);
    setDarlingProgress(null);
    setDarlingLogs([]);
    setDarlingAcceptedRisk(false);
    setDarlingStarting(false);
    try {
      const plan = await api.prepareDarlingInstall();
      setDarlingPlan(plan);
      if (!plan.canInstall) {
        setNotice({ tone: "error", text: plan.blockers[0] ?? "当前环境不能自动安装 Darling。" });
      }
    } catch (error) {
      setDarlingProgress({
        jobId: crypto.randomUUID(),
        phase: "failed",
        progress: 1,
        label: "安装预检失败",
        detail: error instanceof Error ? error.message : "无法读取 WSL 安装能力。",
        canCancel: false,
      });
    } finally {
      setDarlingPreparing(false);
    }
  }, [api, darlingProgress]);

  const startDarlingInstall = useCallback(async () => {
    if (api === null || !darlingPlan?.canInstall || !darlingAcceptedRisk || darlingStarting) return;
    setDarlingStarting(true);
    setDarlingLogs((lines) => [...lines, "用户已确认专用发行版与 Linux root 安装边界。"]);
    try {
      const result = await api.installDarling({ acceptedRisk: true });
      if (result.completed) {
        await refresh();
        setNotice({ tone: "success", text: result.message });
      } else if (result.canceled) {
        setNotice({ tone: "info", text: result.message });
      } else if (!result.canceled) {
        setNotice({ tone: "error", text: result.message });
      }
    } catch (error) {
      setDarlingProgress((current) => ({
        jobId: current?.jobId ?? crypto.randomUUID(),
        phase: "failed",
        progress: 1,
        label: "安装未完成",
        detail: error instanceof Error ? error.message : "Darling 安装进程异常结束。",
        canCancel: false,
      }));
    } finally {
      setDarlingStarting(false);
    }
  }, [api, darlingAcceptedRisk, darlingPlan, darlingStarting, refresh]);

  const cancelDarlingInstall = useCallback(async () => {
    if (api === null || darlingProgress === null) return;
    await api.cancelDarlingInstall(darlingProgress.jobId);
  }, [api, darlingProgress]);

  const closeDarlingInstaller = useCallback(() => {
    setDarlingInstallerOpen(false);
    if (!darlingProgress || TERMINAL_INSTALL_PHASES.has(darlingProgress.phase)) {
      setDarlingPlan(null);
      setDarlingProgress(null);
      setDarlingLogs([]);
      setDarlingAcceptedRisk(false);
    }
  }, [darlingProgress]);

  const launchSelected = useCallback(async () => {
    if (api === null || selectedApp === null) return;
    if (operationLockRef.current) return;
    operationLockRef.current = true;
    setOperationBusy(true);
    setLaunching(true);
    setNativeRun(null);
    setStation("backend");
    try {
      const result = await api.runNative(selectedApp.id);
      setNativeRun(result);
      setNotice(nativeRunNotice(selectedApp, result));
      await refresh();
    } catch (error) {
      await refresh();
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "原生直译进程异常结束。" });
    } finally {
      setLaunching(false);
      setOperationBusy(false);
      operationLockRef.current = false;
    }
  }, [api, refresh, selectedApp]);

  const removeSelected = useCallback(async () => {
    if (selectedApp === null) return;
    if (api === null) {
      setSnapshot((current) => ({ ...current, apps: current.apps.filter((app) => app.id !== selectedApp.id) }));
      setSelectedId(null);
      return;
    }
    const next = await api.removeApp(selectedApp.id);
    setSnapshot(next);
    setSelectedId(next.apps[0]?.id ?? null);
    setNotice({ tone: "info", text: "记录已从应用库移除，原始安装包未被删除。" });
  }, [api, selectedApp]);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    if (api === null) {
      setNotice({ tone: "info", text: "拖放路径只在 MVM 桌面窗口中可用。" });
      return;
    }
    await importResolvedPath(api.pathForFile(file));
  }, [api, importResolvedPath]);

  return (
    <FluentProvider theme={webLightTheme} className="fluent-root">
      <div
        className="app-shell"
        data-layout={viewport.profile}
        data-height={viewport.heightProfile}
        data-instrument={compactInstrument ? "drawer" : "docked"}
        data-pointer={viewport.pointer}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
        onDragLeave={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(event) => void handleDrop(event)}
      >
        <header className="command-bar">
          <div className="brand-lockup">
            <AppMark small />
            <div><strong>MVM</strong><span>Mac 应用兼容实验平台</span></div>
          </div>

          <nav className="command-nav" aria-label="工作区导航">
            <Button appearance="subtle" icon={<Apps24Regular />} onClick={() => document.getElementById("application-library")?.focus()}><span className="command-label">应用库</span></Button>
            <Button
              id="diagnostics-trigger"
              appearance="subtle"
              icon={<ShieldCheckmark24Regular />}
              aria-expanded={!compactInstrument || instrumentOpen}
              aria-controls="runtime-panel"
              onClick={() => {
                if (compactInstrument) setInstrumentOpen((current) => !current);
                else document.getElementById("runtime-panel")?.focus();
              }}
            >
              <span className="command-label">诊断</span>
            </Button>
            <Button appearance="subtle" icon={<WindowConsole20Regular />} onClick={() => document.getElementById("event-strip")?.scrollIntoView({ block: "nearest" })}><span className="command-label">日志</span></Button>
          </nav>

          <div className="command-runtime" aria-label="运行时摘要">
            <span className={nativeTranslatorProbe(snapshot.runtime).available ? "runtime-chip is-ready" : "runtime-chip"}>
              MVM 原生 · {nativeTranslatorProbe(snapshot.runtime).available ? "就绪" : "不可用"}
            </span>
            <span className={snapshot.runtime.darling.available ? "runtime-chip is-discovered" : "runtime-chip"}>
              Darling · {snapshot.runtime.darling.available ? "可选回退已发现" : "可选回退"}
            </span>
          </div>

          <output
            className="viewport-indicator"
            title={`实时页面尺寸：${viewport.width} × ${viewport.height} CSS 像素；缩放 ${Math.round(viewport.devicePixelRatio * 100)}%`}
            aria-label={`当前页面尺寸 ${viewport.width} 乘 ${viewport.height}，${viewport.profileLabel}布局`}
          >
            <span className="viewport-size">{viewport.width}×{viewport.height}</span>
            <span className="viewport-mode">{viewport.profileLabel} · {Math.round(viewport.devicePixelRatio * 100)}%</span>
          </output>

          <Menu positioning="below-end">
            <MenuTrigger disableButtonEnhancement>
              <Button className="import-button" appearance="primary" size="large" icon={<ArrowUpload24Regular />} iconPosition="before" disabled={operationBusy}>
                <span className="import-button-label">载入并直译</span> <ChevronDown20Regular className="import-menu-chevron" aria-hidden />
              </Button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<Archive24Regular />} disabled={operationBusy} onClick={() => void chooseInput("package")}>载入 DMG、PKG 或 ZIP 并直译</MenuItem>
                <MenuItem icon={<FolderOpen24Regular />} disabled={operationBusy} onClick={() => void chooseInput("app-folder")}>载入 .app 并直译</MenuItem>
                <MenuItem icon={<Cube24Regular />} disabled={operationBusy} onClick={() => void createFixture()}>生成样本并运行入口</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </header>

        {notice ? (
          <div className={`app-notice app-notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
            {notice.tone === "error" ? <Warning24Regular aria-hidden /> : notice.tone === "success" ? <CheckmarkCircle24Filled aria-hidden /> : <Info24Regular aria-hidden />}
            <span>{notice.text}</span>
            <Button appearance="subtle" size="small" onClick={() => setNotice(null)}>关闭</Button>
          </div>
        ) : null}

        <main className="workspace-grid">
          <AppLibrary
            apps={filteredApps}
            selectedId={selectedId}
            query={query}
            onQuery={setQuery}
            onSelect={(id) => { setSelectedId(id); setStation("package"); }}
            onCreateFixture={() => void createFixture()}
          />

          <div className="workspace-main" id="inspection-workbench">
            {progress ? (
              <ImportingWorkbench progress={progress} />
            ) : selectedApp ? (
              <InspectionWorkbench
                app={selectedApp}
                station={station}
                runtime={snapshot.runtime}
                dragging={dragging}
                onStation={setStation}
                onExport={() => { if (api) void api.exportReport(selectedApp.id); }}
                onReveal={() => { if (api) void api.revealSource(selectedApp.id); }}
                onRemove={() => void removeSelected()}
                onRun={() => void launchSelected()}
                running={launching || operationBusy}
                result={nativeRun}
              />
            ) : (
              <EmptyWorkbench
                dragging={dragging}
                desktopAvailable={api !== null}
                onImportPackage={() => void chooseInput("package")}
                onImportFolder={() => void chooseInput("app-folder")}
                onCreateFixture={() => void createFixture()}
              />
            )}
          </div>

          <InstrumentBay
            app={selectedApp}
            runtime={snapshot.runtime ?? EMPTY_RUNTIME}
            probing={probing}
            launching={launching || operationBusy}
            compact={compactInstrument}
            open={instrumentOpen}
            onProbe={() => void probeRuntime()}
            onInstallDarling={() => void openDarlingInstaller()}
            onLaunch={() => void launchSelected()}
            onClose={closeInstrument}
            returnFocusId="diagnostics-trigger"
            nativeRun={nativeRun}
          />

          {compactInstrument && instrumentOpen ? <button className="instrument-scrim" type="button" aria-label="关闭诊断抽屉" onClick={closeInstrument} /> : null}

          <EventStrip snapshot={snapshot} onExport={() => { if (api) void api.exportEvents(); }} />
        </main>

        {dragging ? <div className="drop-overlay" role="status" aria-live="polite"><ArrowUpload24Regular aria-hidden /><strong>松开后载入并原生直译</strong><span>无需 WSL · 不会执行 PKG 脚本</span></div> : null}
      </div>
      <DarlingInstallWizard
        open={darlingInstallerOpen}
        preparing={darlingPreparing}
        starting={darlingStarting}
        acceptedRisk={darlingAcceptedRisk}
        plan={darlingPlan}
        progress={darlingProgress}
        logs={darlingLogs}
        onAcceptedRisk={setDarlingAcceptedRisk}
        onStart={() => void startDarlingInstall()}
        onCancel={() => void cancelDarlingInstall()}
        onClose={closeDarlingInstaller}
      />
    </FluentProvider>
  );
}
