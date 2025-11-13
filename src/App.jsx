// ===== src/App.jsx — 支援自訂『習慣目標』（例如：準時上班）與保留歷史紀錄的習慣標籤
import React, { useEffect, useMemo, useState } from "react";
import {
  normalizeName,
  getSettings, setSettings as setSettingsCloud,
  listEntries, saveEntry as saveEntryCloud, deleteEntry as deleteEntryCloud,
  healthCheck
} from "./firebase";

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

  // 新：可客製化的習慣文字
  // settings 會儲存 habitLabel（字串），如果沒有則預設為 '記帳'
  const [habitLabel, setHabitLabel] = useState("記帳");
  const [habitInput, setHabitInput] = useState(""); // 暫存輸入框用

  // 單一輸入框的狀態（由 targetDate 決定寫入哪一天）
  const today = todayISO();
  const yesterday = yesterdayISO();
  const [targetDate, setTargetDate] = useState(today);
  const [improve, setImprove] = useState("");
  const [gratitude, setGratitude] = useState("");
  const [bookkeep, setBookkeep] = useState(false);

  // 依 targetDate 帶出該日已存內容
  useEffect(() => {
    const exist = entries.find((e) => e.date === targetDate);
    if (exist) {
      setImprove(exist.improve || "");
      setGratitude((exist.gratitude || []).join("\n"));
      setBookkeep(!!exist.bookkeeping);
    } else {
      setImprove("");
      setGratitude("");
      setBookkeep(false);
    }
  }, [targetDate, entries]);

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

  // 當 settings 從雲端載入時，取出 habitLabel
  useEffect(() => {
    if (settings && typeof settings === 'object') {
      const label = settings.habitLabel || "記帳";
      setHabitLabel(label);
      setHabitInput(label);
    }
  }, [settings]);

  // 更新 settings 並儲存到雲端（可用於儲存 habitLabel）
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

  // 新：存 habitLabel
  const onSaveHabitLabel = async () => {
    const trimmed = (habitInput || "").trim();
    if (!trimmed) { alert('請輸入要追蹤的習慣名稱（例如：準時上班、喝水）'); return; }
    try {
      const next = { ...settings, habitLabel: trimmed };
      await setSettingsCloud(currentName, next);
      setSettingsLocal(next);
      setHabitLabel(trimmed);
      alert(`已將習慣目標更新為：${trimmed}。
注意：此變更將影響未來的紀錄。過去已儲存的紀錄會保留各自的 habitLabel（如存在），未包含該欄位的舊紀錄可以手動遷移。`);
    } catch (e) {
      console.error(e);
      alert('儲存失敗，請稍後重試。');
    }
  };

  // 新：將缺少 habitLabel 的舊紀錄遷移（把目前 habitLabel 填入舊紀錄）
  const migrateEntriesAddHabitLabel = async () => {
    if (!confirm(`將把所有尚未含有 habitLabel 的歷史紀錄，填入目前的習慣名稱：${habitLabel}。確定要繼續？`)) return;
    try {
      const toMigrate = entries.filter((e) => e.bookkeeping && !e.habitLabel);
      for (const e of toMigrate) {
        const payload = { ...e, habitLabel };
        // saveEntryCloud 以 date 作為 key，會覆寫該日期的 entry
        await saveEntryCloud(currentName, payload);
      }
      // 重新載入或更新 local state
      setEntries((prev) => prev.map((e) => (e.bookkeeping && !e.habitLabel ? { ...e, habitLabel } : e)));
      alert(`完成遷移：共處理 ${toMigrate.length} 筆紀錄。`);
    } catch (err) {
      console.error(err);
      alert('遷移失敗，請檢查網路或後端權限。');
    }
  };

  // 統計
  const weeksMap = useMemo(() => {
    const map = new Map();
    entries.forEach((e) => {
      const wk = weekKey(parseISO(e.date));
      if (!map.has(wk)) map.set(wk, []);
      map.get(wk).push(e);
    });
    return map;
  }, [entries]);
  const thisWeekKey = weekKey(new Date());
  const thisWeekEntries = weeksMap.get(thisWeekKey) || [];
  const thisWeekMet = thisWeekEntries.length >= 3;

  const monthsMap = useMemo(() => {
    const map = new Map();
    entries.forEach((e) => {
      const mk = monthKey(parseISO(e.date));
      if (!map.has(mk)) map.set(mk, []);
      map.get(mk).push(e);
    });
    return map;
  }, [entries]);
  const thisMonthKey = monthKey(new Date());
  const thisMonthEntries = monthsMap.get(thisMonthKey) || [];

  const thisMonthWeeksStatus = useMemo(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const weeks = [];
    let cursor = startOfWeek(first);
    while (cursor <= last) {
      const wk = cursor.toISOString().slice(0, 10);
      const wEnd = endOfWeek(cursor);
      if (wEnd <= new Date()) {
        const arr = weeksMap.get(wk) || [];
        weeks.push({ week: wk, days: arr.length, met: arr.length >= 3 });
      }
      cursor.setDate(cursor.getDate() + 7);
    }
    return weeks;
  }, [weeksMap]);
  const monthAllWeeksMet = thisMonthWeeksStatus.length > 0 && thisMonthWeeksStatus.every((w) => w.met);

  const weeklyRewardBase = 10;
  const pointsDerived = useMemo(() => {
    const rewards = new Map();
    const weeks = new Map();
    entries.forEach((e) => {
      const wk = weekKey(parseISO(e.date));
      weeks.set(wk, (weeks.get(wk) || 0) + 1);
    });
    weeks.forEach((count) => {
      if (count >= 3) rewards.set("x", (rewards.get("x") || 0) + weeklyRewardBase);
    });
    let total = 0; rewards.forEach((v) => (total += v));
    return { total };
  }, [entries]);
  const savingsRatio = settings.savingsRatio;
  const bookkeepingDaysThisMonth = thisMonthEntries.filter((e) => e.bookkeeping).length;
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
    // 新：在每筆 entry 中保存當時使用者的 habitLabel
    const payload = { date: targetDate, improve: improve.trim(), gratitude: gList, bookkeeping: !!bookkeep, habitLabel };
    try {
      await saveEntryCloud(currentName, payload);
      setEntries((prev) => {
        const exists = prev.some((e) => e.date === targetDate);
        if (exists) return prev.map((e) => (e.date === targetDate ? payload : e));
        return [payload, ...prev];
      });
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
      setImprove(""); setGratitude(""); setBookkeep(false);
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

            <div className="flex items-center gap-3">
              <input
                id="bk"
                type="checkbox"
                className="h-4 w-4"
                checked={bookkeep}
                onChange={(e) => setBookkeep(e.target.checked)}
              />
              <label htmlFor="bk" className="text-sm text-gray-700">
                {targetDate === today ? `今天有${habitLabel}` : `昨天有${habitLabel}`}
              </label>
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
            <div className="text-sm text-gray-600">本月{habitLabel}天數：<b>{bookkeepingDaysThisMonth}</b></div>
            <div className="p-3 rounded-xl bg-gray-50 border text-sm">月底點數（推估）：<b>{projectedMonthEnd}</b></div>

            {/* 新：習慣目標設定 */}
            <div className="mt-4 pt-2 border-t">
              <label className="block text-sm text-gray-600 mb-2">習慣目標（自訂）</label>
              <div className="flex gap-2 items-center">
                <input
                  value={habitInput}
                  onChange={(e) => setHabitInput(e.target.value)}
                  placeholder="例如：準時上班、喝水、早睡"
                  className="flex-1 rounded-xl border border-gray-300 p-2"
                />
                <button
                  onClick={onSaveHabitLabel}
                  className="px-3 py-1.5 rounded-lg border bg-black text-white"
                >
                  儲存
                </button>
              </div>
              <div className="text-xs text-gray-500 mt-2">已設定為：<b>{habitLabel}</b></div>

              {/* 遷移用按鈕（選用） */}
              <div className="mt-3 text-xs text-gray-500">
                {/* <div>注意：舊紀錄若未包含 habitLabel 欄位，系統無法自動還原當時的文字（原始值未儲存）。</div> */}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={migrateEntriesAddHabitLabel}
                    className="px-3 py-1 rounded-lg border bg-white hover:bg-gray-50"
                  >
                    將缺少的舊紀錄填上目前習慣名稱
                  </button>
                </div>
              </div>

            </div>
          </div>
        </div>
      </section>

      {/* 歷史紀錄 */}
      <section className="mt-8 p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
        <h3 className="font-semibold mb-4">歷史紀錄</h3>
        {entries.length === 0 ? (
          <div className="text-sm text-gray-500">尚無紀錄，先在上方新增內容吧！</div>
        ) : (
          <div className="space-y-3">
            {entries
              .slice()
              .sort((a, b) => (a.date < b.date ? 1 : -1))
              .map((e) => (
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
                            setImprove(""); setGratitude(""); setBookkeep(false);
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
                  <div className="text-xs text-gray-500 mt-1">
                    {e.bookkeeping ? `📒 當日有${e.habitLabel || habitLabel}` : ""}
                    {/* 若 e.habitLabel 存在就顯示該歷史值，否則顯示目前的 habitLabel（fallback） */}
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>

      <footer className="text-xs text-gray-400 mt-10 flex justify-between items-end">
        <div>
          目前資料儲存在 Firestore（以使用者名稱分隔）。建議啟用匿名登入並留意安全規則。
        </div>
        <div className="text-gray-400 font-normal">version 1.1 — preserve historical habit labels</div>
      </footer>
    </div>
  );
}
