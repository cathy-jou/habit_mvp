// ===== src/App.jsx — switch to Firestore storage step-by-step =====
import React, { useEffect, useMemo, useState } from "react";
import {
  normalizeName,
  getSettings, setSettings as setSettingsCloud,
  listEntries, saveEntry as saveEntryCloud, deleteEntry as deleteEntryCloud,
  healthCheck
} from "./firebase";

// ----- Date & Period Helpers -----
function todayISO() {
  const d = new Date();
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

// ----- Lightweight AI Suggestion Rules -----
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
  // ----- Username gate -----
  const [currentName, setCurrentName] = useState(() => {
    try { return localStorage.getItem("mvp.currentName.v2") || ""; } catch { return ""; }
  });
  const [rawName, setRawName] = useState("");
  useEffect(() => setRawName(currentName || ""), [currentName]);

  // ----- Cloud states -----
  const [entries, setEntries] = useState([]);
  const [settings, setSettingsLocal] = useState({ savingsRatio: 0 });
  const [todayImprove, setTodayImprove] = useState("");
  const [todayGratitude, setTodayGratitude] = useState("");
  const [todayBookkeep, setTodayBookkeep] = useState(false);
  const [cloudOK, setCloudOK] = useState(null); // null=unknown, true/false
  const [loading, setLoading] = useState(false);

  const today = todayISO();

  // ---- Step A: Health check + initial load ----
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

  useEffect(() => {
    if (!currentName) return;
    loadFromCloud(currentName);
  }, [currentName]);

  // ----- Derived maps / stats -----
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
  const nextMonthWeeklyReward = monthAllWeeksMet ? 12 : 10;

  const interpersonalUnlock = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - 7 * 7);
    const buckets = new Map();
    entries.forEach((e) => {
      const d = parseISO(e.date);
      if (d >= start && d <= now) {
        const wk = weekKey(d);
        buckets.set(wk, (buckets.get(wk) || 0) + 1);
      }
    });
    const stats = Array.from(buckets.values());
    const metCount = stats.filter((n) => n >= 3).length;
    return { metCount, totalWeeks: Math.max(stats.length, 8), unlocked: metCount >= 6 };
  }, [entries]);

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
    let total = 0;
    rewards.forEach((v) => (total += v));
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

  // ----- Handlers -----
  const todayEntry = entries.find((e) => e.date === today);

  const onSaveToday = async () => {
    const gList = todayGratitude.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (!todayImprove || todayImprove.trim().length < 3) {
      alert("請寫下至少 1 條具體的改進/做錯事項（≥3 字）。"); return;
    }
    if (gList.length < 1) { alert("請至少寫下一件感恩的事。"); return; }

    const payload = { date: today, improve: todayImprove.trim(), gratitude: gList, bookkeeping: todayBookkeep };
    try {
      await saveEntryCloud(currentName, payload);
      // 本地立即反映
      setEntries((prev) => {
        const exists = prev.some((e) => e.date === today);
        if (exists) return prev.map((e) => (e.date === today ? payload : e));
        return [payload, ...prev];
      });
      setTimeout(() => alert(`AI 建議：${aiSuggest(todayImprove)}`), 30);
      setTodayImprove("");
      setTodayBookkeep(false);
    } catch (e) {
      console.error(e);
      alert("雲端寫入失敗，請檢查 Firebase 規則或設定。");
    }
  };

  const removeEntry = async (date) => {
    if (!confirm("確定要刪除此日的紀錄？")) return;
    try {
      await deleteEntryCloud(currentName, date);
      setEntries((prev) => prev.filter((e) => e.date !== date));
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

  // ----- Render -----
  if (!currentName) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-6">
        <div className="w-full max-w-md p-6 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h1 className="text-2xl font-bold mb-3">Habit Tracker MVP</h1>
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
          <p className="text-xs text-gray-500 mt-3">
            小提醒：名稱會對應雲端路徑（users/&lt;name&gt;）。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 p-6 md:p-10 max-w-5xl mx-auto">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl md:text-3xl font-bold">Habit Tracker MVP</h1>
          <span className="text-xs px-2 py-1 rounded-full border bg-gray-50 text-gray-700">
            使用者：{currentName}
          </span>
          {cloudOK === true && <span className="text-xs text-green-700">（雲端連線正常）</span>}
          {cloudOK === false && <span className="text-xs text-red-600">（雲端連線失敗）</span>}
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <button
            onClick={() => loadFromCloud(currentName)}
            className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-700"
            title="重新從雲端讀取"
          >
            重新整理
          </button>
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

      {loading && (
        <div className="mb-4 text-sm text-gray-600">讀取中…</div>
      )}

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
          label="下月週獎勵"
          value={`${nextMonthWeeklyReward} 點`}
          sub={monthAllWeeksMet ? "本月每週都達標 ✔" : "條件：本月每週 ≥3 天"}
        />
      </section>

      {/* Entry + Wallet */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Entry card */}
        <div className="lg:col-span-2 p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h2 className="text-xl font-semibold mb-4">今日輸入（自我）</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">做錯/改進（只填 1 件）</label>
              <textarea
                value={todayImprove}
                onChange={(e) => setTodayImprove(e.target.value)}
                rows={3}
                placeholder="例：拖延回覆信件 → 明天 10:00 先回 3 封"
                className="w-full rounded-xl border border-gray-300 p-3 focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
              {todayImprove && (
                <p className="text-xs text-gray-500 mt-1">AI 建議（預覽）：{aiSuggest(todayImprove)}</p>
              )}
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">感恩（至少 1 件，逗號或換行分隔）</label>
              <textarea
                value={todayGratitude}
                onChange={(e) => setTodayGratitude(e.target.value)}
                rows={2}
                placeholder="例：家人支持、同事幫忙 code review、今天天氣很好"
                className="w-full rounded-xl border border-gray-300 p-3 focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
            </div>

            <div className="flex items-center gap-3">
              <input
                id="bk"
                type="checkbox"
                className="h-4 w-4"
                checked={todayBookkeep}
                onChange={(e) => setTodayBookkeep(e.target.checked)}
              />
              <label htmlFor="bk" className="text-sm text-gray-700">
                今天有記帳
              </label>
            </div>

            <div className="flex gap-3">
              <button onClick={onSaveToday} className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90">
                儲存
              </button>
              {todayEntry && (
                <button
                  onClick={() => removeEntry(today)}
                  className="px-4 py-2 rounded-xl border border-gray-300 hover:bg-gray-50"
                >
                  刪除今日
                </button>
              )}
            </div>

            {todayEntry && (
              <div className="text-sm text-gray-500">
                今天已紀錄：{todayEntry.improve.slice(0, 50)}
                {todayEntry.improve.length > 50 ? "…" : ""}
              </div>
            )}
          </div>
        </div>

        {/* Wallet card */}
        <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h2 className="text-xl font-semibold mb-4">點數錢包（MVP）</h2>
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

            <div className="text-sm text-gray-600">
              本月記帳天數：<b>{bookkeepingDaysThisMonth}</b>
            </div>

            <div className="p-3 rounded-xl bg-gray-50 border text-sm">
              月底點數（推估）：<b>{projectedMonthEnd}</b>
            </div>
          </div>
        </div>
      </section>

      {/* Weekly / Monthly / Interpersonal */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* Weekly progress */}
        <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h3 className="font-semibold mb-3">本週進度</h3>
          <div className="text-sm text-gray-700 mb-2">{thisWeekEntries.length} / 7 天</div>
          <div className="h-2 rounded bg-gray-100 mb-3">
            <div
              className="h-2 rounded bg-black"
              style={{ width: `${(thisWeekEntries.length / 7) * 100}%` }}
            />
          </div>
          <div className="text-sm">
            {thisWeekMet ? "已達標，本週 +10 點" : "尚未達標（需 ≥3 天）"}
          </div>
        </div>

        {/* Monthly weeks status */}
        <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h3 className="font-semibold mb-3">本月週達標概況</h3>
          <ul className="space-y-2 text-sm">
            {thisMonthWeeksStatus.length === 0 && (
              <li className="text-gray-500">本月尚無完整週紀錄</li>
            )}
            {thisMonthWeeksStatus.map((w) => (
              <li key={w.week} className="flex items-center justify-between">
                <span>{w.week}（週一）</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs ${
                    w.met ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {w.met ? "達標" : "未達標"}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-sm text-gray-700">
            {monthAllWeeksMet
              ? "✅ 本月每週都達標：下月週獎勵自動升為 12 點"
              : "條件：本月每週都達標即可升級下月週獎勵"}
          </div>
        </div>

        {/* Interpersonal unlock */}
        <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h3 className="font-semibold mb-3">人際模組</h3>
          <div className="text-sm text-gray-700">
            近 8 週中，≥3 天達標的週數：<b>{interpersonalUnlock.metCount}</b> 週
          </div>
          <div className="h-2 rounded bg-gray-100 my-3">
            <div
              className="h-2 rounded bg-black"
              style={{ width: `${Math.min(100, (interpersonalUnlock.metCount / 6) * 100)}%` }}
            />
          </div>
          {interpersonalUnlock.unlocked ? (
            <div className="text-sm">✅ 已解鎖「人際」紀錄功能（MVP 未實作頁面）。</div>
          ) : (
            <div className="text-sm text-gray-600">未解鎖（條件：近 8 週中 ≥6 週達標）。</div>
          )}
        </div>
      </section>

      {/* History list */}
      <section className="mt-8 p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
        <h3 className="font-semibold mb-4">歷史紀錄</h3>
        {entries.length === 0 ? (
          <div className="text-sm text-gray-500">尚無紀錄，先在上方新增今日內容吧！</div>
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
                      onClick={() => removeEntry(e.date)}
                    >
                      刪除
                    </button>
                  </div>
                  <div className="text-sm mt-2">
                    <span className="text-gray-500">改進：</span>
                    {e.improve}
                  </div>
                  <div className="text-sm mt-1">
                    <span className="text-gray-500">感恩：</span>
                    {e.gratitude.join("、 ")}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {e.bookkeeping ? "📒 當日有記帳" : ""}
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>

      <footer className="text-xs text-gray-400 mt-10">
        目前資料已改為儲存在 Firestore（以使用者名稱分隔）。建議接下來啟用匿名登入並收緊安全規則。
      </footer>
    </div>
  );
}
