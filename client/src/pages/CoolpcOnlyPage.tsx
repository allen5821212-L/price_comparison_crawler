import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/_core/hooks/useAuth";
import { downloadCsv, toCsv } from "@/lib/csvExport";
import { trpc } from "@/lib/trpc";
import { Bell, BellRing, BookmarkPlus, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, Copy, Download, ExternalLink, GripVertical, History, Link, ListChecks, ListPlus, Lock, PackageX, Pin, PinOff, Play, RefreshCw, Save, Share2, Store, Trash2, Unlock, Upload, UserPlus, Users, X } from "lucide-react";
import React, { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const MAX_BATCH_CATEGORIES = 12;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const price = (value: number) => `NT$${value.toLocaleString()}`;
const durationLabel = (value: number | null | undefined) => {
  if (!value || value < 60_000) return "少於 1 分鐘";
  const minutes = Math.round(value / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分` : `約 ${minutes} 分`;
};
export type RecrawlReminderJob = { status: "queued" | "running" | "completed" | "failed" | "cancelled"; startedAt: Date | string | null; finishedAt: Date | string | null; durationMs: number | null };

export type RecrawlReminderSummaryData = {
  estimateMs: number | null;
  estimateSampleSize: number;
  latestJob: RecrawlReminderJob | null;
};

const recentResultLabel = (job: RecrawlReminderJob | null) => {
  if (!job) return "最近補抓：尚無分類補抓紀錄";
  const status = { queued: "排隊中", running: "執行中", completed: "已完成", failed: "失敗", cancelled: "已取消" }[job.status];
  const finished = job.finishedAt ? ` · ${new Date(job.finishedAt).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "";
  const duration = job.durationMs ? ` · 耗時 ${durationLabel(job.durationMs)}` : "";
  return `最近補抓：${status}${duration}${finished}`;
};

export function RecrawlReminderSummary({ reminder }: { reminder: RecrawlReminderSummaryData }) {
  return <div className="mt-1.5 space-y-1 text-xs text-muted-foreground"><p className="flex items-center gap-1.5"><Clock3 className="size-3.5 text-primary" />預估補抓時間：{reminder.estimateMs ? `${durationLabel(reminder.estimateMs)}${reminder.estimateSampleSize ? `（依 ${reminder.estimateSampleSize} 筆分類工作）` : ""}` : "累積更多分類補抓紀錄後提供"}</p><p className="flex items-center gap-1.5"><CheckCircle2 className="size-3.5 text-emerald-500" />{recentResultLabel(reminder.latestJob)}</p></div>;
}

export function nextSelectedCategories(current: ReadonlySet<string>, categoryName: string, checked: boolean, limit = MAX_BATCH_CATEGORIES) {
  const next = new Set(current);
  if (!checked) {
    next.delete(categoryName);
    return next;
  }
  if (!next.has(categoryName) && next.size < limit) next.add(categoryName);
  return next;
}

export function createBatchCategoryRequest(selectedCategories: ReadonlySet<string>) {
  return { categoryNames: Array.from(selectedCategories) };
}

export function createRecrawlPresetInput(name: string, selectedCategories: ReadonlySet<string>) {
  return { name: name.trim(), categoryNames: Array.from(selectedCategories) };
}

export function reorderRecrawlPresetIds(ids: number[], sourceId: number, targetId: number) {
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return ids;
  const next = [...ids];
  next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, sourceId);
  return next;
}

export const RECRAWL_PRESET_DRAG_MIME = "application/x-recrawl-preset-id";
type RecrawlPresetDataTransfer = Pick<DataTransfer, "effectAllowed" | "getData" | "setData">;

export function writeRecrawlPresetDragPayload(dataTransfer: RecrawlPresetDataTransfer, presetId: number) {
  dataTransfer.setData(RECRAWL_PRESET_DRAG_MIME, String(presetId));
  dataTransfer.effectAllowed = "move";
}

export function readRecrawlPresetDragPayload(dataTransfer: Pick<DataTransfer, "getData">) {
  const presetId = Number(dataTransfer.getData(RECRAWL_PRESET_DRAG_MIME));
  return Number.isInteger(presetId) && presetId > 0 ? presetId : null;
}

export function createRecrawlPresetReorderInput(ids: number[]) {
  return { ids };
}

export function moveRecrawlPresetId(ids: number[], sourceId: number, offset: -1 | 1) {
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = sourceIndex + offset;
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= ids.length) return ids;
  return reorderRecrawlPresetIds(ids, sourceId, ids[targetIndex]!);
}

export function createRecrawlPresetImportInput(backup: unknown, conflictStrategies: Record<string, "overwrite" | "skip" | "copy"> = {}) {
  return { backup, conflictStrategies };
}

export function shouldShowRecrawlPresetManager(presetCount: number, historyCount: number) {
  return presetCount > 0 || historyCount > 0;
}

const presetEstimateLabel = (estimateMs: number | null, sampleSize: number) => estimateMs
  ? `預估總耗時 ${durationLabel(estimateMs)}${sampleSize ? `（依 ${sampleSize} 筆分類工作）` : ""}`
  : "累積更多分類補抓紀錄後提供";

const templateModeLabel = (mode: "read_only" | "collaborative") => mode === "collaborative" ? "共同維護" : "只讀";
const templateUpdatedLabel = (value: Date | string) => `更新於 ${new Date(value).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;

export type TeamTemplateCollaborationMode = "read_only" | "collaborative";

export function createTeamTemplateModeInput(id: number, collaborationMode: TeamTemplateCollaborationMode) {
  return { id, collaborationMode };
}

export function createTeamTemplateCollaboratorInput(id: number, email: string) {
  return { id, email: email.trim().toLowerCase() };
}

export function createTeamTemplateCollaboratorRemovalInput(id: number, collaboratorUserId: number) {
  return { id, collaboratorUserId };
}

export function createTeamTemplateCategoryUpdateInput(id: number, selectedCategories: ReadonlySet<string>) {
  return { id, categoryNames: Array.from(selectedCategories) };
}

const jobStatusLabel = (status: RecrawlReminderJob["status"]) => ({ queued: "排隊中", running: "執行中", completed: "已完成", failed: "失敗", cancelled: "已取消" }[status]);
export function formatRecrawlExecutionProgress(total: number, completedCount: number, failedCount: number) {
  if (!total) return "尚未連結分類工作";
  const terminalCount = completedCount + failedCount;
  return `處理進度 ${terminalCount}/${total}（${Math.round(terminalCount / total * 100)}%）`;
}

export function formatRecrawlExecutionSuccessRate(rate: number | null) {
  return rate === null ? "尚未有終態工作" : `終態成功率 ${Math.round(rate * 100)}%`;
}

const completionRateLabel = formatRecrawlExecutionSuccessRate;

export function filterRecrawlPresetHistoryEntries<T extends { jobs: Array<{ status: string }>; execution: { total: number; completedCount: number; failedCount: number; pendingCount: number } }>(entries: T[], status: "all" | "success" | "failed" | "running") {
  if (status === "all") return entries;
  return entries.filter(entry => {
    if (!entry.jobs.length) return false;
    if (status === "failed") return entry.jobs.some(job => job.status === "failed");
    if (status === "running") return entry.jobs.some(job => job.status === "queued" || job.status === "running");
    return entry.jobs.every(job => job.status === "completed");
  });
}

type RecrawlPresetImportPreview = {
  counts: { new: number; unchanged: number; conflict: number };
  items: Array<{
    name: string;
    categoryNames: string[];
    kind: "new" | "unchanged" | "conflict";
  }>;
};

export default function CoolpcOnlyPage() {
  const { user } = useAuth();
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);
  const [categorySort, setCategorySort] = useState<"gap_desc" | "coverage_asc" | "coverage_desc">("gap_desc");
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [presetName, setPresetName] = useState("");
  const [draggedPresetId, setDraggedPresetId] = useState<number | null>(null);
  const [historyStatus, setHistoryStatus] = useState<"all" | "success" | "failed" | "running">("all");
  const [importBackup, setImportBackup] = useState<unknown>(null);
  const [importPreview, setImportPreview] = useState<RecrawlPresetImportPreview | null>(null);
  const [importConflictStrategies, setImportConflictStrategies] = useState<Record<string, "overwrite" | "skip" | "copy">>({});
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [collaboratorEmails, setCollaboratorEmails] = useState<Record<number, string>>({});
  const importPresetInputRef = useRef<HTMLInputElement>(null);
  const coverageQuery = trpc.comparison.sinyaCoverage.useQuery(undefined, { enabled: user?.role === "admin" });
  const unlistedQuery = trpc.comparison.sinyaUnlisted.useQuery({ category: category === "all" ? undefined : category, page, pageSize: 25 }, { enabled: user?.role === "admin" });
  const exportQuery = trpc.comparison.sinyaUnlistedExport.useQuery({ category: category === "all" ? undefined : category }, { enabled: false });
  const remindersQuery = trpc.crawler.coolpcRecrawlReminders.useQuery(undefined, { enabled: user?.role === "admin", refetchInterval: 60_000 });
  const presetsQuery = trpc.crawler.coolpcRecrawlPresets.useQuery(undefined, { enabled: user?.role === "admin" });
  const presetHistoryQuery = trpc.crawler.coolpcRecrawlPresetHistory.useQuery(undefined, { enabled: user?.role === "admin" });
  const presetExportQuery = trpc.crawler.exportCoolpcRecrawlPresets.useQuery(undefined, { enabled: false });
  const teamTemplatesQuery = trpc.crawler.coolpcRecrawlPresetTemplates.useQuery(undefined, { enabled: user?.role === "admin" });
  const sharedTemplateToken = useMemo(() => typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("template"), []);
  const sharedTemplateQuery = trpc.crawler.coolpcRecrawlPresetTemplateByToken.useQuery({ token: sharedTemplateToken ?? "invalid" }, { enabled: user?.role === "admin" && Boolean(sharedTemplateToken) });
  const utils = trpc.useUtils();
  const saveReminder = trpc.crawler.saveCoolpcRecrawlReminder.useMutation({ onSuccess: () => void utils.crawler.coolpcRecrawlReminders.invalidate() });
  const setReminderActive = trpc.crawler.setCoolpcRecrawlReminderActive.useMutation({ onSuccess: () => void utils.crawler.coolpcRecrawlReminders.invalidate() });
  const acknowledgeReminder = trpc.crawler.acknowledgeCoolpcRecrawlReminder.useMutation({ onSuccess: () => void utils.crawler.coolpcRecrawlReminders.invalidate() });
  const enqueueRecrawl = trpc.crawler.enqueue.useMutation({ onSuccess: () => { void utils.crawler.coolpcRecrawlReminders.invalidate(); void utils.crawler.jobs.invalidate(); } });
  const enqueueCategories = trpc.crawler.enqueueCategories.useMutation({
    onSuccess: result => {
      const created = result.createdCategoryNames.length;
      const existing = result.existingCategoryNames.length;
      toast.success(created ? `已排入 ${created} 個分類補抓工作${existing ? `；另有 ${existing} 個分類已在佇列中` : ""}` : "所選分類已在佇列或執行中");
      setSelectedCategories(new Set());
      void utils.crawler.jobs.invalidate();
      void utils.crawler.events.invalidate();
      void utils.crawler.coolpcRecrawlReminders.invalidate();
    },
    onError: error => toast.error(error.message || "無法排入分類補抓"),
  });
  const savePreset = trpc.crawler.saveCoolpcRecrawlPreset.useMutation({
    onSuccess: result => {
      toast.success(`已儲存常用清單「${result.name}」`);
      setPresetName("");
      void utils.crawler.coolpcRecrawlPresets.invalidate();
    },
    onError: error => toast.error(error.message || "無法儲存常用清單"),
  });
  const deletePreset = trpc.crawler.deleteCoolpcRecrawlPreset.useMutation({
    onSuccess: () => {
      toast.success("已刪除常用清單");
      void utils.crawler.coolpcRecrawlPresets.invalidate();
    },
    onError: error => toast.error(error.message || "無法刪除常用清單"),
  });
  const previewCoolpcRecrawlPresetImport = trpc.crawler.previewCoolpcRecrawlPresetImport.useMutation({
    onSuccess: result => {
      setImportPreview(result);
      setImportConflictStrategies(Object.fromEntries(result.items.filter(item => item.kind === "conflict").map(item => [item.name, "overwrite"] as const)));
      setImportDialogOpen(true);
    },
    onError: error => toast.error(error.message || "無法預覽常用清單備份"),
  });
  const importPresets = trpc.crawler.importCoolpcRecrawlPresets.useMutation({
    onSuccess: result => {
      toast.success(`已匯入 ${result.total} 份清單（新增 ${result.created}、更新 ${result.updated}、略過 ${result.skipped}）`);
      setImportDialogOpen(false);
      setImportPreview(null);
      setImportBackup(null);
      void utils.crawler.coolpcRecrawlPresets.invalidate();
    },
    onError: error => toast.error(error.message || "無法匯入常用清單備份"),
  });
  const applySavedPreset = trpc.crawler.applyCoolpcRecrawlPreset.useMutation({
    onSuccess: result => {
      selectPresetCategories(result.categoryNames);
      toast.success(`已套用「${result.name}」`);
      void utils.crawler.coolpcRecrawlPresetHistory.invalidate();
    },
    onError: error => toast.error(error.message || "無法套用常用清單"),
  });
  const setPresetPinned = trpc.crawler.setCoolpcRecrawlPresetPinned.useMutation({
    onSuccess: () => void utils.crawler.coolpcRecrawlPresets.invalidate(),
    onError: error => toast.error(error.message || "無法更新釘選狀態"),
  });
  const reorderPresets = trpc.crawler.reorderCoolpcRecrawlPresets.useMutation({
    onSuccess: () => void utils.crawler.coolpcRecrawlPresets.invalidate(),
    onError: error => toast.error(error.message || "無法調整常用清單排序"),
  });
  const enqueueSavedPreset = trpc.crawler.enqueueCoolpcRecrawlPreset.useMutation({
    onSuccess: result => {
      const created = result.createdCategoryNames.length;
      const existing = result.existingCategoryNames.length;
      toast.success(created ? `「${result.presetName}」已排入 ${created} 個分類${existing ? `；${existing} 個已在佇列中` : ""}` : `「${result.presetName}」的分類已在佇列或執行中`);
      void utils.crawler.coolpcRecrawlPresetHistory.invalidate();
      void utils.crawler.jobs.invalidate();
      void utils.crawler.events.invalidate();
    },
    onError: error => toast.error(error.message || "無法從常用清單排入補抓"),
  });
  const publishPresetTemplate = trpc.crawler.publishCoolpcRecrawlPresetTemplate.useMutation({
    onSuccess: result => {
      const link = `${window.location.origin}/coolpc-only?template=${result.token}`;
      void navigator.clipboard?.writeText(link);
      toast.success(`已發佈「${result.presetName}」，分享連結已複製`);
      void utils.crawler.coolpcRecrawlPresetTemplates.invalidate();
    },
    onError: error => toast.error(error.message || "無法發佈團隊範本"),
  });
  const revokePresetTemplate = trpc.crawler.revokeCoolpcRecrawlPresetTemplate.useMutation({
    onSuccess: () => { toast.success("已撤銷團隊範本分享連結"); void utils.crawler.coolpcRecrawlPresetTemplates.invalidate(); },
    onError: error => toast.error(error.message || "無法撤銷團隊範本"),
  });
  const copyTeamTemplate = trpc.crawler.copyCoolpcRecrawlPresetTemplate.useMutation({
    onSuccess: result => { toast.success(`已複製團隊範本為「${result.name}」`); void utils.crawler.coolpcRecrawlPresets.invalidate(); },
    onError: error => toast.error(error.message || "無法複製團隊範本"),
  });
  const setTemplateMode = trpc.crawler.setCoolpcRecrawlPresetTemplateMode.useMutation({
    onSuccess: result => { toast.success(`團隊範本已設為${templateModeLabel(result.collaborationMode)}`); void utils.crawler.coolpcRecrawlPresetTemplates.invalidate(); },
    onError: error => toast.error(error.message || "無法更新範本協作模式"),
  });
  const addTemplateCollaborator = trpc.crawler.addCoolpcRecrawlPresetTemplateCollaborator.useMutation({
    onSuccess: (_, variables) => {
      toast.success("已加入共同維護協作者");
      setCollaboratorEmails(current => ({ ...current, [variables.id]: "" }));
      void utils.crawler.coolpcRecrawlPresetTemplates.invalidate();
    },
    onError: error => toast.error(error.message || "無法加入協作者"),
  });
  const removeTemplateCollaborator = trpc.crawler.removeCoolpcRecrawlPresetTemplateCollaborator.useMutation({
    onSuccess: () => { toast.success("已移除協作者"); void utils.crawler.coolpcRecrawlPresetTemplates.invalidate(); },
    onError: error => toast.error(error.message || "無法移除協作者"),
  });
  const updateTeamTemplateCategories = trpc.crawler.updateCoolpcRecrawlPresetTemplateCategories.useMutation({
    onSuccess: () => { toast.success("已使用目前勾選分類更新團隊範本"); void utils.crawler.coolpcRecrawlPresetTemplates.invalidate(); },
    onError: error => toast.error(error.message || "無法更新團隊範本"),
  });
  const coverage = coverageQuery.data;
  const unlisted = unlistedQuery.data;
  const chooseCategory = (value: string) => { setCategory(value); setPage(1); };
  const sortedCategories = useMemo(() => {
    if (!coverage) return [];
    return [...coverage.categories].sort((left, right) => {
      if (categorySort === "coverage_asc") return left.coverageRate - right.coverageRate || right.sinyaUnlisted - left.sinyaUnlisted;
      if (categorySort === "coverage_desc") return right.coverageRate - left.coverageRate || right.sinyaUnlisted - left.sinyaUnlisted;
      return right.sinyaUnlisted - left.sinyaUnlisted || left.coverageRate - right.coverageRate;
    });
  }, [coverage, categorySort]);
  const visiblePresetHistory = useMemo(() => filterRecrawlPresetHistoryEntries(presetHistoryQuery.data ?? [], historyStatus), [presetHistoryQuery.data, historyStatus]);
  const dueReminders = remindersQuery.data?.filter(reminder => reminder.isDue) ?? [];
  const toggleCategory = (categoryName: string, checked: boolean) => setSelectedCategories(current => {
    const next = nextSelectedCategories(current, categoryName, checked);
    if (checked && !current.has(categoryName) && next.size === current.size) toast.info(`一次最多可排入 ${MAX_BATCH_CATEGORIES} 個分類`);
    return next;
  });
  const selectTopCategories = (checked: boolean) => setSelectedCategories(checked
    ? new Set(sortedCategories.slice(0, MAX_BATCH_CATEGORIES).map(item => item.category))
    : new Set());
  const topCategories = sortedCategories.slice(0, MAX_BATCH_CATEGORIES);
  const isTopSelected = topCategories.length > 0 && topCategories.every(item => selectedCategories.has(item.category));
  const selectPresetCategories = (categoryNames: string[]) => {
    const available = new Set(sortedCategories.map(item => item.category));
    const selected = categoryNames.filter(categoryName => available.has(categoryName)).slice(0, MAX_BATCH_CATEGORIES);
    setSelectedCategories(new Set(selected));
    const unavailableCount = categoryNames.length - selected.length;
    if (unavailableCount) toast.info(`已套用 ${selected.length} 個分類；${unavailableCount} 個已不在目前缺口清單`);
  };
  const movePreset = (sourceId: number, targetId: number) => {
    if (!presetsQuery.data || sourceId === targetId) return;
    const ids = reorderRecrawlPresetIds(presetsQuery.data.map(preset => preset.id), sourceId, targetId);
    reorderPresets.mutate(createRecrawlPresetReorderInput(ids));
  };
  const movePresetByOffset = (presetId: number, pinned: boolean, offset: -1 | 1) => {
    if (!presetsQuery.data) return;
    const groupIds = presetsQuery.data.filter(preset => preset.pinned === pinned).map(preset => preset.id);
    const reorderedGroupIds = moveRecrawlPresetId(groupIds, presetId, offset);
    if (reorderedGroupIds === groupIds) return;
    let groupIndex = 0;
    const ids = presetsQuery.data.map(preset => preset.pinned === pinned ? reorderedGroupIds[groupIndex++]! : preset.id);
    reorderPresets.mutate(createRecrawlPresetReorderInput(ids));
  };
  const downloadPresetBackup = async () => {
    const result = await presetExportQuery.refetch();
    if (!result.data) return toast.error("目前無法匯出常用清單");
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `原價屋常用補抓清單_${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(`已匯出 ${result.data.presets.length} 份常用清單`);
  };
  const importPresetBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 256 * 1024) return toast.error("備份檔案不可超過 256 KB");
    try {
      const backup = JSON.parse(await file.text());
      setImportBackup(backup);
      previewCoolpcRecrawlPresetImport.mutate({ backup });
    } catch {
      toast.error("無法讀取 JSON 備份檔案");
    }
  };
  const confirmPresetImport = () => {
    if (!importBackup) return;
    importPresets.mutate(createRecrawlPresetImportInput(importBackup, importConflictStrategies));
  };
  const copyPresetShareLink = (token: string) => {
    const link = `${window.location.origin}/coolpc-only?template=${token}`;
    void navigator.clipboard?.writeText(link);
    toast.success("團隊範本分享連結已複製");
  };
  const applyPreset = (categoryNames: string[]) => {
    const preset = presetsQuery.data?.find(item => item.categoryNames.join("\u0001") === categoryNames.join("\u0001"));
    if (preset) applySavedPreset.mutate({ id: preset.id });
    else selectPresetCategories(categoryNames);
  };
  const exportCsv = async () => {
    const result = await exportQuery.refetch();
    if (!result.data) return;
    downloadCsv(`原價屋有售_欣亞未上架_${category === "all" ? "全部分類" : category}.csv`, toCsv([
      ["原價屋分類", "商品名稱", "原價屋價格", "原價屋連結"],
      ...result.data.items.map(item => [item.category, item.name, item.price, item.url]),
    ]));
  };

  const presetManager = shouldShowRecrawlPresetManager(presetsQuery.data?.length ?? 0, presetHistoryQuery.data?.length ?? 0) ? <Card className="border-primary/25 bg-primary/3 p-4">
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
      <div><div className="flex items-center gap-2"><History className="size-4 text-primary" /><h2 className="font-semibold">常用清單管理與執行歷程</h2></div><p className="mt-1 text-xs text-muted-foreground">可拖曳、以 Alt + 上下方向鍵，或使用行動裝置按鈕調整順序；總耗時依真實分類工作紀錄估算。</p></div>
      <Badge variant="outline" className="w-fit border-primary/30 bg-primary/10 text-primary">{presetsQuery.data?.length ?? 0} 份清單</Badge>
    </div>
    {presetsQuery.data?.length ? <div className="mt-4 space-y-2">
      {presetsQuery.data.map(preset => {
        const group = presetsQuery.data.filter(item => item.pinned === preset.pinned);
        const groupIndex = group.findIndex(item => item.id === preset.id);
        const canMoveUp = groupIndex > 0;
        const canMoveDown = groupIndex >= 0 && groupIndex < group.length - 1;
        return <div
          key={preset.id}
          draggable
          tabIndex={0}
          onKeyDown={event => {
            if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
            event.preventDefault();
            movePresetByOffset(preset.id, preset.pinned, event.key === "ArrowUp" ? -1 : 1);
          }}
          onDragStart={event => { writeRecrawlPresetDragPayload(event.dataTransfer, preset.id); setDraggedPresetId(preset.id); }}
          onDragEnd={() => setDraggedPresetId(null)}
          onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
          onDrop={event => { event.preventDefault(); const sourceId = readRecrawlPresetDragPayload(event.dataTransfer) ?? draggedPresetId; if (sourceId !== null) movePreset(sourceId, preset.id); setDraggedPresetId(null); }}
          className={`flex flex-col gap-3 rounded-lg border bg-background/70 p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-row sm:items-center ${draggedPresetId === preset.id ? "border-primary/60 bg-primary/5" : "border-primary/15"}`}
        >
          <GripVertical className="hidden size-5 shrink-0 cursor-grab text-muted-foreground sm:block" aria-label={`拖曳排序：${preset.name}`} />
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-medium">{preset.name}</p>{preset.pinned ? <Badge className="gap-1 bg-primary/15 text-primary hover:bg-primary/15"><Pin className="size-3" />已釘選</Badge> : null}</div><p className="mt-1 text-xs text-muted-foreground">{preset.categoryNames.length} 個分類 · {presetEstimateLabel(preset.estimateMs, preset.estimateSampleSize)}</p></div>
          <div className="flex flex-wrap gap-1.5"><Button size="sm" variant="outline" onClick={() => applySavedPreset.mutate({ id: preset.id })} disabled={applySavedPreset.isPending}><ListChecks className="mr-1.5 size-3.5" />套用</Button><Button size="sm" onClick={() => enqueueSavedPreset.mutate({ id: preset.id })} disabled={enqueueSavedPreset.isPending}><Play className="mr-1.5 size-3.5" />直接排入</Button><Button size="sm" variant="ghost" onClick={() => publishPresetTemplate.mutate({ id: preset.id })} disabled={publishPresetTemplate.isPending}><Share2 className="mr-1 size-3.5" />分享</Button><Button size="icon" variant="ghost" className="size-8" onClick={() => movePresetByOffset(preset.id, preset.pinned, -1)} disabled={!canMoveUp || reorderPresets.isPending} aria-label={`上移常用清單：${preset.name}`}><ChevronUp className="size-3.5" /></Button><Button size="icon" variant="ghost" className="size-8" onClick={() => movePresetByOffset(preset.id, preset.pinned, 1)} disabled={!canMoveDown || reorderPresets.isPending} aria-label={`下移常用清單：${preset.name}`}><ChevronDown className="size-3.5" /></Button><Button size="icon" variant="ghost" className="size-8" onClick={() => setPresetPinned.mutate({ id: preset.id, pinned: !preset.pinned })} disabled={setPresetPinned.isPending} aria-label={preset.pinned ? `取消釘選：${preset.name}` : `釘選：${preset.name}`}>{preset.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}</Button><Button size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" onClick={() => deletePreset.mutate({ id: preset.id })} disabled={deletePreset.isPending} aria-label={`刪除常用清單：${preset.name}`}><Trash2 className="size-3.5" /></Button></div>
        </div>;
      })}
    </div> : <p className="mt-4 text-xs text-muted-foreground">目前沒有可管理的常用清單；下方仍保留過去的套用與補抓歷程。</p>}
    <div className="mt-4 border-t border-border pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><History className="size-3.5 text-primary" /><h3 className="text-sm font-medium">最近套用與補抓執行紀錄</h3></div><Select value={historyStatus} onValueChange={value => setHistoryStatus(value as typeof historyStatus)}><SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部狀態</SelectItem><SelectItem value="success">成功</SelectItem><SelectItem value="failed">失敗</SelectItem><SelectItem value="running">執行中</SelectItem></SelectContent></Select></div>{presetHistoryQuery.isLoading ? <Skeleton className="mt-3 h-14 w-full" /> : visiblePresetHistory.length ? <div className="mt-3 space-y-2">{visiblePresetHistory.map(entry => <div className="rounded-md border border-border/70 bg-background/60 px-3 py-2 text-xs" key={entry.id}><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-medium">{entry.presetName}</span><Badge variant="outline">{entry.action === "applied" ? "已套用" : "已排入補抓"}</Badge><span className="text-muted-foreground">{entry.categoryNames.length} 個分類 · {new Date(entry.createdAt).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></div>{entry.jobs.length ? <><div className="mt-1 flex flex-wrap gap-1">{entry.jobs.map(job => <Badge className="bg-muted text-muted-foreground hover:bg-muted" key={job.id}>#{job.id} {job.categoryName ?? "分類"} · {jobStatusLabel(job.status)}</Badge>)}</div><p className="mt-1 text-muted-foreground">{entry.execution.completedCount}/{entry.execution.total} 已完成 · {completionRateLabel(entry.execution.completionRate)}{entry.execution.durationMs !== null ? ` · 耗時 ${durationLabel(entry.execution.durationMs)}` : ""}{entry.execution.failedCount ? ` · ${entry.execution.failedCount} 個失敗` : ""}</p>{entry.execution.failures.length ? <p className="mt-1 text-destructive">失敗摘要：{entry.execution.failures.map(failure => `${failure.categoryName}：${failure.message}`).join("；")}</p> : null}</> : <p className="mt-1 text-muted-foreground">{entry.categoryNames.join("、")}</p>}</div>)}</div> : <p className="mt-3 text-xs text-muted-foreground">此篩選條件下尚無套用或補抓歷程。</p>}</div>
    {teamTemplatesQuery.data?.length ? <div className="mt-4 border-t border-border pt-4"><div className="flex items-center gap-2"><Share2 className="size-3.5 text-primary" /><h3 className="text-sm font-medium">團隊範本</h3></div><p className="mt-1 text-xs text-muted-foreground">範本只包含名稱與分類選取；複製後會成為自己的獨立清單。</p><div className="mt-3 space-y-2">{teamTemplatesQuery.data.map(template => <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-background/60 px-3 py-2 text-xs" key={template.id}><div className="min-w-0"><p className="font-medium">{template.name} · {template.categoryNames.length} 個分類</p><p className="mt-1 text-muted-foreground">擁有者：{template.ownerName} · {templateUpdatedLabel(template.updatedAt)} · {presetEstimateLabel(template.estimateMs, template.estimateSampleSize)}</p></div>{template.canRevoke ? <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => copyPresetShareLink(template.token)}><Link className="mr-1 size-3.5" />複製連結</Button><Button size="sm" variant="ghost" className="text-destructive" onClick={() => revokePresetTemplate.mutate({ id: template.id })}>撤銷</Button></div> : <Button size="sm" variant="outline" onClick={() => copyTeamTemplate.mutate({ token: template.token })}><Copy className="mr-1 size-3.5" />複製為我的清單</Button>}</div>)}</div></div> : null}
    {teamTemplatesQuery.data?.length ? <div className="mt-4 border-t border-border pt-4"><div className="flex items-center gap-2"><Users className="size-3.5 text-primary" /><h3 className="text-sm font-medium">範本詳細與協作</h3></div><p className="mt-1 text-xs text-muted-foreground">只讀範本可複製；共同維護範本的具名協作者可用目前勾選分類更新來源範本。</p><div className="mt-3 space-y-3">{teamTemplatesQuery.data.map(template => <div className="rounded-lg border border-border/70 bg-background/60 p-3 text-xs" key={`collaboration-${template.id}`}><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{template.name}</p><Badge variant="outline" className={template.collaborationMode === "collaborative" ? "border-emerald-500/40 text-emerald-600" : "border-muted-foreground/30 text-muted-foreground"}>{template.collaborationMode === "collaborative" ? <Unlock className="mr-1 size-3" /> : <Lock className="mr-1 size-3" />}{templateModeLabel(template.collaborationMode)}</Badge></div><p className="mt-1 text-muted-foreground">擁有者：{template.ownerName} · {template.categoryNames.length} 個分類 · {presetEstimateLabel(template.estimateMs, template.estimateSampleSize)}</p><p className="mt-1 text-muted-foreground">{templateUpdatedLabel(template.updatedAt)}</p></div>{(template.isOwner || template.canCollaborate) ? <Button size="sm" variant="outline" onClick={() => updateTeamTemplateCategories.mutate({ id: template.id, categoryNames: Array.from(selectedCategories) })} disabled={!selectedCategories.size || updateTeamTemplateCategories.isPending}><Save className="mr-1.5 size-3.5" />以目前勾選更新</Button> : null}</div>{template.isOwner ? <div className="mt-3 space-y-2 border-t border-border/60 pt-3"><div className="flex flex-wrap items-center gap-2"><Select value={template.collaborationMode} onValueChange={value => setTemplateMode.mutate({ id: template.id, collaborationMode: value as "read_only" | "collaborative" })}><SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="read_only">只讀</SelectItem><SelectItem value="collaborative">共同維護</SelectItem></SelectContent></Select><Input className="h-8 w-56 text-xs" placeholder="協作者電子郵件" type="email" value={collaboratorEmails[template.id] ?? ""} onChange={event => setCollaboratorEmails(current => ({ ...current, [template.id]: event.target.value }))} /><Button size="sm" variant="outline" onClick={() => addTemplateCollaborator.mutate({ id: template.id, email: collaboratorEmails[template.id] ?? "" })} disabled={!collaboratorEmails[template.id]?.trim() || addTemplateCollaborator.isPending}><UserPlus className="mr-1 size-3.5" />加入協作者</Button></div>{template.collaborators.length ? <div className="flex flex-wrap gap-1.5">{template.collaborators.map(collaborator => <Badge variant="secondary" className="gap-1" key={collaborator.userId}>{collaborator.name || collaborator.email || `使用者 ${collaborator.userId}`}<button aria-label={`移除協作者：${collaborator.email || collaborator.userId}`} className="ml-0.5 rounded-sm hover:text-destructive" onClick={() => removeTemplateCollaborator.mutate({ id: template.id, collaboratorUserId: collaborator.userId })}><X className="size-3" /></button></Badge>)}</div> : <p className="text-muted-foreground">尚未加入協作者；共同維護模式目前僅由擁有者可更新。</p>}</div> : template.canCollaborate ? <p className="mt-2 text-emerald-600">你具共同維護權限，可用目前勾選分類更新此範本。</p> : <p className="mt-2 text-muted-foreground">此範本為 {templateModeLabel(template.collaborationMode)}，可複製但不可直接修改。</p>}</div>)}</div></div> : null}
  </Card> : null;

  const importDialog = <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>匯入差異預覽</DialogTitle><DialogDescription>檢查備份與目前清單的差異，對同名但內容不同的清單選擇處理方式。</DialogDescription></DialogHeader>{importPreview ? <div className="space-y-3"><div className="flex flex-wrap gap-2 text-xs"><Badge variant="outline">新增 {importPreview.counts.new}</Badge><Badge variant="outline">衝突 {importPreview.counts.conflict}</Badge><Badge variant="outline">相同 {importPreview.counts.unchanged}</Badge></div><div className="max-h-72 space-y-2 overflow-y-auto pr-1">{importPreview.items.map(item => <div className="rounded-md border p-3 text-sm" key={item.name}><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.categoryNames.length} 個分類 · {item.kind === "new" ? "新增" : item.kind === "unchanged" ? "內容相同" : "同名衝突"}</p></div>{item.kind === "conflict" ? <Select value={importConflictStrategies[item.name] ?? "overwrite"} onValueChange={value => setImportConflictStrategies(current => ({ ...current, [item.name]: value as "overwrite" | "skip" | "copy" }))}><SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="overwrite">覆寫目前清單</SelectItem><SelectItem value="skip">略過此清單</SelectItem><SelectItem value="copy">複製建立</SelectItem></SelectContent></Select> : null}</div></div>)}</div></div> : null}<DialogFooter><Button variant="outline" onClick={() => setImportDialogOpen(false)}>取消</Button><Button onClick={confirmPresetImport} disabled={!importPreview || importPresets.isPending}>{importPresets.isPending ? "匯入中…" : "確認匯入"}</Button></DialogFooter></DialogContent></Dialog>;
  const receivedTemplate = sharedTemplateToken && sharedTemplateQuery.data ? <Card className="border-primary/30 bg-primary/5 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">收到團隊範本：{sharedTemplateQuery.data.name}</p><p className="mt-1 text-xs text-muted-foreground">擁有者：{sharedTemplateQuery.data.ownerName} · {templateUpdatedLabel(sharedTemplateQuery.data.updatedAt)}</p><p className="mt-1 text-xs text-muted-foreground">包含 {sharedTemplateQuery.data.categoryNames.length} 個分類 · {presetEstimateLabel(sharedTemplateQuery.data.estimateMs, sharedTemplateQuery.data.estimateSampleSize)}；複製後將成為你的獨立常用清單。</p></div><Button onClick={() => copyTeamTemplate.mutate({ token: sharedTemplateToken })} disabled={copyTeamTemplate.isPending}><Copy className="mr-2 size-4" />複製為我的清單</Button></div></Card> : null;

  return <DashboardLayout><div className="mx-auto w-full max-w-7xl space-y-6">{importDialog}{receivedTemplate}{presetManager}
    <section className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-start lg:justify-between"><div className="space-y-1"><div className="flex items-center gap-2 text-primary"><Store className="size-4" /><span className="text-sm font-medium">平台缺口</span></div><h1 className="text-2xl font-bold tracking-tight">原價屋有售、欣亞未上架商品</h1><p className="max-w-3xl text-sm text-muted-foreground">以最新完成爬蟲批次為準；只有已通過保守配對規則的原價屋－欣亞商品才視為「欣亞已上架」，其餘原價屋品項會列入下方缺口清單。</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void exportCsv()} disabled={exportQuery.isFetching || !coverage}><Download className="mr-2 size-4" />匯出 CSV</Button><Button variant="outline" onClick={() => { void coverageQuery.refetch(); void unlistedQuery.refetch(); }} disabled={coverageQuery.isFetching || unlistedQuery.isFetching}><RefreshCw className={`mr-2 size-4 ${coverageQuery.isFetching || unlistedQuery.isFetching ? "animate-spin" : ""}`} />重新整理清單</Button></div></section>
    {coverageQuery.isLoading ? <div className="grid gap-3 sm:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-28" />)}</div> : coverageQuery.isError || !coverage ? <Card className="p-10 text-center"><PackageX className="mx-auto mb-3 size-7 text-muted-foreground" /><h2 className="font-semibold">目前無法讀取原價屋缺口</h2><p className="mt-1 text-sm text-muted-foreground">請確認已有完成的爬蟲批次後再試。</p><Button className="mt-4" variant="outline" onClick={() => void coverageQuery.refetch()}>重新嘗試</Button></Card> : <>
      <div className="grid gap-3 sm:grid-cols-3"><Card className="p-4"><p className="text-xs text-muted-foreground">原價屋商品總數</p><p className="mt-1 text-3xl font-bold text-primary">{coverage.coolpcTotal.toLocaleString()} 件</p><p className="mt-1 text-xs text-muted-foreground">以原價屋為分析分母</p></Card><Card className="p-4"><p className="text-xs text-muted-foreground">欣亞已確認上架</p><p className="mt-1 text-3xl font-bold text-emerald-500">{coverage.sinyaListed.toLocaleString()} 件</p><p className="mt-1 text-xs text-muted-foreground">通過原價屋－欣亞配對</p></Card><Card className="p-4"><p className="text-xs text-muted-foreground">原價屋有售、欣亞未上架</p><p className="mt-1 text-3xl font-bold text-amber-500">{coverage.sinyaUnlisted.toLocaleString()} 件</p><p className="mt-1 text-xs text-muted-foreground">欣亞相對原價屋的缺口</p></Card></div>
      {dueReminders.length > 0 ? <Card className="border-primary/30 bg-primary/5 p-4"><div className="flex items-start gap-3"><BellRing className="mt-0.5 size-5 shrink-0 text-primary" /><div className="min-w-0 flex-1"><h2 className="font-semibold">指定分類已有新一輪更新</h2><p className="mt-1 text-sm text-muted-foreground">以下分類仍有欣亞缺口，可依需要手動補抓，不會自動建立爬蟲工作。</p><div className="mt-3 space-y-2">{dueReminders.map(reminder => <div className="rounded-lg border border-primary/20 bg-background/80 p-3" key={reminder.id}><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium">{reminder.categoryName} <span className="font-normal text-muted-foreground">· {reminder.sinyaUnlisted.toLocaleString()} 件欣亞缺口</span></p><RecrawlReminderSummary reminder={reminder} /></div><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => enqueueRecrawl.mutate({ scope: "category", categoryName: reminder.categoryName })} disabled={enqueueRecrawl.isPending}><RefreshCw className="mr-1.5 size-3.5" />手動補抓</Button><Button size="sm" variant="ghost" onClick={() => acknowledgeReminder.mutate({ id: reminder.id })}>稍後處理</Button><Button size="sm" variant="ghost" onClick={() => setReminderActive.mutate({ id: reminder.id, active: false })}>停止提醒</Button></div></div></div>)}</div></div></div></Card> : null}
      <Card className="border-primary/20 bg-primary/3 p-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex items-center gap-2"><ListChecks className="size-4 text-primary" /><h2 className="font-semibold">常用補抓清單</h2></div><p className="mt-1 text-xs text-muted-foreground">將目前勾選的分類命名儲存，之後可一鍵套用；備份僅包含清單名稱、分類、排序與釘選狀態，不包含工作歷程。</p></div><div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto"><Input aria-label="常用清單名稱" className="sm:w-56" value={presetName} onChange={event => setPresetName(event.target.value)} maxLength={64} placeholder="例如：週末高缺口補抓" /><Button onClick={() => savePreset.mutate(createRecrawlPresetInput(presetName, selectedCategories))} disabled={!presetName.trim() || !selectedCategories.size || savePreset.isPending}>{savePreset.isPending ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <BookmarkPlus className="mr-2 size-4" />}儲存目前勾選</Button></div></div><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void downloadPresetBackup()} disabled={presetExportQuery.isFetching}><Download className="mr-1.5 size-3.5" />匯出清單</Button><Button size="sm" variant="outline" onClick={() => importPresetInputRef.current?.click()} disabled={importPresets.isPending}><Upload className="mr-1.5 size-3.5" />匯入清單</Button><input ref={importPresetInputRef} className="hidden" type="file" accept="application/json,.json" onChange={event => void importPresetBackup(event)} /></div>{presetsQuery.isLoading ? <Skeleton className="mt-4 h-10 w-full" /> : presetsQuery.data?.length ? <div className="mt-4 flex flex-wrap gap-2">{presetsQuery.data.map(preset => <div className="flex max-w-full items-center gap-1 rounded-lg border border-primary/20 bg-background/70 p-1" key={preset.id}><Button size="sm" variant="ghost" className="max-w-[20rem] justify-start" onClick={() => applyPreset(preset.categoryNames)}><ListChecks className="mr-1.5 size-3.5 shrink-0 text-primary" /><span className="truncate">{preset.name}（{preset.categoryNames.length}）</span></Button><Button size="icon" variant="ghost" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => deletePreset.mutate({ id: preset.id })} disabled={deletePreset.isPending} aria-label={`刪除常用清單：${preset.name}`}><Trash2 className="size-3.5" /></Button></div>)}</div> : <p className="mt-4 text-sm text-muted-foreground">尚未儲存常用清單。先勾選分類並輸入名稱，即可快速重用。</p>}</Card>
      <Card className="overflow-hidden"><div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-start lg:justify-between"><div><h2 className="font-semibold">各原價屋分類的欣亞上架率</h2><p className="mt-1 text-xs text-muted-foreground">可依缺口或上架率排序；可勾選最多 {MAX_BATCH_CATEGORIES} 個分類，分別排入持續執行器，並維持單一分類的工作紀錄。</p></div><div className="flex flex-col gap-2 sm:flex-row"><Select value={categorySort} onValueChange={value => setCategorySort(value as typeof categorySort)}><SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="gap_desc">缺口數量：高到低</SelectItem><SelectItem value="coverage_asc">欣亞上架率：低到高</SelectItem><SelectItem value="coverage_desc">欣亞上架率：高到低</SelectItem></SelectContent></Select><Button onClick={() => enqueueCategories.mutate(createBatchCategoryRequest(selectedCategories))} disabled={!selectedCategories.size || enqueueCategories.isPending}>{enqueueCategories.isPending ? <RefreshCw className="mr-2 size-4 animate-spin" /> : <ListPlus className="mr-2 size-4" />}分批排入（{selectedCategories.size}）</Button></div></div><div className="overflow-x-auto"><table className="w-full min-w-[880px] text-sm"><thead className="bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="w-12 px-4 py-3 text-center font-medium"><Checkbox aria-label={`全選前 ${MAX_BATCH_CATEGORIES} 個分類`} checked={isTopSelected} onCheckedChange={checked => selectTopCategories(Boolean(checked))} /></th><th className="px-4 py-3 font-medium">原價屋分類</th><th className="px-4 py-3 text-right font-medium">原價屋商品</th><th className="px-4 py-3 text-right font-medium">欣亞已上架</th><th className="px-4 py-3 min-w-56 font-medium">欣亞上架率</th><th className="px-4 py-3 text-right font-medium">欣亞未上架</th><th className="px-4 py-3 text-right font-medium">補抓提醒</th></tr></thead><tbody className="divide-y divide-border">{sortedCategories.map(item => { const reminder = remindersQuery.data?.find(saved => saved.categoryName === item.category); const isLow = item.coverageRate < 0.5; const selected = selectedCategories.has(item.category); const selectionDisabled = !selected && selectedCategories.size >= MAX_BATCH_CATEGORIES; return <tr className={category === item.category ? "bg-primary/5" : ""} key={item.category}><td className="px-4 py-3 text-center"><Checkbox aria-label={`選擇 ${item.category}`} checked={selected} disabled={selectionDisabled} onCheckedChange={checked => toggleCategory(item.category, Boolean(checked))} /></td><td className="px-4 py-3 font-medium">{item.category}</td><td className="px-4 py-3 text-right tabular-nums">{item.coolpcTotal.toLocaleString()}</td><td className="px-4 py-3 text-right tabular-nums text-emerald-500">{item.sinyaListed.toLocaleString()}</td><td className="px-4 py-3"><div className="flex items-center gap-3"><div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${isLow ? "bg-red-500" : "bg-primary"}`} style={{ width: `${Math.max(0, Math.min(100, item.coverageRate * 100))}%` }} /></div><span className={`w-12 text-right tabular-nums ${isLow ? "font-semibold text-red-600" : ""}`}>{percent(item.coverageRate)}</span></div></td><td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" className="h-8 text-amber-600 hover:text-amber-500" onClick={() => chooseCategory(item.category)}>{item.sinyaUnlisted.toLocaleString()} 件 <ChevronRight className="ml-1 size-3.5" /></Button></td><td className="px-4 py-3 text-right">{reminder ? <Button size="sm" variant="ghost" className="h-8 text-primary" onClick={() => setReminderActive.mutate({ id: reminder.id, active: false })}><BellRing className="mr-1 size-3.5" />已設定</Button> : <Button size="sm" variant="ghost" className="h-8" onClick={() => saveReminder.mutate({ categoryName: item.category })}><Bell className="mr-1 size-3.5" />提醒</Button>}</td></tr>})}</tbody></table></div></Card>
      <Card className="overflow-hidden"><div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><h2 className="font-semibold">原價屋有售、欣亞未上架商品</h2><Badge variant="outline" className="border-amber-400/40 bg-amber-500/10 text-amber-600">欣亞缺口</Badge></div><p className="mt-1 text-xs text-muted-foreground">{unlisted ? `共 ${unlisted.total.toLocaleString()} 件` : "讀取中"}；每筆皆可直接開啟原價屋商品頁。</p></div><Select value={category} onValueChange={chooseCategory}><SelectTrigger className="w-full sm:w-72"><SelectValue placeholder="篩選原價屋分類" /></SelectTrigger><SelectContent><SelectItem value="all">全部原價屋分類</SelectItem>{sortedCategories.map(item => <SelectItem key={item.category} value={item.category}>{item.category}（{item.sinyaUnlisted.toLocaleString()}）</SelectItem>)}</SelectContent></Select></div>{unlistedQuery.isLoading ? <div className="space-y-3 p-4">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}</div> : unlistedQuery.isError ? <div className="p-10 text-center"><PackageX className="mx-auto mb-3 size-6 text-destructive" /><p className="font-medium">無法載入欣亞未上架清單</p><Button className="mt-4" size="sm" variant="outline" onClick={() => void unlistedQuery.refetch()}>重新嘗試</Button></div> : !unlisted || unlisted.items.length === 0 ? <p className="p-10 text-center text-sm text-muted-foreground">此分類目前沒有欣亞未上架品項。</p> : <div className="divide-y divide-border">{unlisted.items.map(item => <div className="flex items-center gap-3 p-4" key={item.externalId}><div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">{item.image ? <img src={item.image} alt="" className="size-full object-cover" /> : <PackageX className="size-4 text-muted-foreground" />}</div><div className="min-w-0 flex-1"><p className="truncate font-medium" title={item.name}>{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{item.category} · 原價屋價格 {price(item.price)}</p></div><Badge variant="outline" className="shrink-0 border-amber-400/40 bg-amber-500/10 text-amber-600">欣亞未上架</Badge>{item.url ? <Button size="icon" variant="ghost" className="size-8 shrink-0" asChild><a href={item.url} target="_blank" rel="noreferrer" aria-label={`開啟原價屋商品：${item.name}`}><ExternalLink className="size-4" /></a></Button> : null}</div>)}</div>}{unlisted && unlisted.totalPages > 1 ? <div className="flex items-center justify-between border-t border-border p-3"><span className="text-xs text-muted-foreground">第 {unlisted.page} / {unlisted.totalPages} 頁</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={unlisted.page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}><ChevronLeft className="mr-1 size-3.5" />上一頁</Button><Button size="sm" variant="outline" disabled={unlisted.page >= unlisted.totalPages} onClick={() => setPage(current => Math.min(unlisted.totalPages, current + 1))}>下一頁<ChevronRight className="ml-1 size-3.5" /></Button></div></div> : null}</Card>
      <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />本清單採用保守配對：欣亞未上架表示目前沒有取得確認對應，不宣稱欣亞絕對沒有相近商品。</p>
    </>}
  </div></DashboardLayout>;
}
