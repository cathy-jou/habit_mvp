// src/App.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  getProfile, setProfile,
  getSettings, setSettings,
  listEntries, saveEntry, deleteEntry,
  normalizeName
} from "./firebase";

const LSK = {
  CURRENT_NAME: "mvp.currentName.v2",
};

// Helpers
function todayISO() {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tzOffset * 60000);
  return local.toISOString().slice(0, 10);
}
function startOfWeek(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7;
  const res = new Date(date);
  res.setDate(date.getDate() - day);
  res.setHours(0,0,0,0);
  return res;
}
function endOfWeek(d) {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  e.setHours(23,59,59,999);
  return e;
}
function weekKey(d) {
  const s = startOfWeek(d);
  return s.toISOString().slice(0,10);
}
function monthKey(d) {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
}

const Stat = ({ label, value, sub }) => (
  <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200">
    <div className="text-sm text-gray-500">{label}</div>
    <div className="text-2xl font-semibold">{value}</div>
    {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
  </div>
);

export default function App() {
  const [currentName, setCurrentName] = useState(() => localStorage.getItem(LSK.CURRENT_NAME) || "");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [settings, setSettingsState] = useState({ savingsRatio: 0 });
  const [entries, setEntries] = useState([]);

  // Inputs
  const [todayImprove, setTodayImprove] = useState("");
  const [todayGratitude, setTodayGratitude] = useState("");
  const [todayBookkeep, setTodayBookkeep] = useState(false);

  // Load data for name
  useEffect(() => {
    (async () => {
      if (!currentName) { setProfileLoaded(false); setEntries([]); setSettingsState({savingsRatio:0}); return; }
      const nn = normalizeName(currentName);
      const [profile, s, e] = await Promise.all([
        getProfile(nn),
        getSettings(nn),
        listEntries(nn),
      ]);
      if (!profile) {
        // first time: create profile
        await setProfile(nn, { name: currentName, createdAt: new Date().toISOString() });
      }
      setSettingsState(s || { savingsRatio: 0 });
      setEntries(e);
      setProfileLoaded(true);
      localStorage.setItem(LSK.CURRENT_NAME, currentName);
    })();
  }, [currentName]);

  const today = todayISO();
  const todayEntry = entries.find(e => (e.id || e.date) === today);

  // Derived metrics
  const weeksMap = useMemo(() => {
    const map = new Map();
    entries.forEach(e => {
      const d = e.date || e.id;
      const wk = weekKey(new Date(d));
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
    entries.forEach(e => {
      const d = e.date || e.id;
      const mk = monthKey(new Date(d));
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
    const last = new Date(now.getFullYear(), now.getMonth()+1, 0);
    const weeks = [];
    let cursor = startOfWeek(first);
    while (cursor <= last) {
      const wk = cursor.toISOString().slice(0,10);
      const wEnd = endOfWeek(cursor);
      if (wEnd <= new Date()) {
        const arr = weeksMap.get(wk) || [];
        weeks.push({ week: wk, days: arr.length, met: arr.length >= 3 });
      }
      cursor.setDate(cursor.getDate()+7);
    }
    return weeks;
  }, [weeksMap]);

  const monthAllWeeksMet = thisMonthWeeksStatus.length > 0 && thisMonthWeeksStatus.every(w => w.met);
  const weeklyRewardBase = 10;
  const pointsDerived = useMemo(() => {
    const rewards = new Map();
    const weekCounts = new Map();
    entries.forEach(e => {
      const d = e.date || e.id;
      const wk = weekKey(new Date(d));
      weekCounts.set(wk, (weekCounts.get(wk) || 0) + 1);
    });
    weekCounts.forEach((count, wk) => {
      if (count >= 3) rewards.set(wk, weeklyRewardBase);
    });
    let total = 0; rewards.forEach(v => total += v);
    return { total, weeks: rewards };
  }, [entries]);

  const bookkeepingDaysThisMonth = thisMonthEntries.filter(e => !!e.bookkeeping).length;
  const savingsRatio = settings.savingsRatio || 0;
  const bookkeepingBoost = bookkeepingDaysThisMonth >= 12;
  const monthlyGainPct =
    savingsRatio === 0.5 ? 0.03 :
    savingsRatio === 0.25 ? (bookkeepingBoost ? 0.04 : 0.01) : 0.0;
  const projectedMonthEnd = Math.round(pointsDerived.total * (1 + monthlyGainPct));
  const nextMonthWeeklyReward = monthAllWeeksMet ? 12 : 10;

  // Handlers
  async function handleSaveToday() {
    if (!currentName) { alert("請先輸入名稱登入"); return; }
    const nn = normalizeName(currentName);
    const gratitudeList = (todayGratitude||"").split(/[\n,]/).map(s=>s.trim()).filter(Boolean);
    if (!todayImprove || todayImprove.trim().length < 3) { alert("請寫下至少 3 個字的改進"); return; }
    if (gratitudeList.length < 1) { alert("請至少寫一條感恩"); return; }
    const payload = { date: today, improve: todayImprove.trim(), gratitude: gratitudeList, bookkeeping: todayBookkeep };
    await saveEntry(nn, today, payload);
    setEntries(prev => {
      const others = prev.filter(e => (e.id || e.date) !== today);
      return [...others, { id: today, ...payload }];
    });
    setTodayImprove(""); setTodayGratitude(""); setTodayBookkeep(false);
  }
  async function handleDeleteToday() {
    const nn = normalizeName(currentName);
    await deleteEntry(nn, today);
    setEntries(prev => prev.filter(e => (e.id || e.date) !== today));
  }
  async function handleUpdateSettings(partial) {
    const nn = normalizeName(currentName);
    await setSettings(nn, partial);
    setSettingsState(s => ({ ...s, ...partial }));
  }

  // Name overlay
  const [tempName, setTempName] = useState("");
  if (!currentName) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black/10 p-6">
        <div className="w-full max-w-md bg-white p-6 rounded-2xl border shadow-sm">
          <h2 className="text-xl font-semibold mb-2">輸入使用者名稱</h2>
          <p className="text-sm text-gray-600 mb-3">輸入名稱即可登入／建立帳號（無需密碼）。</p>
          <input
            value={tempName}
            onChange={e=>setTempName(e.target.value)}
            placeholder="例如：Cathy"
            className="w-full border rounded-xl p-2 mb-3"
          />
          <div className="flex gap-2 justify-end">
            <button className="px-3 py-2 rounded-xl border" onClick={()=>setTempName("")}>清空</button>
            <button className="px-3 py-2 rounded-xl bg-black text-white" onClick={()=> {
              const n = (tempName||"").trim();
              if (!n) { alert("請輸入名稱"); return; }
              setCurrentName(n);
            }}>開始使用</button>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            提醒：此版本以「名稱」作為雲端識別鍵，任何輸入相同名稱的人都能看到/編輯該名稱的資料（適用教學/家庭共用）。若需隱私，建議改用 Firebase Auth。
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
          <div className="text-sm text-gray-500">使用者：<b>{currentName}</b></div>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <button onClick={()=>{ setCurrentName(""); localStorage.removeItem(LSK.CURRENT_NAME); }} className="px-3 py-1.5 rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-700">
            更換名稱
          </button>
          <span>{today}</span>
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Stat label="本週已記錄天數" value={`${thisWeekEntries.length} 天`} sub={thisWeekMet ? "達標：本週 +10 點" : "未達標（需 ≥3 天）"} />
        <Stat label="本月已記錄天數" value={`${thisMonthEntries.length} 天`} sub={`週達標數：${thisMonthWeeksStatus.filter(w=>w.met).length} 週`} />
        <Stat label="累計點數（估算）" value={`${pointsDerived.total} 點`} sub={`本週${thisWeekMet ? "+10" : "+0"}（估）`} />
        <Stat label="下月週獎勵" value={`${nextMonthWeeklyReward} 點`} sub={monthAllWeeksMet ? "本月每週都達標 ✔" : "條件：本月每週 ≥3 天"} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h2 className="text-xl font-semibold mb-4">今日輸入（自我）</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">做錯/改進（只填 1 件）</label>
              <textarea value={todayImprove} onChange={e=>setTodayImprove(e.target.value)} rows={3} placeholder="例：拖延回覆信件 → 明天 10:00 先回 3 封" className="w-full rounded-xl border border-gray-300 p-3 focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">感恩（至少 1 件，逗號或換行分隔）</label>
              <textarea value={todayGratitude} onChange={e=>setTodayGratitude(e.target.value)} rows={2} placeholder="例：家人支持、同事幫忙 code review、今天天氣很好" className="w-full rounded-xl border border-gray-300 p-3 focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div className="flex items-center gap-3">
              <input id="bk" type="checkbox" className="h-4 w-4" checked={todayBookkeep} onChange={e=>setTodayBookkeep(e.target.checked)} />
              <label htmlFor="bk" className="text-sm text-gray-700">今天有記帳</label>
            </div>
            <div className="flex gap-3">
              <button onClick={handleSaveToday} className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90">儲存</button>
              {todayEntry && <button onClick={handleDeleteToday} className="px-4 py-2 rounded-xl border border-gray-300 hover:bg-gray-50">刪除今日</button>}
            </div>
            {todayEntry && <div className="text-sm text-gray-500">今天已紀錄：{todayEntry.improve?.slice(0,50)}{(todayEntry.improve?.length||0)>50?"…":""}</div>}
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h2 className="text-xl font-semibold mb-4">點數錢包（MVP）</h2>
          <div className="space-y-3">
            <div className="text-sm text-gray-600">使用者：<b>{currentName}</b></div>
            <div className="text-sm text-gray-600">可用點數（估算）：<span className="font-semibold text-gray-900">{pointsDerived.total}</span></div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">儲蓄比例</label>
              <select value={savingsRatio} onChange={e=>handleUpdateSettings({ savingsRatio: Number(e.target.value) })} className="w-full rounded-xl border border-gray-300 p-2">
                <option value={0}>0%</option>
                <option value={0.25}>25%</option>
                <option value={0.5}>50%</option>
              </select>
            </div>
            <div className="text-sm text-gray-600">月增益率：<b>{Math.round(monthlyGainPct*100)}%</b> {savingsRatio===0.25 && <span className="text-xs text-gray-500">（{bookkeepingBoost?"因記帳達標 +4%":"基本 +1%"}）</span>}</div>
            <div className="text-sm text-gray-600">本月記帳天數：<b>{bookkeepingDaysThisMonth}</b></div>
            <div className="p-3 rounded-xl bg-gray-50 border text-sm">月底點數（推估）：<b>{projectedMonthEnd}</b></div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h3 className="font-semibold mb-3">本週進度</h3>
          <div className="text-sm text-gray-700 mb-2">{thisWeekEntries.length} / 7 天</div>
          <div className="h-2 rounded bg-gray-100 mb-3">
            <div className="h-2 rounded bg-black" style={{ width: `${(thisWeekEntries.length/7)*100}%` }} />
          </div>
          <div className="text-sm">{thisWeekMet ? "已達標，本週 +10 點" : "尚未達標（需 ≥3 天）"}</div>
        </div>
        <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h3 className="font-semibold mb-3">本月週達標概況</h3>
          <ul className="space-y-2 text-sm">
            {thisMonthWeeksStatus.length===0 && <li className="text-gray-500">本月尚無完整週紀錄</li>}
            {thisMonthWeeksStatus.map(w => (
              <li key={w.week} className="flex items-center justify-between">
                <span>{w.week}（週一）</span>
                <span className={`px-2 py-0.5 rounded-full text-xs ${w.met?"bg-green-100 text-green-700":"bg-gray-100 text-gray-600"}`}>{w.met?"達標":"未達標"}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-sm text-gray-700">{monthAllWeeksMet ? "✅ 本月每週都達標：下月週獎勵自動升為 12 點" : "條件：本月每週都達標即可升級下月週獎勵"}</div>
        </div>
        <div className="p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <h3 className="font-semibold mb-3">人際模組</h3>
          <div className="text-sm text-gray-700">（MVP 暫未實作，待解鎖條件後開啟）</div>
        </div>
      </section>

      <section className="mt-8 p-5 rounded-2xl border border-gray-200 bg-white shadow-sm">
        <h3 className="font-semibold mb-4">歷史紀錄</h3>
        {entries.length === 0 ? (
          <div className="text-sm text-gray-500">尚無紀錄，先在上方新增今日內容吧！</div>
        ) : (
          <div className="space-y-3">
            {entries
              .map(e => ({...e, date: e.date || e.id}))
              .sort((a,b)=>a.date<b.date?1:-1)
              .map(e => (
                <div key={e.date} className="p-3 border rounded-xl">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{e.date}</div>
                  </div>
                  <div className="text-sm mt-2"><span className="text-gray-500">改進：</span>{e.improve}</div>
                  <div className="text-sm mt-1"><span className="text-gray-500">感恩：</span>{(e.gratitude||[]).join("、 ")}</div>
                  <div className="text-xs text-gray-500 mt-1">{e.bookkeeping? "📒 當日有記帳": ""}</div>
                </div>
              ))}
          </div>
        )}
      </section>

      <footer className="text-xs text-gray-400 mt-10">
        MVP：以「名稱」作為雲端識別鍵；任何輸入相同名稱的人都能看到/編輯該名稱的資料。若需隱私，改用 Firebase Auth（UID 為主）。
      </footer>
    </div>
  );
}
