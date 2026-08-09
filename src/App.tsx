import {
  Button,
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
  type DesktopSnapshot,
  type ImportProgress,
  type MvmAppRecord,
  type RuntimeSnapshot,
} from "./mvm-api";

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

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
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

function ToolRow({ probe }: { readonly probe: RuntimeSnapshot["sevenZip"] }) {
  const discoveredOnly = probe.label === "Darling" && probe.available;
  return (
    <div className="tool-row">
      <span className={probe.available ? discoveredOnly ? "tool-state tool-state--discovered" : "tool-state tool-state--ready" : "tool-state"} aria-hidden />
      <span className="tool-copy">
        <strong>{probe.label}</strong>
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
        <Tooltip content="创建本地结构样本" relationship="label">
          <Button appearance="subtle" icon={<Cube24Regular />} onClick={onCreateFixture} aria-label="创建本地结构样本" />
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
              key={app.id}
              onClick={() => onSelect(app.id)}
            >
              <AppMark small />
              <span className="library-item-copy">
                <strong>{app.displayName}</strong>
                <span>{formatArchitectureLabel(app)}</span>
              </span>
              {app.isFixture ? <span className="fixture-label">结构样本</span> : null}
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
        <h2 id="empty-title">把 Mac 应用放到检测台</h2>
        <p>拖入 DMG、PKG、ZIP，或选择一个 .app 文件夹。MVM 会先检查，再决定能否交给运行后端。</p>
        <div className="empty-actions">
          <Button appearance="primary" size="large" icon={<ArrowUpload24Regular />} onClick={onImportPackage}>
            选择安装包
          </Button>
          <Button appearance="secondary" size="large" icon={<FolderOpen24Regular />} onClick={onImportFolder}>
            选择 .app 文件夹
          </Button>
        </div>
        <button className="text-action" type="button" onClick={onCreateFixture}>
          没有样本？加载本地结构样本
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
        <div><span>来源类型</span><strong>{app.sourceKind === "fixture" ? "本地结构样本" : app.sourceKind.toUpperCase()}</strong></div>
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

  return (
    <div className="backend-plan">
      <div>
        <span>当前计划</span>
        <strong>{runtime.darling.available ? "Darling / WSL 实验后端" : "仅诊断，不启动"}</strong>
      </div>
      <div>
        <span>启动资格</span>
        <strong>{statusLabel(app)}</strong>
      </div>
      <p>{runtime.darling.available ? "MVM 会在启动前复核完整 Bundle 指纹，再把原应用路径交给用户自备的 Darling/WSL。该实验后端不是安全沙箱。" : "安装或连接运行后端之前，MVM 不会把分析成功标记为可运行。"}</p>
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
}: {
  readonly app: MvmAppRecord;
  readonly station: StationId;
  readonly runtime: RuntimeSnapshot;
  readonly dragging: boolean;
  readonly onStation: (station: StationId) => void;
  readonly onExport: () => void;
  readonly onReveal: () => void;
  readonly onRemove: () => void;
}) {
  const uniqueArchitectures = [...new Set(app.architectures.map((slice) => slice.name))];
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
              {app.isFixture ? <span className="fixture-label">结构样本</span> : null}
            </div>
            <p>{app.fileName} · {app.version ? `版本 ${app.version}` : "未提供版本"}</p>
          </div>
        </div>
        <div className="specimen-actions">
          <Button appearance="secondary" icon={<Save24Regular />} onClick={onExport}>导出报告</Button>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button appearance="subtle" icon={<MoreHorizontal24Regular />} aria-label="更多应用操作" />
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<FolderOpen24Regular />} onClick={onReveal}>在资源管理器中显示来源</MenuItem>
                <MenuItem icon={<Delete24Regular />} onClick={onRemove}>从应用库移除</MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      </header>

      <div className="runway" role="tablist" aria-label="检测工位">
        {STATIONS.map(({ id, label, icon: Icon }, index) => {
          const selected = station === id;
          let summary: string;
          if (id === "package") summary = app.sourceKind === "fixture" ? "结构已生成" : app.sourceKind.toUpperCase();
          else if (id === "architecture") summary = formatArchitectureLabel(app);
          else if (id === "frameworks") summary = `${app.frameworks.length} 个直接框架`;
          else summary = runtime.darling.available ? "实验后端已发现" : "需要运行后端";
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
          <span className={`launchability launchability--${app.launchability}`}>{statusLabel(app)}</span>
        </div>
        <StageDetail app={app} station={station} runtime={runtime} />
      </div>
    </section>
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
  onLaunch,
  onClose,
  returnFocusId,
}: {
  readonly app: MvmAppRecord | null;
  readonly runtime: RuntimeSnapshot;
  readonly probing: boolean;
  readonly launching: boolean;
  readonly compact: boolean;
  readonly open: boolean;
  readonly onProbe: () => void;
  readonly onLaunch: () => void;
  readonly onClose: () => void;
  readonly returnFocusId: string;
}) {
  const findings = app?.findings ?? [];
  const launchEnabled = app !== null && app.launchability === "candidate" && runtime.darling.available;
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
          <ToolRow probe={runtime.sevenZip} />
          <ToolRow probe={runtime.wsl} />
          <ToolRow probe={runtime.darling} />
        </div>
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
        <div className="launch-copy">
          <strong>{app === null ? "等待应用" : launchEnabled ? "可以进行实验启动" : statusLabel(app)}</strong>
          <span>{launchEnabled ? "启动结果会与静态分析分开记录。" : "没有真实后端时，MVM 保持启动按钮禁用。"}</span>
        </div>
        <Button
          appearance="primary"
          size="large"
          icon={<Play24Filled />}
          disabled={!launchEnabled || launching}
          onClick={onLaunch}
        >
          {launching ? "正在准备" : "尝试启动"}
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
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [probing, setProbing] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [instrumentOpen, setInstrumentOpen] = useState(false);
  const compactInstrument = useMediaQuery("(max-width: 1180px)");
  const closeInstrument = useCallback(() => setInstrumentOpen(false), []);
  const [notice, setNotice] = useState<{ readonly tone: "info" | "error" | "success"; readonly text: string } | null>(null);

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
    setNotice(null);
    setProgress({ jobId: crypto.randomUUID(), phase: "queued", progress: 0, label: "准备导入" });
    try {
      const result = await api.importPath(path);
      setProgress(null);
      if (result.canceled) return;
      if (result.app) {
        await refresh();
        setSelectedId(result.app.id);
        setStation("package");
        setNotice({ tone: "success", text: `${result.app.displayName} 已完成静态检测。` });
      } else if (result.error) {
        setNotice({ tone: "error", text: `${result.error.title}：${result.error.description}` });
      }
    } catch (error) {
      setProgress(null);
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "导入失败，请导出日志后重试。" });
    }
  }, [api, refresh]);

  const chooseInput = useCallback(async (kind: "package" | "app-folder") => {
    if (api === null) {
      setNotice({ tone: "info", text: "当前是浏览器预览。请从 MVM 桌面窗口选择本地文件。" });
      return;
    }
    await importResolvedPath(await api.chooseInput(kind));
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
    const result = await api.createFixture();
    if (result.app) {
      await refresh();
      setSelectedId(result.app.id);
      setStation("package");
      setNotice({ tone: "info", text: "结构样本已由 MVM 本地生成并通过真实分析器。" });
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
      setNotice({ tone: "info", text: "本机工具探测完成；Darling 用户态只会在你点击启动后验证。" });
    } finally {
      setProbing(false);
    }
  }, [api]);

  const launchSelected = useCallback(async () => {
    if (api === null || selectedApp === null) return;
    setLaunching(true);
    try {
      const result = await api.launch(selectedApp.id);
      setNotice({ tone: result.started ? "info" : "error", text: result.message });
      await refresh();
    } finally {
      setLaunching(false);
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
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragging(false);
        }}
        onDrop={(event) => void handleDrop(event)}
      >
        <header className="command-bar">
          <div className="brand-lockup">
            <AppMark small />
            <div><strong>MVM</strong><span>Mac 应用兼容实验平台</span></div>
          </div>

          <nav className="command-nav" aria-label="工作区导航">
            <Button appearance="subtle" icon={<Apps24Regular />} onClick={() => document.getElementById("application-library")?.focus()}>应用库</Button>
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
              诊断
            </Button>
            <Button appearance="subtle" icon={<WindowConsole20Regular />} onClick={() => document.getElementById("event-strip")?.scrollIntoView({ block: "nearest" })}>日志</Button>
          </nav>

          <div className="command-runtime" aria-label="运行时摘要">
            <span className={snapshot.runtime.sevenZip.available ? "runtime-chip is-ready" : "runtime-chip"}>
              7-Zip {snapshot.runtime.sevenZip.available ? "就绪" : "待探测"}
            </span>
            <span className={snapshot.runtime.darling.available ? "runtime-chip is-discovered" : "runtime-chip"}>
              Darling {snapshot.runtime.darling.available ? "已发现" : "未连接"}
            </span>
          </div>

          <Menu positioning="below-end">
            <MenuTrigger disableButtonEnhancement>
              <Button appearance="primary" size="large" icon={<ArrowUpload24Regular />} iconPosition="before">
                导入应用 <ChevronDown20Regular aria-hidden />
              </Button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<Archive24Regular />} onClick={() => void chooseInput("package")}>选择 DMG、PKG 或 ZIP</MenuItem>
                <MenuItem icon={<FolderOpen24Regular />} onClick={() => void chooseInput("app-folder")}>选择 .app 文件夹</MenuItem>
                <MenuItem icon={<Cube24Regular />} onClick={() => void createFixture()}>生成本地结构样本</MenuItem>
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
            launching={launching}
            compact={compactInstrument}
            open={instrumentOpen}
            onProbe={() => void probeRuntime()}
            onLaunch={() => void launchSelected()}
            onClose={closeInstrument}
            returnFocusId="diagnostics-trigger"
          />

          {compactInstrument && instrumentOpen ? <button className="instrument-scrim" type="button" aria-label="关闭诊断抽屉" onClick={closeInstrument} /> : null}

          <EventStrip snapshot={snapshot} onExport={() => { if (api) void api.exportEvents(); }} />
        </main>

        {dragging ? <div className="drop-overlay" aria-hidden><ArrowUpload24Regular /><strong>松开后开始安全检测</strong><span>不会执行安装脚本</span></div> : null}
      </div>
    </FluentProvider>
  );
}
