// ===== src/App.jsx — 修正版本
import React, { useEffect, useMemo, useState } from "react";
import {
  normalizeName,
  getSettings, setSettings as setSettingsCloud,
  listEntries, saveEntry as saveEntryCloud, deleteEntry as deleteEntryCloud,
  healthCheck
} from "./firebase";

// ----- Simple ID Generator (Placeholder for UUID) -----
function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

// ----- Date Helpers -----
function todayISO() {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tzOffset * 60000);
  return local.toISOString().slice(0, 10);
}
function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const tzOffset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tzOffset * 60000);
  return local.toISOString().slice(0, 10);
}
function startOfWeek(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Mon=0..Sun=6
  const res = new Date(date);
  res.setDate(date.getDate() - day);
  res.setHours(0, 0, 0, 0);
  return res;
}
function endOfWeek(d) {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return e;
}
function weekKey(d) {
  const s = startOfWeek(d);
  return s.toISOString().slice(0, 10);
}
function monthKey(d) {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function parseISO(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ----- Lightweight AI Suggestion -----
function aiSuggest(text) {
  const t = (text || "").toLowerCase();
  const rules = [
    { k: ["procrast", "delay", "拖延"], s: "把待辦拆成 10 分鐘小步驟，先做第一步。" },
    { k: ["sleep", "熬夜", "晚睡"], s: "今晚設鬧鐘提早 30 分鐘收尾，固定就寢時段。" },
    { k: ["exercise", "運動", "健身", "跑步"], s: "明天安排 20 分鐘輕運動，時間點先寫進行事曆。" },
    { k: ["communicat", "溝通", "衝突", "誤會"], s: "先用我訊息開頭，描述事實＋感受＋需求，降低對立。" },
    { k: ["focus", "專注", "分心"], s: "用 25/5 番茄鐘，關閉通知，單次只做一件事。" },
  ];
  for (const r of rules) if (r.k.some((kw) => t.includes(kw))) return r.s;
  if (t.length < 10) return "把想改善的點寫具體一點（行為＋情境＋下一步）。";
  return "明確化下一步：什麼時候、在哪裡、做 10 分鐘的第一步。";
}

// ----- UI atoms -----
const Stat = ({ label, value, sub }) => (
  <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200">
    <div className="text-sm text-gray-500">{label}</div>
    <div className="text-2xl font-semibold">{value}</div>
    {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
  </div>
);

// 歷史紀錄每頁顯示數量
const HISTORY_LIMIT = 5;

export default function App() {
  // 使用者
  const [currentName, setCurrentName] = useState(() => {
    try { return localStorage.getItem("mvp.currentName.v2") || ""; } catch { return ""; }
  });
  const [rawName, setRawName] = useState("");
  useEffect(() => setRawName(currentName || ""), [currentName]);

  // 雲端資料
  const [entries, setEntries] = useState([]);
  const [settings, setSettingsLocal] = useState({ savingsRatio: 0 });
  const [cloudOK, setCloudOK] = useState(null);
  const [loading, setLoading] = useState(false);
  
  // 歷史紀錄分頁狀態
  const [historyOffset, setHistoryOffset] = useState(0);

  // 新：可客製化的習慣清單
  const [customHabits, setCustomHabits] = useState([]); // [{id: '...', label: '...'}, ...]
  const [newHabitInput, setNewHabitInput] = useState(""); // 暫存新增習慣的輸入框用
  
  // 新：當前日期下，每個習慣的完成狀態 {habitId: boolean, ...}
  const [dailyHabitStatus, setDailyHabitStatus] = useState({}); 

  // 單一輸入框的狀態
  const today = todayISO();
  const yesterday = yesterdayISO();
  const [targetDate, setTargetDate] = useState(today);
  const [improve, setImprove] = useState("");
  const [gratitude, setGratitude] = useState("");

  // Helper: 根據習慣 ID 取得標籤
  const getHabitLabelById = useMemo(() => {
    const map = new Map();
    customHabits.forEach(h => map.set(h.id, h.label));
    return (id) => map.get(id) || `[未知習慣: ${id}]`;
  }, [customHabits]);

  // 初次載入
  async function loadFromCloud(username) {
    setLoading(true);
    try {
      const h = await healthCheck(username);
      setCloudOK(!!h.ok);
      const e = await listEntries(username, { limitRows: 365, order: "desc" });
      const s = await getSettings(username);
      setEntries(Array.isArray(e) ? e : []);
      setSettingsLocal(typeof s === "object" && s ? s : { savingsRatio: 0 });
    } catch (err) {
      console.error("Cloud load failed:", err);
      setCloudOK(false);
      setEntries([]);
      setSettingsLocal({ savingsRatio: 0 });
      alert("雲端讀取失敗，請檢查 Firebase 設定或規則。");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (currentName) loadFromCloud(currentName); }, [currentName]);

  // 1. 當 settings 從雲端載入時，取出 habits
  useEffect(() => {
    if (settings && typeof settings === 'object') {
      const initialHabits = Array.isArray(settings.habits) && settings.habits.length > 0
        ? settings.habits
        // 遷移/首次使用者：如果 settings.habitLabel 存在，則建立一個預設習慣
        : settings.habitLabel 
            ? [{ id: 'default', label: settings.habitLabel }]
            : [{ id: 'default', label: "記帳" }];
      
      setCustomHabits(initialHabits);
    }
  }, [settings]);

  // 2. 依 targetDate 帶出該日已存內容
  useEffect(() => {
    const exist = entries.find((e) => e.date === targetDate);
    const newStatus = {};
    
    if (exist) {
      setImprove(exist.improve || "");
      setGratitude((exist.gratitude || []).join("\n"));

      // NEW: 載入 habitsCompleted 狀態
      const completedIds = Array.isArray(exist.habitsCompleted) ? exist.habitsCompleted : [];
      completedIds.forEach(id => { newStatus[id] = true; });
      
      // OLD MIGRATION: 處理舊的 bookkeeping: true 格式
      if (exist.bookkeeping && completedIds.length === 0) {
        // 如果有舊的 bookkeeping 欄位且沒有新的 habitsCompleted，則將第一個習慣標記為完成
        if (customHabits.length > 0) {
            newStatus[customHabits[0].id] = true;
        }
      }
    } else {
      setImprove("");
      setGratitude("");
    }
    setDailyHabitStatus(newStatus);
  }, [targetDate, entries, customHabits]);

  // 更新 settings 並儲存到雲端
  const onChangeSettings = async (nextRatio) => {
    try {
      const next = { ...settings, savingsRatio: Number(nextRatio) };
      await setSettingsCloud(currentName, next);
      setSettingsLocal(next);
    } catch (e) {
      console.error(e);
      alert("設定儲存失敗。");
    }
  };

  // 新增習慣
  const onAddHabit = async () => {
    const trimmed = (newHabitInput || "").trim();
    if (!trimmed) { alert('請輸入要追蹤的習慣名稱。'); return; }
    
    const newHabit = { id: generateId(), label: trimmed };
    const nextHabits = [...customHabits, newHabit];
    
    try {
      const nextSettings = { ...settings, habits: nextHabits };
      // 🚩 修正：在傳送前刪除這個欄位，因為 Firestore 不能儲存 undefined
      if (nextSettings.habitLabel !== undefined) {
          delete nextSettings.habitLabel;
      }
      // 注意：您可能還需要處理 setSettingsLocal 的狀態，確保它也清除了 habitLabel
      // 為了確保本地狀態同步，如果您的 setSettingsCloud 函式是使用 SET 覆蓋，
      // 則上面這個刪除是足夠的。
      await setSettingsCloud(currentName, nextSettings);
      setCustomHabits(nextHabits);
      setSettingsLocal(nextSettings);
      setNewHabitInput("");
    } catch (e) {
      console.error(e);
      alert('新增失敗，請稍後重試。');
    }
  };

  // 刪除習慣
  const onDeleteHabit = async (id, label) => {
    if (!confirm(`確定要刪除習慣目標：「${label}」嗎？刪除不會影響已存的歷史紀錄。`)) return;
    
    const nextHabits = customHabits.filter(h => h.id !== id);
    
    try {
      const nextSettings = { ...settings, habits: nextHabits };
      await setSettingsCloud(currentName, nextSettings);
      setCustomHabits(nextHabits);
      setSettingsLocal(nextSettings);
      
      // 移除當日狀態
      setDailyHabitStatus(prev => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
    } catch (e) {
      console.error(e);
      alert('刪除失敗，請稍後重試。');
    }
  };


  // =================================================================
  // 🚩 修正：補回統計數據所需的計算邏輯 (此處為導致介面空白的錯誤點)
  // =================================================================
  const now = useMemo(() => new Date(), []);
  const currentWeekKey = useMemo(() => weekKey(now), [now]);
  const currentMonthKey = useMemo(() => monthKey(now), [now]);
  
  const thisMonthEntries = useMemo(() => {
    return entries.filter((e) => monthKey(parseISO(e.date)) === currentMonthKey);
  }, [entries, currentMonthKey]);
  
  const thisWeekEntries = useMemo(() => {
    return entries.filter((e) => weekKey(parseISO(e.date)) === currentWeekKey);
  }, [entries, currentWeekKey]);
  
  // 檢查一筆 Entry 是否為「記帳日」
  const isBookkeepingDay = (e) => (e.habitsCompleted && e.habitsCompleted.length > 0) || e.bookkeeping;

  const thisMonthWeeksStatus = useMemo(() => {
    const weeks = new Map();
    thisMonthEntries.forEach((e) => {
        if (isBookkeepingDay(e)) {
            const wk = weekKey(parseISO(e.date));
            weeks.set(wk, (weeks.get(wk) || 0) + 1);
        }
    });
    return Array.from(weeks.entries()).map(([key, count]) => ({
      key,
      count,
      met: count >= 3,
    }));
  }, [thisMonthEntries]);
  
  const thisWeekMet = useMemo(() => {
    const currentWeekCount = thisWeekEntries.filter(isBookkeepingDay).length;
    return currentWeekCount >= 3;
  }, [thisWeekEntries]);

  // 統計：定義『記帳日』= 當天有完成任一習慣
  const bookkeepingDaysThisMonth = useMemo(() => {
    // 現在 thisMonthEntries 已定義
    return thisMonthEntries.filter(isBookkeepingDay).length; 
  }, [thisMonthEntries]);
  // =================================================================


  const weeklyRewardBase = 10;
  const pointsDerived = useMemo(() => {
    const rewards = new Map();
    const weeks = new Map();
    
    entries.forEach((e) => {
      // 檢查是否為『記帳日』 (完成任一習慣或舊的 bookkeeping: true)
      if (isBookkeepingDay(e)) {
        const wk = weekKey(parseISO(e.date));
        weeks.set(wk, (weeks.get(wk) || 0) + 1);
      }
    });
    
    weeks.forEach((count) => {
      if (count >= 3) rewards.set("x", (rewards.get("x") || 0) + weeklyRewardBase);
    });
    let total = 0; rewards.forEach((v) => (total += v));
    return { total };
  }, [entries]);

  const savingsRatio = settings.savingsRatio;
  const bookkeepingBoost = bookkeepingDaysThisMonth >= 12;
  const monthlyGainPct =
    savingsRatio === 0.5 ? 0.03 :
    savingsRatio === 0.25 ? (bookkeepingBoost ? 0.04 : 0.01) :
    0.0;
  const projectedMonthEnd = Math.round(pointsDerived.total * (1 + monthlyGainPct));


  // 事件處理
  const onSave = async () => {
    const gList = (gratitude || "").split(/[\\n,]/).map((s) => s.trim()).filter(Boolean);
    if (!improve || improve.trim().length < 3) { alert("請寫下至少 1 條具體的改進/做錯事項（≥3 字）。"); return; }
    if (gList.length < 1) { alert("請至少寫下一件感恩的事。"); return; }
    
    // NEW: 取得所有已完成的習慣 ID
    const completedHabitIds = Object.keys(dailyHabitStatus).filter(id => dailyHabitStatus[id]);

    const payload = { 
      date: targetDate, 
      improve: improve.trim(), 
      gratitude: gList, 
      habitsCompleted: completedHabitIds,
      // 保持舊的 habitLabel 欄位以供舊紀錄顯示相容，但新紀錄不傳入或設為 undefined
    };
    try {
      await saveEntryCloud(currentName, payload);
      setEntries((prev) => {
        const exists = prev.some((e) => e.date === targetDate);
        if (exists) return prev.map((e) => (e.date === targetDate ? payload : e));
        return [payload, ...prev.filter((e) => e.date !== targetDate)];
      });
      setHistoryOffset(0); 
      setTimeout(() => alert(`AI 建議：${aiSuggest(improve)}`), 30);
    } catch (e) {
      console.error(e);
      alert("雲端寫入失敗，請檢查 Firebase 規則或設定。");
    }
  };

  const removeEntry = async () => {
    if (!confirm(`確定要刪除「${targetDate}」的紀錄？`)) return;
    try {
      await deleteEntryCloud(currentName, targetDate);
      setEntries((prev) => prev.filter((e) => e.date !== targetDate));
      setImprove(""); setGratitude(""); setDailyHabitStatus({});
      if (historyOffset >= entries.length - 1) {
        setHistoryOffset(Math.max(0, historyOffset - HISTORY_LIMIT));
      }
    } catch (e) {
      console.error(e);
      alert("刪除失敗，請檢查 Firebase 設定。");
    }
  };

  const onConfirmUser = () => {
    const nn = normalizeName(rawName);
    if (!nn) { alert("請先輸入使用者名稱"); return; }
    localStorage.setItem("mvp.currentName.v2", nn);
    setCurrentName(nn);
  };
  const onSwitchUser = () => {
    if (!confirm("要切換使用者嗎？目前資料已自動保存。")) return;
    localStorage.removeItem("mvp.currentName.v2");
    setCurrentName("");
    setRawName("");
    setEntries([]);
    setSettingsLocal({ savingsRatio: 0 });
    setCloudOK(null);
  };

  // 導航邏輯
  const isFirstPage = historyOffset === 0;
  const isLastPage = historyOffset + HISTORY_LIMIT >= entries.length;
  
  const onNextPage = () => {
    if (!isLastPage) {
      setHistoryOffset(historyOffset + HISTORY_LIMIT);
    }
  };
  
  const onPrevPage = () => {
    if (!isFirstPage) {
      setHistoryOffset(Math.max(0, historyOffset - HISTORY_LIMIT));
    }
  };

  // 渲染當前頁面的資料
  const visibleEntries = entries.slice(historyOffset, historyOffset + HISTORY_LIMIT);
  const totalEntries = entries.length;
  const currentStart = totalEntries > 0 ? historyOffset + 1 : 0;
  const currentEnd = Math.min(historyOffset + HISTORY_LIMIT, totalEntries);


  // ---- Render ----
  if (!currentName) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-6">
        <div className="w-full max-w-md p-6 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h1 className="text-2xl font-bold mb-3">Habit Tracker   v1</h1>
          <p className="text-sm text-gray-600 mb-4">請先輸入使用者名稱（之後可切換）。</p>
          <input
            value={rawName}
            onChange={(e) => setRawName(e.target.value)}
            placeholder="例如：cathy、grandma、user-01"
            className="w-full rounded-xl border border-gray-300 p-3 mb-4 focus:outline-none focus:ring-2 focus:ring-gray-300"
          />
          <button
            onClick={onConfirmUser}
            className="w-full px-4 py-2 rounded-xl bg-black text-white hover:opacity-90"
          >
            開始使用
          </button>
          <p className="text-xs text-gray-500 mt-3">小提醒：名稱會對應雲端路徑（users/&lt;name&gt;）。</p>
        </div>
      </div>
    );
  }

  const hasEntryForTarget = entries.some((e) => e.date === targetDate);

  return (
    <div className="min-h-screen bg-white text-gray-900 p-6 md:p-10 max-w-5xl mx-auto">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl md:text-3xl font-bold flex items-baseline gap-2">
            Habit Tracker
          </h1>
          <span className="text-xs px-2 py-1 rounded-full border bg-gray-50 text-gray-700">
            使用者：{currentName}
          </span>
          {cloudOK === true && <span className="text-xs text-green-700">（雲端連線正常）</span>}
          {cloudOK === false && <span className="text-xs text-red-600">（雲端連線失敗）</span>}
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <button
            onClick={onSwitchUser}
            className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-700"
            title="切換使用者"
          >
            切換使用者
          </button>
          <span>{today}</span>
        </div>
      </header>

      {loading && <div className="mb-4 text-sm text-gray-600">讀取中…</div>}

      {/* Top stats */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Stat
          label="本週已記錄天數"
          value={`${thisWeekEntries.length} 天`}
          sub={thisWeekMet ? "達標：本週 +10 點" : "未達標（需 ≥3 天）"}
        />
        <Stat
          label="本月已記錄天數"
          value={`${thisMonthEntries.length} 天`}
          sub={`週達標數：${thisMonthWeeksStatus.filter((w) => w.met).length} 週`}
        />
        <Stat
          label="累計點數（估算）"
          value={`${pointsDerived.total} 點`}
          sub={`本週${thisWeekMet ? "+10" : "+0"}（估）`}
        />
        <Stat
          label="月底點數（推估）"
          value={`${projectedMonthEnd} 點`}
          sub={`月增益率：約 ${Math.round(monthlyGainPct * 100)}%`}
        />
      </section>

      {/* 單一輸入區：透過今日/昨日切換 targetDate */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">
              今日輸入
              <span className="ml-2 text-sm text-gray-500">
                目標日期：{targetDate}
              </span>
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => setTargetDate(today)}
                className={`px-3 py-1.5 rounded-lg border ${targetDate === today ? "bg-black text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                title="寫入今天"
              >
                今日
              </button>
              <button
                onClick={() => setTargetDate(yesterday)}
                className={`px-3 py-1.5 rounded-lg border ${targetDate === yesterday ? "bg-black text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                title="寫入昨天"
              >
                昨日
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">改進/做錯（只填 1 件）</label>
              <textarea
                value={improve}
                onChange={(e) => setImprove(e.target.value)}
                rows={3}
                placeholder={targetDate === today ? "例：拖延回覆信件 → 明天 10:00 先回 3 封" : "例：昨天分心滑手機 → 今天 21:30 收手機"}
                className="w-full rounded-xl border border-gray-300 p-3 focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              {improve && (
                <p className="text-xs text-gray-500 mt-1">AI 建議（預覽）：{aiSuggest(improve)}</p>
              )}
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">感恩（至少 1 件，逗號或換行分隔）</label>
              <textarea
                value={gratitude}
                onChange={(e) => setGratitude(e.target.value)}
                rows={2}
                placeholder="例：家人支持、同事幫忙、今天天氣很好"
                className="w-full rounded-xl border border-gray-300 p-3 focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
            </div>

            {/* NEW: Multiple Habit Checkboxes */}
            <div className="space-y-2 pt-2 border-t">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {targetDate === today ? `今天完成的習慣` : `昨天完成的習慣`}
              </label>
              
              {customHabits.length > 0 ? (
                customHabits.map((habit) => (
                  <div key={habit.id} className="flex items-center">
                    <input
                      id={`habit-${habit.id}`}
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-black focus:ring-black"
                      checked={!!dailyHabitStatus[habit.id]}
                      onChange={(e) => 
                        setDailyHabitStatus(prev => ({ ...prev, [habit.id]: e.target.checked }))
                      }
                    />
                    <label htmlFor={`habit-${habit.id}`} className="ml-2 text-sm text-gray-700">
                      {habit.label}
                    </label>
                  </div>
                ))
              ) : (
                <p className="text-xs text-red-500">請先在右側設定習慣目標。</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={onSave}
                className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90"
              >
                儲存
              </button>
              {hasEntryForTarget && (
                <button
                  onClick={removeEntry}
                  className="px-4 py-2 rounded-xl border border-gray-300 hover:bg-gray-50"
                >
                  刪除此日
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 點數錢包 + 習慣設定 */}
        <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h2 className="text-xl font-semibold mb-4">點數錢包</h2>
          <div className="space-y-3">
            <div className="text-sm text-gray-600">
              可用點數（估算）：<span className="font-semibold text-gray-900">{pointsDerived.total}</span>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">儲蓄比例</label>
              <select
                value={savingsRatio}
                onChange={(e) => onChangeSettings(e.target.value)}
                className="w-full rounded-xl border border-gray-300 p-2"
              >
                <option value={0}>0%</option>
                <option value={0.25}>25%</option>
                <option value={0.5}>50%</option>
              </select>
            </div>

            <div className="text-sm text-gray-600">
              月增益率：<b>{Math.round(monthlyGainPct * 100)}%</b>{" "}
              {savingsRatio === 0.25 && (
                <span className="text-xs text-gray-500">
                  （{bookkeepingBoost ? "因記帳達標 +4%" : "基本 +1%"}）
                </span>
              )}
            </div>
            {/* 更改：顯示當月有完成任一習慣的天數 */}
            <div className="text-sm text-gray-600">本月習慣完成天數：<b>{bookkeepingDaysThisMonth}</b></div>
            <div className="p-3 rounded-xl bg-gray-50 border text-sm">月底點數（推估）：<b>{projectedMonthEnd}</b></div>

            {/* NEW: 習慣目標設定 - 替換為多個習慣管理 */}
            <div className="mt-4 pt-2 border-t">
              <label className="block text-sm text-gray-600 mb-2 font-semibold">習慣目標清單（自訂）</label>
              
              {/* 習慣清單 */}
              {customHabits.map((habit) => (
                <div key={habit.id} className="flex items-center justify-between text-sm py-1 border-b last:border-b-0">
                  <span className="truncate">{habit.label}</span>
                  <button
                    onClick={() => onDeleteHabit(habit.id, habit.label)}
                    className="text-red-500 hover:text-red-700 text-xs ml-3"
                    title={`刪除習慣: ${habit.label}`}
                  >
                    刪除
                  </button>
                </div>
              ))}

              {/* 新增輸入框 */}
              <div className="flex gap-2 items-center mt-3">
                <input
                  value={newHabitInput}
                  onChange={(e) => setNewHabitInput(e.target.value)}
                  placeholder="新增習慣（例如：準時上班、喝水）"
                  className="flex-1 rounded-xl border border-gray-300 p-2 text-sm"
                />
                <button
                  onClick={onAddHabit}
                  className="px-3 py-1.5 rounded-lg border bg-black text-white text-sm"
                >
                  新增
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 歷史紀錄 */}
      <section className="mt-8 p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
        
        {/* 標題與分頁按鈕 */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">歷史紀錄</h3>
          
          {totalEntries > HISTORY_LIMIT && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="text-xs text-gray-500">
                顯示 {currentStart}-{currentEnd} / 共 {totalEntries}
              </span>
              {/* 往後（更新的紀錄） */}
              <button
                onClick={onPrevPage}
                disabled={isFirstPage}
                className={`p-1 rounded-full border transition ${isFirstPage ? 'text-gray-400 cursor-not-allowed' : 'bg-gray-100 hover:bg-gray-200'}`}
                title="上一頁（較新的紀錄）"
              >
                <span style={{ fontSize: '1rem' }}>&#9664;</span> 
              </button>

              {/* 往前（更舊的紀錄） */}
              <button
                onClick={onNextPage}
                disabled={isLastPage}
                className={`p-1 rounded-full border transition ${isLastPage ? 'text-gray-400 cursor-not-allowed' : 'bg-gray-100 hover:bg-gray-200'}`}
                title="下一頁（較舊的紀錄）"
              >
                <span style={{ fontSize: '1rem' }}>&#9654;</span>
              </button>
            </div>
          )}
        </div>

        {visibleEntries.length === 0 ? (
          <div className="text-sm text-gray-500">尚無紀錄，先在上方新增內容吧！</div>
        ) : (
          <div className="space-y-3">
            {/* 使用 visibleEntries 渲染當前頁面的 5 筆資料 */}
            {visibleEntries
              .map((e) => {
                // NEW: 準備顯示已完成的習慣
                const completedHabitsList = Array.isArray(e.habitsCompleted) ? e.habitsCompleted : [];
                const completedHabitsDisplay = completedHabitsList
                    .map(getHabitLabelById)
                    .join('、 ');
                
                // 舊資料相容判斷
                const hasOldBookkeeping = e.bookkeeping && completedHabitsList.length === 0;

                return (
                  <div key={e.date} className="p-3 border rounded-xl">
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{e.date}</div>
                      <button
                        className="text-xs text-gray-500 hover:text-red-600"
                        onClick={async () => {
                          if (!confirm(`要刪除 ${e.date} 的紀錄嗎？`)) return;
                          try {
                            await deleteEntryCloud(currentName, e.date);
                            setEntries((prev) => prev.filter((x) => x.date !== e.date));
                            if (targetDate === e.date) {
                              setImprove(""); setGratitude(""); setDailyHabitStatus({});
                            }
                            if (historyOffset >= entries.length - 1) {
                              setHistoryOffset(Math.max(0, historyOffset - HISTORY_LIMIT));
                            }
                          } catch (err) {
                            console.error(err);
                            alert("刪除失敗，請檢查 Firebase 設定。");
                          }
                        }}
                      >
                        刪除
                      </button>
                    </div>
                    <div className="text-sm mt-2">
                      <span className="text-gray-500">改進：</span>{e.improve}
                    </div>
                    <div className="text-sm mt-1">
                      <span className="text-gray-500">感恩：</span>{(e.gratitude || []).join("、 ")}
                    </div>
                    
                    {/* NEW: 顯示多個習慣或舊的單一習慣 */}
                    <div className="text-xs text-gray-500 mt-1">
                      {completedHabitsList.length > 0 ? (
                          `✅ 完成習慣：${completedHabitsDisplay}`
                      ) : hasOldBookkeeping ? (
                          // Fallback for old data with old habitLabel
                          `📒 當日有${e.habitLabel || '記帳'}`
                      ) : (
                          ''
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </section>

      <footer className="text-xs text-gray-400 mt-10 flex justify-between items-end">
        <div>
          目前資料儲存在 Firestore（以使用者名稱分隔）。建議啟用匿名登入並留意安全規則。
        </div>
        <div className="text-gray-400 font-normal">version 1.2 — Multiple Habits Tracking</div>
      </footer>
    </div>
  );
}