import React, { useState, useEffect, useRef, useCallback, useMemo, useContext, createContext } from "react";
import { Type, Plus, Volume2, BookOpen, Layers, CheckCircle2, XCircle, Trash2, Pencil, RotateCcw, Sparkles, Search, ChevronRight, ChevronLeft, ChevronDown, X, Check, LayoutGrid, List as ListIcon, Folder, Star, Link2, LogOut } from "lucide-react";
import { supabase } from "./lib/supabaseClient";
import { getItem, setItem } from "./lib/storage";

const POS_OPTIONS = ["명사", "동사", "형용사", "부사", "전치사", "접속사", "감탄사", "기타"];
const POS_COLORS = {
  "명사": "#4C7EB0", "동사": "#C97C64", "형용사": "#4E9A6C", "부사": "#8A72C4",
  "전치사": "#B5872F", "접속사": "#5F8598", "감탄사": "#C4699A", "기타": "#8C8C80", "": "#9AA0AC",
};
const COMMON_PREPS = ["to", "for", "of", "with", "in", "on", "at", "from", "by", "about", "into", "up", "out", "off", "as"];
const UNGROUPED = "미분류";
const hasCollocation = (w) => w.senses.some(s => (s.patterns || []).length > 0);

const genId = () => `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };

const FORMAT_PROMPT = `아래 영어 단어/숙어 학습 자료(사진 또는 텍스트)를 정리해줘. 설명이나 다른 텍스트 없이, 아래 형식의 줄들만 자료에 나온 번호 순서대로 출력해줘.

형식 (하나의 뜻마다 한 줄):
영어단어|품사|한글뜻|유의어|콜로케이션패턴|예문

- 영어단어: 원형 그대로 (A, B, N, -ing, do 같은 자리표시자는 유지)
- 품사: 명사/동사/형용사/부사/전치사/접속사/감탄사 중 하나, 표시 없으면 비워두기
- 한글뜻: 그 품사/뜻의 한글 의미 (여러 뜻이면 콤마로 연결)
- 유의어: "="로 연결된 동의/유사 표현이 있으면 쉼표(,)로 구분해서 적기, 없으면 비워두기
- 콜로케이션패턴: 전치사/불변화사가 고정으로 붙는 패턴이 있으면 "템플릿>빈칸>패턴뜻" 형식으로 적기. 템플릿의 빈칸은 ___ 로 표시 (예: "object ___>to>~에 반대하다"). "object는 자동사라 뒤에 전치사가 무조건 온다" 같은 설명도 이 형식으로 바꿔줘. 패턴이 여러 개면 " && "로 이어붙이기. 없으면 비워두기
- 예문: 자료에 그 뜻의 예문이 있으면 그대로 적기 (영어 문장, 없으면 만들지 말고 비워두기). "|" 문자는 예문에 쓰지 말기

규칙:
1. 같은 단어가 번호가 나뉘어 있거나 "/"로 이어져 있어도 여러 품사/뜻이면, 한 줄로 합치지 말고 뜻마다 줄을 따로 만들어줘 (영어단어는 그대로 반복)
2. "=" 뒤에 오는 동의 표현은 새 줄이 아니라 해당 뜻의 유의어 칸에 넣기
3. 별표(*)나 콜론(:)으로 제시된 전치사/불변화사 패턴, 또는 문법 설명(자동사라 전치사가 온다 등)은 새 줄이 아니라 해당 뜻의 콜로케이션패턴 칸에 넣기

예시:
입력: "9. demand 동사) 요구하다 / 명사) 요구 (사항)"
출력:
demand|동사|요구하다|||
demand|명사|요구 (사항)|||

입력: "20. consent 명사) 동의 / *consent to N ~에 동의" 그다음 "21. consent 동사) 동의하다, 승낙하다 / *consent to N ~에 동의하다"
출력:
consent|명사|동의||consent ___ N>to>~에 동의|
consent|동사|동의하다, 승낙하다||consent ___ N>to>~에 동의하다|

입력: "5. increase considerably 상당히 증가하다 = increase significantly = increase substantially"
출력:
increase considerably|부사|상당히 증가하다|increase significantly,increase substantially||

입력: "put A to use A를 활용하다 (전치사 자리에 반드시 to)"
출력:
put A to use|동사|A를 활용하다||put A ___ use>to>A를 활용하다|

입력: "object 반대하다 (자동사라서 뒤에 항상 전치사 to가 붙음) 예문: He objects to the plan."
출력:
object|동사|반대하다||object ___>to>~에 반대하다|He objects to the plan.

이제 아래 자료를 이 형식으로 정리해줘 (사진을 올리거나 텍스트를 붙여넣어서 이어서 물어보세요):`;

// Deterministic, non-AI parser for the "영어|품사|한글뜻|유의어|콜로케이션패턴|예문" format.
// Users run FORMAT_PROMPT through their own AI (any chatbot) and paste the
// result here — no API key or server call needed.
function parsePatternField(raw) {
  if (!raw || !raw.trim()) return [];
  return raw.split("&&").map(chunk => {
    const [template = "", blank = "", korean = ""] = chunk.split(">");
    return { template: template.trim(), blank: blank.trim(), korean: korean.trim() };
  }).filter(p => p.template && p.blank);
}

function parseFormattedText(text) {
  const lines = text.split(/\r?\n/);
  const byKey = new Map();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || !line.includes("|")) continue;
    const [englishRaw, posRaw = "", koreanRaw = "", synRaw = "", patternRaw = "", exampleRaw = ""] = line.split("|");
    const english = (englishRaw || "").trim();
    const korean = (koreanRaw || "").trim();
    if (!english || !korean) continue;
    const pos = (posRaw || "").trim();
    const synonyms = (synRaw || "").split(",").map(s => s.trim()).filter(Boolean);
    const key = english.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { id: genId(), english, group: "", senses: [] });
    byKey.get(key).senses.push(makeSense({
      pos: POS_OPTIONS.includes(pos) ? pos : "",
      korean,
      synonyms,
      example: (exampleRaw || "").trim(),
      patterns: parsePatternField(patternRaw),
    }));
  }
  return [...byKey.values()];
}

let cachedVoices = [];
function refreshVoices() {
  if (typeof window === "undefined" || !window.speechSynthesis) return cachedVoices;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) cachedVoices = voices;
  return cachedVoices;
}
if (typeof window !== "undefined" && window.speechSynthesis) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

// Voice lists differ a lot by browser/OS; the true system default is often a
// low-quality robotic voice, so prefer known-good English voices when present.
const PREFERRED_VOICE_PATTERNS = [/Google US English/i, /Natural/i, /Online/i, /Samantha/i, /Aria/i, /Jenny/i, /Guy/i];
function pickBestVoice() {
  const voices = cachedVoices.length ? cachedVoices : refreshVoices();
  if (!voices.length) return null;
  const enVoices = voices.filter(v => (v.lang || "").toLowerCase().startsWith("en"));
  const pool = enVoices.length ? enVoices : voices;
  for (const pattern of PREFERRED_VOICE_PATTERNS) {
    const match = pool.find(v => pattern.test(v.name));
    if (match) return match;
  }
  return pool.find(v => (v.lang || "").toLowerCase() === "en-us") || pool[0];
}

function speak(text) {
  if (!text || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/___/g, "something"));
  const voice = pickBestVoice();
  if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = "en-US"; }
  u.rate = 0.92;
  window.speechSynthesis.speak(u);
}

function makeSense(partial = {}) {
  return { id: genId(), pos: "", korean: "", synonyms: [], patterns: [], example: "", ...partial };
}

function migrateWord(w) {
  if (Array.isArray(w.senses)) {
    return {
      id: w.id, english: w.english, group: w.group || "",
      senses: w.senses.map(s => makeSense({
        pos: s.pos || "", korean: s.korean || "", synonyms: s.synonyms || [],
        patterns: s.patterns || (s.pattern ? [s.pattern] : []),
        example: s.example || "",
      })),
    };
  }
  return {
    id: w.id, english: w.english, group: w.group || "",
    senses: [makeSense({ pos: w.pos || "", korean: w.korean || "", synonyms: w.synonyms || [], patterns: w.pattern ? [w.pattern] : [], example: w.example || "" })],
  };
}

function buildSynonymBlank(word, sense) {
  const forms = [word.english, ...(sense.synonyms || [])].filter(Boolean);
  if (forms.length < 2) return null;
  const arrays = forms.map(f => f.trim().split(/\s+/));
  const minLen = Math.min(...arrays.map(a => a.length));
  let prefixLen = 0;
  while (prefixLen < minLen && arrays.every(a => a[prefixLen].toLowerCase() === arrays[0][prefixLen].toLowerCase())) prefixLen++;
  let suffixLen = 0;
  while (suffixLen < (minLen - prefixLen) && arrays.every(a => a[a.length - 1 - suffixLen].toLowerCase() === arrays[0][arrays[0].length - 1 - suffixLen].toLowerCase())) suffixLen++;
  const accepted = [...new Set(arrays.map(a => a.slice(prefixLen, a.length - suffixLen).join(" ")).filter(Boolean))];
  if (accepted.length < 2) return null;
  const prefix = arrays[0].slice(0, prefixLen).join(" ");
  const suffix = arrays[0].slice(arrays[0].length - suffixLen).join(" ");
  return { prefix, suffix, accepted, korean: sense.korean };
}

const GROUP_PALETTE = [
  "#F2A6A0", "#F0846F", "#E8916B", "#F0B15E", "#F2C94C", "#F0D96A", "#D9C56F",
  "#C9AE97", "#D6A96B", "#B5872F", "#C97C64", "#C4699A", "#E89FC0", "#E8779E",
  "#B49EDB", "#8A72C4", "#C9A6E8", "#9C89D9", "#93A9CC", "#5F8598", "#4C7EB0",
  "#8FB8E8", "#7FC4D9", "#7FC9C0", "#7FCABF", "#4E9A6C", "#86CB9C", "#9ACB9E",
  "#9AA0AC", "#8C8C80",
];
const hashStr = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const groupColor = (name) => name ? GROUP_PALETTE[hashStr(name) % GROUP_PALETTE.length] : "#B9C2CF";
const colorFor = (path, colors) => path ? ((colors && colors[path]) || groupColor(path)) : "#B9C2CF";
const FolderColorsContext = createContext({ colors: {}, setColor: () => {} });
const leafName = (path) => (path || "").split("/").filter(Boolean).pop() || "";
const ancestorsOf = (path) => {
  const parts = (path || "").split("/").filter(Boolean);
  const res = []; let acc = "";
  for (let i = 0; i < parts.length - 1; i++) { acc = acc ? acc + "/" + parts[i] : parts[i]; res.push(acc); }
  return res;
};
const buildTree = (paths) => {
  const root = []; const map = {};
  [...paths].sort().forEach(p => {
    const parts = p.split("/").filter(Boolean);
    let acc = ""; let list = root;
    parts.forEach(part => {
      acc = acc ? acc + "/" + part : part;
      if (!map[acc]) { const node = { name: part, fullPath: acc, children: [] }; map[acc] = node; list.push(node); }
      list = map[acc].children;
    });
  });
  return root;
};

// FolderTreeRows/ManageFolderRows treat `expanded` as "paths whose children
// render". Call sites store the opposite (a small "collapsedPaths" set) so
// that folders default to expanded without needing to seed every path —
// this derives the expanded set each render.
const expandedFromCollapsed = (allPaths, collapsedPaths) => new Set(allPaths.filter(p => !collapsedPaths.has(p)));

function PosBadge({ pos }) {
  if (!pos) return null;
  return <span className="pos-badge" style={{ background: (POS_COLORS[pos] || POS_COLORS[""]) + "22", color: POS_COLORS[pos] || POS_COLORS[""] }}>{pos}</span>;
}
function GroupBadge({ group }) {
  const { colors } = useContext(FolderColorsContext);
  if (!group) return null;
  return <span className="group-badge" title={group}><span className="dot-sm" style={{ background: colorFor(group, colors) }} />{leafName(group)}</span>;
}
function SpeakerBtn({ text, size = 16 }) {
  return (
    <button className="speaker-btn" onClick={(e) => { e.stopPropagation(); speak(text); }} aria-label={`${text} 발음 듣기`}>
      <Volume2 size={size} strokeWidth={2.25} />
    </button>
  );
}

export default function VocabApp() {
  const [words, setWords] = useState([]);
  const [folderPaths, setFolderPaths] = useState([]);
  const [folderColors, setFolderColors] = useState({});
  const [wrongIds, setWrongIds] = useState([]);
  const [wrongCounts, setWrongCounts] = useState({});
  const [wrongDetails, setWrongDetails] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("list");
  const [toast, setToast] = useState("");
  const [activeGroup, setActiveGroup] = useState("");

  useEffect(() => {
    (async () => {
      const wRes = await getItem("vocab-words-v3").catch(() => null);
      const fRes = await getItem("vocab-folders-v1").catch(() => null);
      const cRes = await getItem("vocab-folder-colors-v1").catch(() => null);
      const xRes = await getItem("vocab-wrong-ids-v1").catch(() => null);
      const ncRes = await getItem("vocab-wrong-counts-v1").catch(() => null);
      const ndRes = await getItem("vocab-wrong-details-v1").catch(() => null);
      setWords(wRes ? JSON.parse(wRes.value).map(migrateWord) : []);
      setFolderPaths(fRes ? JSON.parse(fRes.value) : []);
      setFolderColors(cRes ? JSON.parse(cRes.value) : {});
      setWrongIds(xRes ? JSON.parse(xRes.value) : []);
      setWrongCounts(ncRes ? JSON.parse(ncRes.value) : {});
      setWrongDetails(ndRes ? JSON.parse(ndRes.value) : {});
      setLoaded(true);
    })();
  }, []);

  const persist = useCallback(async (next) => {
    setWords(next);
    try { await setItem("vocab-words-v3", JSON.stringify(next)); } catch (e) { console.error(e); }
  }, []);

  const persistFolders = useCallback(async (next) => {
    setFolderPaths(next);
    try { await setItem("vocab-folders-v1", JSON.stringify(next)); } catch (e) { console.error(e); }
  }, []);

  const persistColors = useCallback(async (next) => {
    setFolderColors(next);
    try { await setItem("vocab-folder-colors-v1", JSON.stringify(next)); } catch (e) { console.error(e); }
  }, []);

  const persistWrongIds = useCallback(async (next) => {
    setWrongIds(next);
    try { await setItem("vocab-wrong-ids-v1", JSON.stringify(next)); } catch (e) { console.error(e); }
  }, []);

  const persistWrongCounts = useCallback(async (next) => {
    setWrongCounts(next);
    try { await setItem("vocab-wrong-counts-v1", JSON.stringify(next)); } catch (e) { console.error(e); }
  }, []);

  const persistWrongDetails = useCallback(async (next) => {
    setWrongDetails(next);
    try { await setItem("vocab-wrong-details-v1", JSON.stringify(next)); } catch (e) { console.error(e); }
  }, []);

  const clearWrong = () => { persistWrongIds([]); persistWrongCounts({}); persistWrongDetails({}); };

  const markAnswer = useCallback((wordId, correct, category = "other") => {
    const hasReview = wrongIds.includes(wordId);
    if (correct && hasReview) {
      persistWrongIds(wrongIds.filter(id => id !== wordId));
    } else if (!correct && !hasReview) {
      persistWrongIds([...wrongIds, wordId]);
    }
    if (!correct) {
      persistWrongCounts({ ...wrongCounts, [wordId]: (wrongCounts[wordId] || 0) + 1 });
      const prevDetail = wrongDetails[wordId] || { spelling: 0, meaning: 0, collocation: 0, other: 0 };
      persistWrongDetails({ ...wrongDetails, [wordId]: { ...prevDetail, [category]: (prevDetail[category] || 0) + 1 } });
    }
  }, [wrongIds, wrongCounts, wrongDetails, persistWrongIds, persistWrongCounts, persistWrongDetails]);

  const toggleFavorite = (id) => persist(words.map(w => w.id === id ? { ...w, favorite: !w.favorite } : w));

  const setFolderColor = (path, color) => {
    const next = { ...folderColors };
    if (color) next[path] = color; else delete next[path];
    persistColors(next);
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 1800); };

  const groups = useMemo(() => {
    const leafPaths = [...new Set([...words.map(w => w.group).filter(Boolean), ...folderPaths])];
    const set = new Set();
    leafPaths.forEach(p => {
      const parts = p.split("/").filter(Boolean);
      let acc = "";
      parts.forEach(part => { acc = acc ? acc + "/" + part : part; set.add(acc); });
    });
    return [...set].sort();
  }, [words, folderPaths]);
  const groupCounts = useMemo(() => {
    const m = { "": words.filter(w => !w.group).length };
    groups.forEach(p => { m[p] = words.filter(w => w.group === p || (w.group || "").startsWith(p + "/")).length; });
    return m;
  }, [words, groups]);

  const addFolder = (path) => {
    if (!path) return;
    const parts = path.split("/").filter(Boolean);
    const toAdd = []; let acc = "";
    parts.forEach(part => { acc = acc ? acc + "/" + part : part; toAdd.push(acc); });
    persistFolders([...new Set([...folderPaths, ...toAdd])]);
  };

  const renameFolder = (oldPath, newLeafName) => {
    const anc = ancestorsOf(oldPath);
    const parent = anc.length ? anc[anc.length - 1] : "";
    const newPath = parent ? `${parent}/${newLeafName}` : newLeafName;
    if (!newLeafName || newPath === oldPath) return;
    const remap = (p) => p === oldPath ? newPath : (p.startsWith(oldPath + "/") ? newPath + p.slice(oldPath.length) : p);
    persistFolders([...new Set(folderPaths.map(remap))]);
    persist(words.map(w => w.group && (w.group === oldPath || w.group.startsWith(oldPath + "/")) ? { ...w, group: remap(w.group) } : w));
    const nextColors = {};
    Object.entries(folderColors).forEach(([k, v]) => { nextColors[k === oldPath || k.startsWith(oldPath + "/") ? remap(k) : k] = v; });
    persistColors(nextColors);
    if (activeGroup && (activeGroup === oldPath || activeGroup.startsWith(oldPath + "/"))) setActiveGroup(remap(activeGroup));
  };

  const deleteFolder = (path) => {
    persistFolders(folderPaths.filter(p => p !== path && !p.startsWith(path + "/")));
    persist(words.map(w => w.group && (w.group === path || w.group.startsWith(path + "/")) ? { ...w, group: "" } : w));
    const nextColors = {};
    Object.entries(folderColors).forEach(([k, v]) => { if (k !== path && !k.startsWith(path + "/")) nextColors[k] = v; });
    persistColors(nextColors);
    if (activeGroup && (activeGroup === path || activeGroup.startsWith(path + "/"))) setActiveGroup("");
  };

  const addWords = (entries) => {
    const clean = entries
      .filter(e => e.english.trim() && (e.senses || []).some(s => (s.korean || "").trim()))
      .map(e => ({
        id: e.id || genId(),
        english: e.english.trim(),
        group: (e.group || "").trim(),
        senses: (e.senses || []).filter(s => (s.korean || "").trim()).map(s => makeSense({
          pos: s.pos || "",
          korean: s.korean.trim(),
          synonyms: (s.synonyms || []).filter(Boolean).map(x => x.trim()).filter(Boolean),
          patterns: (s.patterns || []).filter(p => p.template && p.blank).map(p => ({ template: p.template.trim(), blank: p.blank.trim(), korean: (p.korean || "").trim() })),
        })),
      }))
      .filter(e => e.senses.length > 0);
    if (clean.length === 0) return 0;
    persist([...words, ...clean]);
    return clean.length;
  };

  const updateWord = (id, patch) => persist(words.map(w => w.id === id ? { ...w, ...patch } : w));
  const deleteWord = (id) => persist(words.filter(w => w.id !== id));
  // Batched variants: apply to all ids in one pass so calling updateWord/deleteWord
  // N times in a loop doesn't clobber itself (each call closes over the same
  // pre-loop `words`, so only the last call's change would otherwise survive).
  const bulkMoveWords = (ids, group) => persist(words.map(w => ids.has(w.id) ? { ...w, group } : w));
  const bulkDeleteWords = (ids) => persist(words.filter(w => !ids.has(w.id)));

  return (
    <FolderColorsContext.Provider value={{ colors: folderColors, setColor: setFolderColor }}>
    <div className="app-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap');

        .app-root{
          --bg:#F4F8FC; --card:#FFFFFF; --ink:#3A3F4B; --ink-soft:#868FA0;
          --blue:#8FB8E8; --blue-bg:#EAF3FD; --blue-ink:#3E6EA5;
          --yellow:#F7C873; --yellow-bg:#FFF6E2; --yellow-ink:#93701F;
          --green:#86CB9C; --green-bg:#E9F8EE; --green-ink:#3E7A56;
          --lavender:#C9A6E8; --lavender-bg:#F5EDFC; --lavender-ink:#7A54A0;
          --teal:#7FC9C0; --teal-bg:#E5F6F3; --teal-ink:#2E7A70;
          --coral:#F0916F; --coral-bg:#FDECE4; --coral-ink:#B5502A;
          --red:#F0A39C; --red-bg:#FDEDEB; --red-ink:#BE5548;
          --line:#E7ECF3;
          font-family:'Apple SD Gothic Neo', -apple-system, BlinkMacSystemFont, 'Noto Sans KR', 'Malgun Gothic', sans-serif;
          color:var(--ink); min-height:100vh; background:var(--bg);
          padding:20px 14px 60px; box-sizing:border-box;
        }
        .app-root *{box-sizing:border-box;}
        .app-root button{font-family:inherit; cursor:pointer;}
        .app-root input, .app-root select, .app-root textarea{font-family:inherit;}
        .app-root :focus-visible{outline:2px solid var(--blue); outline-offset:2px;}
        @media (prefers-reduced-motion: reduce){ .app-root *{animation:none !important; transition:none !important;} }

        .header{max-width:640px; margin:0 auto 16px; text-align:center; padding:22px 16px; border-radius:22px;
          background:var(--blue-bg); position:relative;}
        .header .kicker{font-size:11px; letter-spacing:0.14em; color:var(--blue-ink); text-transform:uppercase; font-weight:700; opacity:0.75;}
        .header h1{font-size:28px; color:var(--blue-ink); margin:6px 0 4px; font-weight:900;}
        .header p{font-size:13px; color:var(--ink-soft); margin:0; font-weight:500;}
        .logout-btn{position:absolute; top:12px; right:12px; display:flex; align-items:center; gap:4px; background:rgba(255,255,255,0.7); border:none; border-radius:20px; padding:6px 11px; font-size:11px; font-weight:800; color:var(--blue-ink);}
        .logout-btn:hover{background:#fff;}

        .tabs{max-width:640px; margin:14px auto; display:flex; gap:7px; overflow-x:auto; padding-bottom:2px;}
        .tab-btn{flex:1; min-width:78px; display:flex; flex-direction:column; align-items:center; gap:4px; padding:10px 6px; background:var(--card); border:1.5px solid var(--line); border-radius:14px; color:var(--ink-soft); font-size:11.5px; font-weight:700; transition:all .15s;}
        .tab-btn.active.t-list{background:var(--blue-bg); border-color:var(--blue); color:var(--blue-ink);}
        .tab-btn.active.t-import{background:var(--yellow-bg); border-color:var(--yellow); color:var(--yellow-ink);}
        .tab-btn.active.t-add{background:var(--green-bg); border-color:var(--green); color:var(--green-ink);}
        .tab-btn.active.t-quiz{background:var(--lavender-bg); border-color:var(--lavender); color:var(--lavender-ink);}
        .tab-btn.active.t-groups{background:var(--teal-bg); border-color:var(--teal); color:var(--teal-ink);}
        .tab-btn.active.t-colloc{background:var(--coral-bg); border-color:var(--coral); color:var(--coral-ink);}

        .panel{max-width:640px; margin:0 auto; background:var(--card); border-radius:20px; padding:20px 18px; box-shadow:0 10px 26px rgba(80,100,140,0.10); min-height:320px; border:1.5px solid var(--line);}

        .section-title{font-size:18px; font-weight:900; margin:0 0 4px; display:flex; align-items:center; gap:8px;}
        .section-sub{font-size:12.5px; color:var(--ink-soft); margin:0 0 16px; font-weight:500;}

        .search-row{display:flex; align-items:center; gap:8px; background:var(--bg); border:1.5px solid var(--line); border-radius:12px; padding:8px 10px; margin-bottom:10px;}
        .search-row input{border:none; background:none; outline:none; flex:1; font-size:13.5px; color:var(--ink);}
        .count-chip{font-size:11px; font-weight:800; background:var(--blue); color:#fff; padding:3px 9px; border-radius:20px;}

        .chip-row{display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;}
        .chip{border:1.5px solid var(--line); background:var(--bg); border-radius:20px; padding:6px 12px; font-size:12px; font-weight:700; color:var(--ink-soft); display:flex; align-items:center; gap:4px;}
        .chip.selected{background:var(--blue); border-color:var(--blue); color:#fff;}
        .view-toggle{display:flex; gap:4px; background:var(--bg); border-radius:10px; padding:3px; border:1.5px solid var(--line);}
        .view-toggle button{padding:6px 10px; border-radius:8px; border:none; background:none; color:var(--ink-soft); display:flex; align-items:center; gap:5px; font-size:12px; font-weight:700;}
        .view-toggle button.active{background:var(--card); color:var(--blue-ink); box-shadow:0 1px 4px rgba(0,0,0,0.08);}

        .word-row{padding:10px 8px; border-bottom:1px dashed var(--line);}
        .word-row:last-child{border-bottom:none;}
        .word-row-top{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
        .word-main{flex:1; min-width:120px;}
        .word-eng{font-weight:800; font-size:15.5px; display:flex; align-items:center; gap:6px; cursor:pointer;}
        .word-kor{font-size:13px; color:var(--ink-soft); margin-top:1px; font-weight:500;}
        .pos-badge{font-size:10px; font-weight:800; padding:2px 8px; border-radius:20px; white-space:nowrap;}
        .group-badge{font-size:10px; font-weight:700; padding:2px 8px 2px 6px; border-radius:20px; white-space:nowrap; background:var(--bg); border:1px solid var(--line); color:var(--ink); display:inline-flex; align-items:center; gap:5px;}
        .wrong-badge{font-size:10px; font-weight:800; padding:2px 8px; border-radius:20px; white-space:nowrap; background:var(--red-bg); color:var(--red-ink);}
        .star-btn{padding:5px;}
        .mistake-row{display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; padding-left:30px;}
        .mistake-chip{font-size:10.5px; font-weight:700; padding:2px 9px; border-radius:20px; background:var(--bg); color:var(--ink-soft); border:1px solid var(--line);}
        .mistake-chip.collocation{background:var(--red-bg); color:var(--red-ink); border-color:var(--red); font-weight:800;}
        .dot-sm{width:8px; height:8px; border-radius:50%; flex-shrink:0;}
        .folder-chevron{display:inline-flex; padding:3px; border-radius:6px; color:var(--ink-soft); flex-shrink:0;}
        .folder-chevron:hover{background:var(--line);}
        .folder-chevron-spacer{width:20px; flex-shrink:0; display:inline-block;}
        .manage-row{gap:6px;}
        .manage-actions{display:flex; gap:2px; flex-shrink:0;}
        .folder-dot-btn{background:none; border:none; padding:2px; display:flex; border-radius:50%; flex-shrink:0;}
        .folder-dot-btn:hover{background:var(--line);}
        .color-palette{display:flex; gap:6px; flex-wrap:wrap; padding:8px 12px; margin-bottom:2px; align-items:center;}
        .color-input-wrap{width:26px; height:26px; border-radius:50%; overflow:hidden; box-shadow:0 0 0 1.5px var(--line), 0 0 0 3px #fff; display:inline-flex; flex-shrink:0; cursor:pointer; background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red);}
        .color-input-native{width:100%; height:100%; border:none; padding:0; cursor:pointer; opacity:0; }
        .swatch{width:22px; height:22px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 0 1.5px var(--line); flex-shrink:0;}
        .swatch-reset{background:var(--bg); display:flex; align-items:center; justify-content:center; color:var(--ink-soft); box-shadow:0 0 0 1.5px var(--line);}
        .backup-section{margin-top:22px; padding-top:16px; border-top:1.5px dashed var(--line);}
        .folder-list{display:flex; flex-direction:column; gap:6px; max-height:280px; overflow-y:auto; padding-right:2px;}
        .row-number{font-size:15.5px; font-weight:800; color:var(--ink-soft); min-width:22px; text-align:right; flex-shrink:0;}
        .folder-trigger{display:flex; align-items:center; gap:10px; padding:11px 12px; border-radius:13px; border:1.5px solid var(--line); background:var(--bg); width:100%; text-align:left;}
        .folder-trigger-hint{margin-left:auto; font-size:12px; font-weight:800; color:var(--blue-ink); display:flex; align-items:center; gap:1px;}
        .modal-backdrop{position:fixed; inset:0; background:rgba(30,35,45,0.45); display:flex; align-items:center; justify-content:center; z-index:100; padding:20px;}
        .modal-sheet{background:#fff; border-radius:20px; padding:18px; width:100%; max-width:380px; max-height:80vh; display:flex; flex-direction:column; box-shadow:0 20px 50px rgba(0,0,0,0.25);}
        .modal-title{font-size:15px; font-weight:900; margin-bottom:10px; color:var(--ink);}
        .modal-body{overflow-y:auto; display:flex; flex-direction:column; gap:6px; padding-right:2px; max-height:48vh;}
        .modal-newfolder{background:none; border:none; color:var(--blue-ink); font-weight:800; font-size:12.5px; padding:8px 2px; display:flex; align-items:center; gap:5px;}
        .modal-footer{display:flex; justify-content:space-between; align-items:center; margin-top:8px; padding-top:12px; border-top:1px solid var(--line);}
        .modal-footer .right-btns{display:flex; gap:8px;}
        .folder-row{display:flex; align-items:center; gap:10px; padding:11px 12px; border-radius:13px; border:1.5px solid var(--line); background:var(--bg); text-align:left; width:100%;}
        .folder-row.selected{background:var(--blue-bg); border-color:var(--blue);}
        .folder-dot{width:15px; height:15px; border-radius:50%; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; color:#fff;}
        .folder-dot-add{background:var(--line); color:var(--ink-soft);}
        .folder-name{flex:1; font-size:13.5px; font-weight:700; color:var(--ink);}
        .folder-count{font-size:11px; font-weight:700; color:var(--ink-soft); background:#fff; padding:2px 9px; border-radius:20px;}
        .folder-add{color:var(--ink-soft);}
        .folder-add-input{display:flex; align-items:center; gap:6px; padding:7px 8px;}
        .folder-add-input input{flex:1; padding:9px 10px; border:1.5px solid var(--line); border-radius:10px; font-size:13px;}
        .speaker-btn{background:var(--blue-bg); border:none; color:var(--blue-ink); padding:5px; display:flex; align-items:center; border-radius:8px;}
        .speaker-btn:hover{background:var(--blue);}
        .icon-btn{background:none; border:none; color:var(--ink-soft); padding:6px; border-radius:8px; display:flex;}
        .icon-btn:hover{background:var(--bg); color:var(--ink);}
        .icon-btn.danger:hover{color:var(--red-ink); background:var(--red-bg);}
        .sense-list-display{margin-top:8px; display:flex; flex-direction:column; gap:10px;}
        .sense-detail-block{padding:9px 11px; background:var(--bg); border-radius:10px; font-size:12px; color:var(--ink-soft); display:flex; flex-direction:column; gap:5px;}
        .sense-detail-head{display:flex; align-items:center; gap:8px;}
        .sense-detail-kor{font-size:13.5px; font-weight:700; color:var(--ink);}
        .syn-chip{display:inline-block; background:var(--lavender-bg); color:var(--lavender-ink); padding:2px 9px; border-radius:20px; font-size:11px; margin:2px 4px 0 0; font-weight:700;}
        .pattern-line{font-size:11.5px; color:var(--ink); font-weight:600;}
        .example-line{font-size:11.5px; color:var(--ink-soft); font-style:italic; margin-top:2px;}
        .blank-inline{color:var(--coral-ink); background:var(--coral-bg); padding:1px 6px; border-radius:6px; margin:0 2px; font-weight:900;}
        .pattern-line b{color:var(--red-ink);}
        .more-senses{color:var(--blue-ink); font-weight:700;}

        .empty-state{text-align:center; padding:42px 12px; color:var(--ink-soft); font-weight:500;}
        .empty-state svg{margin-bottom:10px; opacity:0.5;}

        .field{margin-bottom:14px;}
        .field label{display:block; font-size:12px; font-weight:800; color:var(--ink-soft); margin-bottom:5px;}
        .field input, .field select{width:100%; padding:10px 11px; border:1.5px solid var(--line); border-radius:10px; background:#fff; font-size:14.5px; color:var(--ink);}
        .field input:focus, .field select:focus{border-color:var(--blue);}
        .field-hint{font-size:11px; color:var(--ink-soft); margin-top:4px;}

        .btn{border:none; border-radius:12px; padding:11px 18px; font-weight:800; font-size:14px; display:inline-flex; align-items:center; justify-content:center; gap:7px; transition:transform .1s, opacity .15s;}
        .btn:active{transform:scale(0.97);}
        .btn-primary{background:var(--yellow); color:#5B4415;}
        .btn-secondary{background:var(--blue); color:#fff;}
        .btn-outline{background:none; border:1.5px solid var(--line); color:var(--ink);}
        .btn-danger{background:var(--red); color:#fff;}
        .btn:disabled{opacity:0.4; cursor:not-allowed;}
        .btn-full{width:100%;}
        .btn-sm{padding:7px 12px; font-size:12.5px; border-radius:10px;}

        .bulk-bar{display:flex; align-items:center; gap:6px; flex-wrap:wrap; background:var(--blue-bg); border:1.5px solid var(--blue); border-radius:12px; padding:8px 10px; margin-bottom:12px;}
        .bulk-count{font-size:12px; font-weight:800; color:var(--blue-ink); margin-right:2px;}
        .row-checkbox{width:16px; height:16px; flex-shrink:0; accent-color:var(--blue); cursor:pointer;}

        .submode-row{display:flex; gap:6px; margin-bottom:14px;}
        .submode-btn{flex:1; padding:10px; border-radius:12px; border:1.5px solid var(--line); background:var(--bg); color:var(--ink-soft); font-weight:800; font-size:12.5px; display:flex; align-items:center; justify-content:center; gap:6px;}
        .submode-btn.active{background:var(--yellow-bg); border-color:var(--yellow); color:var(--yellow-ink);}

        .photo-drop{border:2px dashed var(--line); border-radius:14px; padding:26px 14px; text-align:center; cursor:pointer; background:var(--bg); transition:border-color .15s;}
        .photo-drop:hover{border-color:var(--yellow);}
        .photo-preview{width:100%; max-height:260px; object-fit:contain; border-radius:12px; margin-bottom:12px; background:#111;}
        .paste-area{width:100%; min-height:140px; padding:12px; border:1.5px solid var(--line); border-radius:12px; font-size:13px; resize:vertical;}
        .format-help{background:var(--bg); border:1.5px solid var(--line); border-radius:12px; padding:12px 14px; margin-bottom:12px; font-size:12.5px; color:var(--ink);}
        .format-help code{background:var(--card); border:1px solid var(--line); border-radius:6px; padding:1px 6px; font-size:11.5px;}
        .format-prompt-box{min-height:110px; max-height:220px; font-family:ui-monospace, 'SF Mono', Consolas, monospace; font-size:11px; background:var(--card); color:var(--ink-soft); line-height:1.5;}

        .pending-card{background:var(--bg); border:1.5px solid var(--line); border-radius:14px; padding:10px; margin-bottom:10px;}
        .insert-row-btn{width:100%; background:none; border:1.5px dashed var(--line); border-radius:10px; padding:5px; margin-bottom:10px; color:var(--ink-soft); font-size:11px; font-weight:700; display:flex; align-items:center; justify-content:center; gap:4px; opacity:0.7;}
        .insert-row-btn:hover{opacity:1; border-color:var(--blue); color:var(--blue-ink); background:var(--blue-bg);}
        .pending-row-single{display:flex; gap:8px; margin-bottom:8px; align-items:center;}
        .pending-row-single input{flex:1; padding:9px 10px; border:1.5px solid var(--line); border-radius:9px; font-size:14px; font-weight:700;}
        .pending-row{display:grid; grid-template-columns:1fr 1fr auto auto; gap:6px; align-items:center;}
        .pending-row input{padding:8px 9px; border:1.5px solid var(--line); border-radius:9px; font-size:13px;}
        .pending-row select{padding:8px 4px; border:1.5px solid var(--line); border-radius:9px; font-size:12px;}
        .pending-extra{margin-top:8px; display:flex; flex-direction:column; gap:6px;}
        .pending-extra input{padding:7px 9px; border:1.5px solid var(--line); border-radius:9px; font-size:12.5px; width:100%;}
        .pending-toggle{background:none; border:none; color:var(--blue-ink); font-size:11.5px; font-weight:800; display:flex; align-items:center; gap:3px; padding:4px 0;}
        .pattern-grid{display:grid; grid-template-columns:2fr 1fr 2fr auto; gap:6px; align-items:center;}
        .sense-card{background:#fff; border:1.5px solid var(--line); border-radius:12px; padding:10px; margin-bottom:8px;}
        .sense-row{display:flex; gap:6px; margin-bottom:6px;}
        .sense-row select{width:88px; flex-shrink:0; padding:8px 4px; border:1.5px solid var(--line); border-radius:9px; font-size:12px;}
        .sense-row input{flex:1; padding:8px 9px; border:1.5px solid var(--line); border-radius:9px; font-size:13px;}
        .sense-syn-input{width:100%; padding:7px 9px; border:1.5px solid var(--line); border-radius:9px; font-size:12.5px; margin-bottom:2px;}

        .toast{position:fixed; left:50%; bottom:24px; transform:translateX(-50%); background:var(--ink); color:#fff; padding:10px 18px; border-radius:30px; font-size:13px; font-weight:700; box-shadow:0 8px 20px rgba(0,0,0,0.2); z-index:50; animation:toastIn .2s ease-out;}
        @keyframes toastIn{from{opacity:0; transform:translate(-50%,8px);} to{opacity:1; transform:translate(-50%,0);}}

        .mode-grid{display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:16px;}
        .mode-card{border:1.5px solid var(--line); background:var(--bg); border-radius:12px; padding:12px 10px; text-align:left; font-size:13px; font-weight:800;}
        .mode-card span{display:block; font-weight:500; font-size:11px; color:var(--ink-soft); margin-top:3px;}
        .mode-card.selected{border-color:var(--lavender); background:var(--lavender-bg); color:var(--lavender-ink);}
        .mode-card:disabled{opacity:0.4; cursor:not-allowed;}

        .quiz-progress{font-size:12px; color:var(--ink-soft); margin-bottom:10px; display:flex; justify-content:space-between; font-weight:700;}
        .quiz-card{background:var(--lavender-bg); border-radius:16px; padding:26px 18px; text-align:center; margin-bottom:16px; min-height:130px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px;}
        .quiz-prompt{font-size:12px; color:var(--lavender-ink); font-weight:700;}
        .quiz-main{font-size:25px; font-weight:900; display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:center;}
        .quiz-main .blank{color:var(--red-ink); font-weight:900;}

        .mc-options{display:grid; gap:9px;}
        .mc-opt{border:1.5px solid var(--line); background:#fff; border-radius:12px; padding:12px 14px; text-align:left; font-size:14.5px; font-weight:700; display:flex; align-items:center; justify-content:space-between;}
        .mc-opt.correct{border-color:var(--green); background:var(--green-bg); color:var(--green-ink);}
        .mc-opt.wrong{border-color:var(--red); background:var(--red-bg); color:var(--red-ink);}
        .mc-opt.picked{border-color:var(--blue); background:var(--blue-bg);}

        .flip-card{perspective:1000px; margin-bottom:16px; cursor:pointer;}
        .flip-inner{position:relative; transition:transform .5s; transform-style:preserve-3d; min-height:150px;}
        .flip-inner.flipped{transform:rotateY(180deg);}
        .flip-face{position:absolute; inset:0; backface-visibility:hidden; background:var(--lavender-bg); border-radius:16px; padding:22px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; overflow-y:auto;}
        .flip-back{transform:rotateY(180deg); background:var(--blue-bg);}

        .stamp{position:absolute; top:-6px; right:6px; width:60px; height:60px; border:3px solid var(--green); border-radius:50%; color:var(--green-ink); display:flex; align-items:center; justify-content:center; flex-direction:column; font-weight:800; font-size:9px; transform:rotate(-14deg) scale(0); animation:stampIn .35s ease-out forwards; background:rgba(255,255,255,0.9);}
        @keyframes stampIn{to{transform:rotate(-14deg) scale(1);}}

        .score-ring{font-size:44px; font-weight:900; text-align:center; margin:6px 0;}
        .review-list{margin-top:14px; background:var(--bg); border-radius:14px; padding:10px 12px;}

        .browse-controls{display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; gap:8px;}
        .browse-nav{display:flex; gap:8px;}
        .browse-nav button{background:var(--bg); border:1.5px solid var(--line); border-radius:10px; padding:8px; color:var(--ink);}
        .browse-progress{font-size:12px; font-weight:700; color:var(--ink-soft);}
        .browse-card{background:var(--blue-bg); border-radius:18px; padding:34px 20px; min-height:190px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; cursor:pointer; text-align:center; position:relative;}
        .browse-star{position:absolute; top:12px; right:12px; background:rgba(255,255,255,0.7); border:none; border-radius:50%; padding:6px; display:flex;}
        .browse-card.flipped{background:var(--green-bg);}
        .browse-main{font-size:26px; font-weight:900;}
        .browse-detail{margin-top:16px; width:100%;}

        .syn-answer{width:100%; min-height:70px; padding:11px; border:1.5px solid var(--line); border-radius:12px; font-size:13.5px; margin-bottom:10px;}
        .syn-result-item{display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; padding:4px 0;}

        @media (max-width:420px){ .header h1{font-size:23px;} .quiz-main{font-size:20px;} .pending-row{grid-template-columns:1fr; grid-template-rows:auto auto auto auto;} .pattern-grid{grid-template-columns:1fr;} }
      `}</style>

      <div className="header">
        <button className="logout-btn" onClick={() => supabase.auth.signOut()} aria-label="로그아웃"><LogOut size={13} /> 로그아웃</button>
        <div className="kicker">Personal English Notebook</div>
        <h1>나만의 단어장</h1>
        <p>텍스트로 담고, 소리로 듣고, 퀴즈로 외우기</p>
      </div>

      <div className="tabs">
        <TabBtn cls="t-list" active={tab === "list"} onClick={() => setTab("list")} icon={<BookOpen size={17} />} label="단어장" />
        <TabBtn cls="t-import" active={tab === "import"} onClick={() => setTab("import")} icon={<Type size={17} />} label="가져오기" />
        <TabBtn cls="t-colloc" active={tab === "colloc"} onClick={() => setTab("colloc")} icon={<Link2 size={17} />} label="연어" />
        <TabBtn cls="t-quiz" active={tab === "quiz"} onClick={() => setTab("quiz")} icon={<Layers size={17} />} label="퀴즈" />
      </div>

      <div className="panel">
        {!loaded ? (
          <div className="empty-state">불러오는 중...</div>
        ) : tab === "list" ? (
          <WordsTab words={words} groups={groups} groupCounts={groupCounts} wrongCounts={wrongCounts} wrongDetails={wrongDetails} wrongIds={wrongIds}
            updateWord={updateWord} deleteWord={deleteWord} bulkMoveWords={bulkMoveWords} bulkDeleteWords={bulkDeleteWords} toggleFavorite={toggleFavorite} clearWrong={clearWrong} showToast={showToast}
            addFolder={addFolder} renameFolder={renameFolder} deleteFolder={deleteFolder} folderPaths={folderPaths} folderColors={folderColors}
            onImport={(data) => { persist((data.words || []).map(migrateWord)); persistFolders(data.folderPaths || []); persistColors(data.folderColors || {}); persistWrongIds(data.wrongIds || []); persistWrongCounts(data.wrongCounts || {}); persistWrongDetails(data.wrongDetails || {}); showToast("백업 파일을 불러왔어요"); }} />
        ) : tab === "import" ? (
          <ImportTab addWords={addWords} showToast={showToast} goList={() => setTab("list")} groups={groups} groupCounts={groupCounts} activeGroup={activeGroup} setActiveGroup={setActiveGroup} addFolder={addFolder} />
        ) : tab === "colloc" ? (
          <CollocationTab words={words} groups={groups} />
        ) : (
          <QuizTab words={words} groups={groups} groupCounts={groupCounts} wrongCounts={wrongCounts} markAnswer={markAnswer} />
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
    </FolderColorsContext.Provider>
  );
}

function TabBtn({ active, onClick, icon, label, cls }) {
  return (
    <button className={`tab-btn ${cls} ${active ? "active" : ""}`} onClick={onClick}>
      {icon}<span>{label}</span>
    </button>
  );
}

function SenseList({ senses }) {
  return (
    <div className="sense-list-display">
      {senses.map((s, idx) => (
        <div key={s.id || idx} className="sense-detail-block">
          <div className="sense-detail-head"><PosBadge pos={s.pos} /><span className="sense-detail-kor">{s.korean}</span></div>
          {s.synonyms && s.synonyms.length > 0 && (
            <div>
              <span style={{ fontWeight: 800, color: "var(--ink)", fontSize: 12 }}>유의어</span>{" "}
              {s.synonyms.map((x, i) => <span key={i} className="syn-chip">{x}</span>)}
            </div>
          )}
          {(s.patterns || []).map((p, i) => (
            <div key={i} className="pattern-line">
              패턴: {p.template.split("___")[0]}<b>[{p.blank}]</b>{p.template.split("___")[1]} — {p.korean}
            </div>
          ))}
          {s.example && <div className="example-line">"{s.example}"</div>}
        </div>
      ))}
    </div>
  );
}

function SenseEditor({ sense, onChange, onRemove, canRemove }) {
  const set = (patch) => onChange({ ...sense, ...patch });
  const addPattern = () => set({ patterns: [...(sense.patterns || []), { template: "", blank: "", korean: "" }] });
  const updatePattern = (idx, patch) => set({ patterns: sense.patterns.map((p, i) => i === idx ? { ...p, ...patch } : p) });
  const removePattern = (idx) => set({ patterns: sense.patterns.filter((_, i) => i !== idx) });
  return (
    <div className="sense-card">
      <div className="sense-row">
        <select value={sense.pos} onChange={e => set({ pos: e.target.value })}>
          <option value="">품사</option>
          {POS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <input value={sense.korean} onChange={e => set({ korean: e.target.value })} placeholder="이 품사의 뜻" />
        {canRemove && <button className="icon-btn danger" onClick={onRemove} aria-label="이 뜻 삭제"><Trash2 size={14} /></button>}
      </div>
      <input className="sense-syn-input" value={(sense.synonyms || []).join(", ")} placeholder="유의어 (쉼표로 구분, 여러 개 가능)"
        onChange={e => set({ synonyms: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} />
      <input className="sense-syn-input" value={sense.example || ""} placeholder="예문 (선택)"
        onChange={e => set({ example: e.target.value })} />
      {(sense.patterns || []).map((p, idx) => (
        <div className="pattern-grid" key={idx} style={{ marginTop: 6 }}>
          <input value={p.template} placeholder="패턴 (consent ___ N)" onChange={e => updatePattern(idx, { template: e.target.value })} />
          <input value={p.blank} placeholder="정답 (to)" onChange={e => updatePattern(idx, { blank: e.target.value })} />
          <input value={p.korean} placeholder="뜻 (~에 동의)" onChange={e => updatePattern(idx, { korean: e.target.value })} />
          <button className="icon-btn danger" onClick={() => removePattern(idx)} aria-label="패턴 삭제"><X size={13} /></button>
        </div>
      ))}
      <button className="pending-toggle" onClick={addPattern}><Plus size={12} /> 전치사 패턴 추가 (선택)</button>
    </div>
  );
}

const MISTAKE_LABELS = { spelling: "스펠링", meaning: "뜻", collocation: "전치사/연어", other: "기타" };

function MistakeBreakdown({ detail }) {
  if (!detail) return null;
  const entries = ["collocation", "spelling", "meaning", "other"].filter(k => detail[k] > 0);
  if (entries.length === 0) return null;
  return (
    <div className="mistake-row">
      {entries.map(k => (
        <span key={k} className={`mistake-chip ${k === "collocation" ? "collocation" : ""}`}>{MISTAKE_LABELS[k]} {detail[k]}번</span>
      ))}
    </div>
  );
}

function WordsTab({ words, groups, groupCounts, wrongCounts, wrongDetails, wrongIds, updateWord, deleteWord, bulkMoveWords, bulkDeleteWords, toggleFavorite, clearWrong, addFolder, renameFolder, deleteFolder, folderPaths, folderColors, onImport, showToast }) {
  const [subMode, setSubMode] = useState("list");
  return (
    <div>
      <div className="submode-row">
        <button className={`submode-btn ${subMode === "list" ? "active" : ""}`} onClick={() => setSubMode("list")}><BookOpen size={14} /> 단어 목록</button>
        <button className={`submode-btn ${subMode === "manage" ? "active" : ""}`} onClick={() => setSubMode("manage")}><Folder size={14} /> 묶음 관리</button>
      </div>
      {subMode === "list" ? (
        <ListTab words={words} groups={groups} groupCounts={groupCounts} wrongCounts={wrongCounts} wrongDetails={wrongDetails} updateWord={updateWord} deleteWord={deleteWord} bulkMoveWords={bulkMoveWords} bulkDeleteWords={bulkDeleteWords} toggleFavorite={toggleFavorite} clearWrong={clearWrong} addFolder={addFolder} showToast={showToast} />
      ) : (
        <ManageGroupsTab groups={groups} groupCounts={groupCounts} addFolder={addFolder} renameFolder={renameFolder} deleteFolder={deleteFolder}
          words={words} folderPaths={folderPaths} folderColors={folderColors} wrongIds={wrongIds} wrongCounts={wrongCounts} wrongDetails={wrongDetails} onImport={onImport} />
      )}
    </div>
  );
}

function ListTab({ words, groups, groupCounts, wrongCounts, wrongDetails, updateWord, deleteWord, bulkMoveWords, bulkDeleteWords, toggleFavorite, clearWrong, addFolder, showToast }) {
  const [q, setQ] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [treeExpanded, setTreeExpanded] = useState(new Set());
  const [wrongThreshold, setWrongThreshold] = useState(2);
  const [view, setView] = useState("list");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const toggleSelected = (id) => setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); setConfirmBulkDelete(false); };
  const applyBulkMove = (path) => {
    bulkMoveWords(selectedIds, path);
    showToast && showToast(`${selectedIds.size}개 단어를 "${path || "미분류"}"로 옮겼어요`);
    setShowMoveModal(false);
    exitSelectMode();
  };
  const applyBulkDelete = () => {
    bulkDeleteWords(selectedIds);
    showToast && showToast(`${selectedIds.size}개 단어를 삭제했어요`);
    exitSelectMode();
  };

  const toggleTreeExpand = (p) => setTreeExpanded(prev => { const s = new Set(prev); s.has(p) ? s.delete(p) : s.add(p); return s; });
  const tree = buildTree(groups);
  const favoriteCount = words.filter(w => w.favorite).length;
  const wrongFolderCount = words.filter(w => (wrongCounts?.[w.id] || 0) >= wrongThreshold).length;
  const collocationWordCount = words.filter(hasCollocation).length;

  const filtered = words.filter(w => {
    const matchQ = (w.english + " " + w.senses.map(s => s.korean).join(" ")).toLowerCase().includes(q.toLowerCase());
    const matchG = selectedFolder === null ? true
      : selectedFolder === "__favorites__" ? !!w.favorite
        : selectedFolder === "__wrong__" ? (wrongCounts?.[w.id] || 0) >= wrongThreshold
          : selectedFolder === "__collocation__" ? hasCollocation(w)
            : selectedFolder === "" ? !w.group
              : (w.group === selectedFolder || (w.group || "").startsWith(selectedFolder + "/"));
    return matchQ && matchG;
  });
  const sortedFiltered = selectedFolder === "__wrong__" ? [...filtered].sort((a, b) => (wrongCounts?.[b.id] || 0) - (wrongCounts?.[a.id] || 0)) : filtered;

  return (
    <div>
      <div className="section-title"><BookOpen size={18} /> 내 단어장</div>
      <p className="section-sub">영어 단어를 누르면 발음을 들을 수 있어요. 별표를 누르면 즐겨찾기에 담겨요.</p>
      <div className="search-row">
        <Search size={15} color="#A6ACBB" />
        <input placeholder="검색..." value={q} onChange={e => setQ(e.target.value)} />
        <span className="count-chip">{filtered.length}개</span>
      </div>

      <div className="field">
        <label>폴더에서 보기</label>
        <div className="folder-list">
          <button className={`folder-row ${selectedFolder === null ? "selected" : ""}`} onClick={() => setSelectedFolder(null)}>
            <span className="folder-chevron-spacer" />
            <span className="folder-dot" style={{ background: "linear-gradient(135deg, var(--blue), var(--lavender))" }} />
            <span className="folder-name">전체</span>
            <span className="folder-count">{words.length}개</span>
            {selectedFolder === null && <Check size={15} color="var(--blue-ink)" />}
          </button>
          <button className={`folder-row ${selectedFolder === "__favorites__" ? "selected" : ""}`} onClick={() => setSelectedFolder("__favorites__")}>
            <span className="folder-chevron-spacer" />
            <Star size={14} color="#E3A730" fill={favoriteCount > 0 ? "#E3A730" : "none"} style={{ flexShrink: 0 }} />
            <span className="folder-name">즐겨찾기</span>
            <span className="folder-count">{favoriteCount}개</span>
            {selectedFolder === "__favorites__" && <Check size={15} color="var(--blue-ink)" />}
          </button>
          <button className={`folder-row ${selectedFolder === "__wrong__" ? "selected" : ""}`} onClick={() => setSelectedFolder("__wrong__")}>
            <span className="folder-chevron-spacer" />
            <XCircle size={14} color="var(--red-ink)" style={{ flexShrink: 0 }} />
            <span className="folder-name">틀린 항목</span>
            <span className="folder-count">{wrongFolderCount}개</span>
            {selectedFolder === "__wrong__" && <Check size={15} color="var(--blue-ink)" />}
          </button>
          <button className={`folder-row ${selectedFolder === "__collocation__" ? "selected" : ""}`} onClick={() => setSelectedFolder("__collocation__")}>
            <span className="folder-chevron-spacer" />
            <Link2 size={14} color="var(--coral-ink)" style={{ flexShrink: 0 }} />
            <span className="folder-name">콜로케이션</span>
            <span className="folder-count">{collocationWordCount}개</span>
            {selectedFolder === "__collocation__" && <Check size={15} color="var(--blue-ink)" />}
          </button>
          {words.some(w => !w.group) && (
            <button className={`folder-row ${selectedFolder === "" ? "selected" : ""}`} onClick={() => setSelectedFolder("")}>
              <span className="folder-chevron-spacer" />
              <span className="folder-dot" style={{ background: "#B9C2CF" }} />
              <span className="folder-name">미분류</span>
              <span className="folder-count">{groupCounts?.[""] || 0}개</span>
              {selectedFolder === "" && <Check size={15} color="var(--blue-ink)" />}
            </button>
          )}
          <FolderTreeRows nodes={tree} depth={0} expanded={expandedFromCollapsed(groups, treeExpanded)} toggleExpand={toggleTreeExpand} isSelected={p => p === selectedFolder} onToggle={setSelectedFolder} counts={groupCounts || {}} />
        </div>
        {selectedFolder === "__wrong__" && (
          <div className="chip-row" style={{ marginTop: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-soft)", alignSelf: "center" }}>기준</span>
            {[1, 2, 3, 5].map(n => (
              <button key={n} className={`chip ${wrongThreshold === n ? "selected" : ""}`} onClick={() => setWrongThreshold(n)}>{n}번 이상</button>
            ))}
            {clearWrong && <button className="chip" onClick={clearWrong} style={{ color: "var(--red-ink)" }}>전체 초기화</button>}
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        {view === "list" ? (
          <button className={`chip ${selectMode ? "selected" : ""}`} onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}>
            <CheckCircle2 size={13} /> {selectMode ? "선택 취소" : "선택"}
          </button>
        ) : <span />}
        <div className="view-toggle">
          <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}><ListIcon size={13} /> 목록</button>
          <button className={view === "card" ? "active" : ""} onClick={() => { setView("card"); exitSelectMode(); }}><LayoutGrid size={13} /> 카드</button>
        </div>
      </div>

      {selectMode && (
        <div className="bulk-bar">
          <span className="bulk-count">{selectedIds.size}개 선택됨</span>
          <button className="chip" onClick={() => setSelectedIds(new Set(sortedFiltered.map(w => w.id)))}>전체 선택</button>
          <button className="chip" onClick={() => setSelectedIds(new Set())}>선택 해제</button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-outline btn-sm" disabled={selectedIds.size === 0} onClick={() => setShowMoveModal(true)}><Folder size={13} /> 폴더 이동</button>
          {confirmBulkDelete ? (
            <>
              <button className="btn btn-danger btn-sm" onClick={applyBulkDelete}>삭제 확인</button>
              <button className="btn btn-outline btn-sm" onClick={() => setConfirmBulkDelete(false)}>취소</button>
            </>
          ) : (
            <button className="btn btn-outline btn-sm" disabled={selectedIds.size === 0} onClick={() => setConfirmBulkDelete(true)}><Trash2 size={13} /> 삭제</button>
          )}
        </div>
      )}

      {showMoveModal && (
        <BulkMoveModal groups={groups} counts={groupCounts} onCreateFolder={addFolder} onConfirm={applyBulkMove} onClose={() => setShowMoveModal(false)} />
      )}

      {words.length === 0 ? (
        <div className="empty-state">
          <BookOpen size={34} />
          <div>아직 등록된 단어가 없어요.<br />사진을 찍거나 직접 추가해보세요.</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">조건에 맞는 단어가 없어요.</div>
      ) : view === "card" ? (
        <BrowseCards words={sortedFiltered} toggleFavorite={toggleFavorite} />
      ) : (
        <div>
          {sortedFiltered.map((w, idx) => (
            editingId === w.id ? (
              <EditRow key={w.id} word={w} groups={groups} onSave={(patch) => { updateWord(w.id, patch); setEditingId(null); }} onCancel={() => setEditingId(null)} />
            ) : (
              <div className="word-row" key={w.id}>
                <div className="word-row-top">
                  {selectMode && (
                    <input type="checkbox" className="row-checkbox" checked={selectedIds.has(w.id)} onChange={() => toggleSelected(w.id)} aria-label="선택" />
                  )}
                  <span className="row-number">{idx + 1}</span>
                  <button className="icon-btn star-btn" onClick={() => toggleFavorite(w.id)} aria-label="즐겨찾기">
                    <Star size={16} color="#E3A730" fill={w.favorite ? "#E3A730" : "none"} />
                  </button>
                  <div className="word-main">
                    <div className="word-eng" onClick={() => speak(w.english)}>
                      <SpeakerBtn text={w.english} />{w.english}
                    </div>
                    <div className="word-kor">{w.senses[0]?.korean}{w.senses.length > 1 && <span className="more-senses"> 외 {w.senses.length - 1}개 뜻</span>}</div>
                  </div>
                  <PosBadge pos={w.senses[0]?.pos} />
                  <GroupBadge group={w.group} />
                  {wrongCounts?.[w.id] > 0 && <span className="wrong-badge">✕ {wrongCounts[w.id]}번</span>}
                  <button className="icon-btn" onClick={() => setExpandedId(expandedId === w.id ? null : w.id)} aria-label="상세 보기">
                    <ChevronDown size={15} style={{ transform: expandedId === w.id ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                  </button>
                  <button className="icon-btn" onClick={() => setEditingId(w.id)} aria-label="수정"><Pencil size={15} /></button>
                  {confirmDeleteId === w.id ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="icon-btn danger" onClick={() => { deleteWord(w.id); setConfirmDeleteId(null); }} aria-label="삭제 확인"><Check size={15} /></button>
                      <button className="icon-btn" onClick={() => setConfirmDeleteId(null)} aria-label="취소"><X size={15} /></button>
                    </div>
                  ) : (
                    <button className="icon-btn danger" onClick={() => setConfirmDeleteId(w.id)} aria-label="삭제"><Trash2 size={15} /></button>
                  )}
                </div>
                {selectedFolder === "__wrong__" && <MistakeBreakdown detail={wrongDetails?.[w.id]} />}
                {expandedId === w.id && <SenseList senses={w.senses} />}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}

function BrowseCards({ words, toggleFavorite }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [frontMode, setFrontMode] = useState("en");
  const i = Math.min(idx, words.length - 1);
  const word = words[i];

  const go = (delta) => { setFlipped(false); setIdx(v => Math.max(0, Math.min(words.length - 1, v + delta))); };

  if (!word) return null;
  const frontIsEnglish = frontMode === "en";
  const frontText = frontIsEnglish ? word.english : word.senses[0]?.korean;

  return (
    <div>
      <div className="browse-controls">
        <div className="view-toggle">
          <button className={frontMode === "en" ? "active" : ""} onClick={() => { setFrontMode("en"); setFlipped(false); }}>영어 먼저</button>
          <button className={frontMode === "kr" ? "active" : ""} onClick={() => { setFrontMode("kr"); setFlipped(false); }}>한글 먼저</button>
        </div>
        <div className="browse-progress">{i + 1} / {words.length}</div>
      </div>
      <div className={`browse-card ${flipped ? "flipped" : ""}`} onClick={() => setFlipped(f => !f)}>
        <button className="browse-star" onClick={(e) => { e.stopPropagation(); toggleFavorite(word.id); }} aria-label="즐겨찾기">
          <Star size={20} color="#E3A730" fill={word.favorite ? "#E3A730" : "none"} />
        </button>
        {!flipped ? (
          <>
            {frontIsEnglish && <SpeakerBtn text={word.english} size={20} />}
            <div className="browse-main">{frontText}</div>
            <div style={{ fontSize: 11, color: "var(--ink-soft)", fontWeight: 700 }}>탭해서 뜻 보기</div>
          </>
        ) : (
          <>
            <SpeakerBtn text={word.english} size={20} />
            <div className="browse-main">{word.english}</div>
            <div className="browse-detail"><SenseList senses={word.senses} /></div>
          </>
        )}
      </div>
      <div className="browse-nav" style={{ justifyContent: "center", marginTop: 12 }}>
        <button onClick={() => go(-1)} disabled={i === 0}><ChevronLeft size={16} /></button>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => go(1)} disabled={i === words.length - 1}>다음 카드 <ChevronRight size={15} /></button>
      </div>
    </div>
  );
}

function CollocationTab({ words, groups }) {
  const [q, setQ] = useState("");
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [treeExpanded, setTreeExpanded] = useState(new Set());

  const toggleTreeExpand = (p) => setTreeExpanded(prev => { const s = new Set(prev); s.has(p) ? s.delete(p) : s.add(p); return s; });
  const tree = buildTree(groups);

  const items = words.flatMap(w => w.senses.flatMap(s => (s.patterns || []).map((p, i) => ({ key: `${w.id}-${s.id}-${i}`, word: w, sense: s, pattern: p }))));

  const collocCounts = useMemo(() => {
    const m = {};
    items.forEach(it => {
      const g = it.word.group || "";
      if (g) { const parts = g.split("/"); let acc = ""; parts.forEach(part => { acc = acc ? acc + "/" + part : part; m[acc] = (m[acc] || 0) + 1; }); }
      m[""] = (m[""] || 0) + (g ? 0 : 1);
    });
    return m;
  }, [items]);

  const filtered = items.filter(it => {
    const hay = (it.word.english + " " + it.pattern.template + " " + it.pattern.blank + " " + it.pattern.korean).toLowerCase();
    const matchQ = hay.includes(q.toLowerCase());
    const g = it.word.group || "";
    const matchG = selectedFolder === null ? true : (selectedFolder === "" ? !g : (g === selectedFolder || g.startsWith(selectedFolder + "/")));
    return matchQ && matchG;
  });

  return (
    <div>
      <div className="section-title"><Link2 size={18} /> 연어 (Collocation)</div>
      <p className="section-sub">"object 뒤에 to" 같이 짝으로 붙는 표현만 모아서 볼 수 있어요.</p>
      <div className="search-row">
        <Search size={15} color="#A6ACBB" />
        <input placeholder="검색..." value={q} onChange={e => setQ(e.target.value)} />
        <span className="count-chip">{filtered.length}개</span>
      </div>

      {(groups.length > 0 || words.some(w => !w.group)) && items.length > 0 && (
        <div className="field">
          <label>폴더에서 보기</label>
          <div className="folder-list">
            <button className={`folder-row ${selectedFolder === null ? "selected" : ""}`} onClick={() => setSelectedFolder(null)}>
              <span className="folder-chevron-spacer" />
              <span className="folder-dot" style={{ background: "linear-gradient(135deg, var(--coral), var(--yellow))" }} />
              <span className="folder-name">전체</span>
              <span className="folder-count">{items.length}개</span>
              {selectedFolder === null && <Check size={15} color="var(--blue-ink)" />}
            </button>
            {words.some(w => !w.group) && (
              <button className={`folder-row ${selectedFolder === "" ? "selected" : ""}`} onClick={() => setSelectedFolder("")}>
                <span className="folder-chevron-spacer" />
                <span className="folder-dot" style={{ background: "#B9C2CF" }} />
                <span className="folder-name">미분류</span>
                <span className="folder-count">{collocCounts[""] || 0}개</span>
                {selectedFolder === "" && <Check size={15} color="var(--blue-ink)" />}
              </button>
            )}
            <FolderTreeRows nodes={tree} depth={0} expanded={expandedFromCollapsed(groups, treeExpanded)} toggleExpand={toggleTreeExpand} isSelected={p => p === selectedFolder} onToggle={setSelectedFolder} counts={collocCounts} />
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty-state">
          <Link2 size={34} />
          <div>아직 등록된 연어(전치사 패턴)가 없어요.<br />단어 추가할 때 "전치사 패턴"을 입력해보세요.</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">조건에 맞는 연어가 없어요.</div>
      ) : (
        <div>
          {filtered.map((it, idx) => (
            <div className="word-row" key={it.key}>
              <div className="word-row-top">
                <span className="row-number">{idx + 1}</span>
                <div className="word-main">
                  <div className="word-eng" onClick={() => speak(it.pattern.template.replace("___", it.pattern.blank))}>
                    <SpeakerBtn text={it.pattern.template.replace("___", it.pattern.blank)} />
                    {it.pattern.template.split("___")[0]}<span className="blank-inline">{it.pattern.blank}</span>{it.pattern.template.split("___")[1]}
                  </div>
                  <div className="word-kor">{it.pattern.korean}</div>
                </div>
                <PosBadge pos={it.sense.pos} />
                <GroupBadge group={it.word.group} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupField({ value, onChange, groups }) {
  return (
    <>
      <input list="group-options" value={value} onChange={e => onChange(e.target.value)} placeholder="묶음 이름 (예: Day 1)" />
      <datalist id="group-options">{groups.map(g => <option key={g} value={g} />)}</datalist>
    </>
  );
}

function FolderTreeRows({ nodes, depth, expanded, toggleExpand, isSelected, onToggle, counts }) {
  const { colors } = useContext(FolderColorsContext);
  return nodes.map(node => (
    <React.Fragment key={node.fullPath}>
      <button className={`folder-row ${isSelected(node.fullPath) ? "selected" : ""}`} style={{ paddingLeft: 12 + depth * 20 }} onClick={() => onToggle(node.fullPath)}>
        {node.children.length > 0 ? (
          <span className="folder-chevron" onClick={(e) => { e.stopPropagation(); toggleExpand(node.fullPath); }}>
            <ChevronRight size={14} style={{ transform: expanded.has(node.fullPath) ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
          </span>
        ) : <span className="folder-chevron-spacer" />}
        <span className="folder-dot" style={{ background: colorFor(node.fullPath, colors) }} />
        <span className="folder-name">{node.name}</span>
        <span className="folder-count">{counts[node.fullPath] || 0}개</span>
        {isSelected(node.fullPath) && <Check size={15} color="var(--blue-ink)" />}
      </button>
      {expanded.has(node.fullPath) && node.children.length > 0 && (
        <FolderTreeRows nodes={node.children} depth={depth + 1} expanded={expanded} toggleExpand={toggleExpand} isSelected={isSelected} onToggle={onToggle} counts={counts} />
      )}
    </React.Fragment>
  ));
}

function BulkMoveModal({ groups, counts, onCreateFolder, onConfirm, onClose }) {
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(new Set());
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const toggleExpand = (path) => setExpanded(prev => { const s = new Set(prev); s.has(path) ? s.delete(path) : s.add(path); return s; });
  const confirmAdd = () => {
    const name = newName.trim().replace(/\//g, "");
    if (!name) { setAdding(false); return; }
    const fullPath = draft ? `${draft}/${name}` : name;
    onCreateFolder && onCreateFolder(fullPath);
    setDraft(fullPath);
    setNewName(""); setAdding(false);
  };
  const tree = buildTree(groups);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-title">이동할 묶음 선택</div>
        <div className="modal-body">
          <button className={`folder-row ${draft === "" ? "selected" : ""}`} onClick={() => setDraft("")}>
            <span className="folder-chevron-spacer" />
            <span className="folder-dot" style={{ background: "#B9C2CF" }} />
            <span className="folder-name">미분류</span>
            {draft === "" && <Check size={15} color="var(--blue-ink)" />}
          </button>
          <FolderTreeRows nodes={tree} depth={0} expanded={expandedFromCollapsed(groups, expanded)} toggleExpand={toggleExpand} isSelected={p => p === draft} onToggle={setDraft} counts={counts} />
        </div>

        {adding ? (
          <div className="folder-row folder-add-input" style={{ marginTop: 10 }}>
            <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") confirmAdd(); }} placeholder="새 묶음 이름" />
            <button className="icon-btn" onClick={confirmAdd} aria-label="추가"><Check size={15} color="var(--green-ink)" /></button>
            <button className="icon-btn" onClick={() => { setAdding(false); setNewName(""); }} aria-label="취소"><X size={15} /></button>
          </div>
        ) : (
          <div className="modal-footer">
            <button className="modal-newfolder" onClick={() => setAdding(true)}><Plus size={14} /> 새 묶음 만들기</button>
            <div className="right-btns">
              <button className="btn btn-outline btn-sm" onClick={onClose}>취소</button>
              <button className="btn btn-primary btn-sm" onClick={() => onConfirm(draft)}>이동</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GroupPicker({ groups, value, onChange, counts = {}, onCreateFolder }) {
  const { colors } = useContext(FolderColorsContext);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [expanded, setExpanded] = useState(new Set());
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const openModal = () => {
    setDraft(value); setAdding(false); setNewName("");
    setExpanded(new Set()); // nothing collapsed — folders default to expanded
    setOpen(true);
  };
  const confirm = () => { onChange(draft); setOpen(false); };
  const cancel = () => setOpen(false);
  const toggleExpand = (path) => setExpanded(prev => { const s = new Set(prev); s.has(path) ? s.delete(path) : s.add(path); return s; });
  const confirmAdd = () => {
    const name = newName.trim().replace(/\//g, "");
    if (!name) { setAdding(false); return; }
    const fullPath = draft ? `${draft}/${name}` : name;
    onCreateFolder && onCreateFolder(fullPath);
    setDraft(fullPath);
    setNewName(""); setAdding(false);
  };

  const displayPaths = [...new Set([...groups, value, draft].filter(Boolean))];
  const tree = buildTree(displayPaths);

  return (
    <div className="field">
      <label>묶음 선택 <span style={{ fontWeight: 500, color: "var(--ink-soft)" }}>— 바꾸기 전까지 계속 이 묶음으로 추가돼요</span></label>
      <button className="folder-trigger" onClick={openModal}>
        <span className="folder-dot" style={{ background: value ? colorFor(value, colors) : "#B9C2CF" }} />
        <span className="folder-name">{value ? leafName(value) : "미분류"}</span>
        <span className="folder-trigger-hint">변경<ChevronRight size={14} /></span>
      </button>

      {open && (
        <div className="modal-backdrop" onClick={cancel}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div className="modal-title">묶음 선택</div>
            <div className="modal-body">
              <button className={`folder-row ${draft === "" ? "selected" : ""}`} onClick={() => setDraft("")}>
                <span className="folder-chevron-spacer" />
                <span className="folder-dot" style={{ background: "#B9C2CF" }} />
                <span className="folder-name">미분류</span>
                <span className="folder-count">{counts[""] || 0}개</span>
                {draft === "" && <Check size={15} color="var(--blue-ink)" />}
              </button>
              <FolderTreeRows nodes={tree} depth={0} expanded={expandedFromCollapsed(displayPaths, expanded)} toggleExpand={toggleExpand} isSelected={p => p === draft} onToggle={setDraft} counts={counts} />
            </div>

            {adding ? (
              <div className="folder-row folder-add-input" style={{ marginTop: 10 }}>
                <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") confirmAdd(); }} placeholder="예: LC 스크립트" />
                <button className="icon-btn" onClick={confirmAdd} aria-label="추가"><Check size={15} color="var(--green-ink)" /></button>
                <button className="icon-btn" onClick={() => { setAdding(false); setNewName(""); }} aria-label="취소"><X size={15} /></button>
              </div>
            ) : (
              <div className="modal-footer">
                <button className="modal-newfolder" onClick={() => setAdding(true)}><Plus size={14} /> {draft ? `"${leafName(draft)}" 안에 새 묶음` : "새 묶음 만들기"}</button>
                <div className="right-btns">
                  <button className="btn btn-outline btn-sm" onClick={cancel}>취소</button>
                  <button className="btn btn-primary btn-sm" onClick={confirm}>확인</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EditRow({ word, groups, onSave, onCancel }) {
  const [english, setEnglish] = useState(word.english);
  const [grp, setGrp] = useState(word.group || "");
  const [senses, setSenses] = useState(word.senses.map(s => ({ ...s, synonyms: [...(s.synonyms || [])], patterns: (s.patterns || []).map(p => ({ ...p })) })));

  const updateSense = (idx, next) => setSenses(senses.map((s, i) => i === idx ? next : s));
  const addSense = () => setSenses([...senses, makeSense()]);
  const removeSense = (idx) => setSenses(senses.filter((_, i) => i !== idx));
  const save = () => onSave({ english, group: grp.trim(), senses });

  return (
    <div style={{ padding: "10px 0", borderBottom: "1px dashed var(--line)" }}>
      <div className="pending-row-single">
        <input value={english} onChange={ev => setEnglish(ev.target.value)} placeholder="영어" />
        <div style={{ display: "flex", gap: 4 }}>
          <button className="icon-btn" onClick={save} aria-label="저장"><Check size={16} color="var(--green-ink)" /></button>
          <button className="icon-btn" onClick={onCancel} aria-label="취소"><X size={16} /></button>
        </div>
      </div>
      <div style={{ marginBottom: 8 }}><GroupField value={grp} onChange={setGrp} groups={groups} /></div>
      {senses.map((s, idx) => (
        <SenseEditor key={s.id} sense={s} canRemove={senses.length > 1} onChange={next => updateSense(idx, next)} onRemove={() => removeSense(idx)} />
      ))}
      <button className="pending-toggle" onClick={addSense}><Plus size={12} /> 다른 품사/뜻 추가</button>
    </div>
  );
}

function AddTab({ addWords, showToast, groups, groupCounts, activeGroup, setActiveGroup, addFolder }) {
  const [english, setEnglish] = useState("");
  const [senses, setSenses] = useState(() => [makeSense()]);

  const updateSense = (idx, next) => setSenses(senses.map((s, i) => i === idx ? next : s));
  const addSense = () => setSenses([...senses, makeSense()]);
  const removeSense = (idx) => setSenses(senses.filter((_, i) => i !== idx));

  const submit = () => {
    const n = addWords([{ english, group: activeGroup, senses }]);
    if (n > 0) {
      showToast(`"${activeGroup || "미분류"}"에 단어를 추가했어요`);
      setEnglish(""); setSenses([makeSense()]);
    }
  };

  const canSubmit = english.trim() && senses.some(s => s.korean.trim());

  return (
    <div>
      <div className="section-title"><Plus size={18} /> 직접 추가</div>
      <p className="section-sub">단어와 뜻을 입력하세요. 품사가 여러 개면 뜻을 계속 추가할 수 있어요.</p>
      <GroupPicker groups={groups} value={activeGroup} onChange={setActiveGroup} counts={groupCounts} onCreateFolder={addFolder} />
      <div className="field"><label>영어 단어 / 숙어</label><input value={english} onChange={e => setEnglish(e.target.value)} placeholder="예: market" /></div>
      <div className="field">
        <label>뜻 (품사별로 여러 개 추가 가능)</label>
        {senses.map((s, idx) => (
          <SenseEditor key={s.id} sense={s} canRemove={senses.length > 1} onChange={next => updateSense(idx, next)} onRemove={() => removeSense(idx)} />
        ))}
        <button className="btn btn-outline btn-full" onClick={addSense}><Plus size={14} /> 다른 품사/뜻 추가</button>
      </div>
      <button className="btn btn-primary btn-full" disabled={!canSubmit} onClick={submit}><Plus size={16} /> 단어장에 추가</button>
    </div>
  );
}

function InsertRowButton({ onClick }) {
  return (
    <button type="button" className="insert-row-btn" onClick={onClick} aria-label="여기에 새 단어 추가">
      <Plus size={12} /> 여기에 단어 추가
    </button>
  );
}

function PendingCard({ item, onChange, onRemove }) {
  const set = (patch) => onChange({ ...item, ...patch });
  const updateSense = (idx, next) => set({ senses: item.senses.map((s, i) => i === idx ? next : s) });
  const addSense = () => set({ senses: [...item.senses, makeSense()] });
  const removeSense = (idx) => set({ senses: item.senses.filter((_, i) => i !== idx) });
  return (
    <div className="pending-card">
      <div className="pending-row-single">
        <input value={item.english} placeholder="영어" onChange={e => set({ english: e.target.value })} />
        <button className="icon-btn danger" onClick={onRemove} aria-label="항목 삭제"><Trash2 size={15} /></button>
      </div>
      {item.senses.map((s, idx) => (
        <SenseEditor key={s.id} sense={s} canRemove={item.senses.length > 1} onChange={next => updateSense(idx, next)} onRemove={() => removeSense(idx)} />
      ))}
      <button className="pending-toggle" onClick={addSense}><Plus size={12} /> 뜻 추가</button>
    </div>
  );
}

function ImportTab({ addWords, showToast, goList, groups, groupCounts, activeGroup, setActiveGroup, addFolder }) {
  const [subMode, setSubMode] = useState("format");
  const [formattedText, setFormattedText] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(null);
  const [promptCopied, setPromptCopied] = useState(false);

  const runFormatParse = () => {
    if (!formattedText.trim()) return;
    setError("");
    const items = parseFormattedText(formattedText);
    if (items.length === 0) {
      setError(`형식에 맞는 줄을 찾지 못했어요. "영어|품사|한글뜻|유의어" 형식인지 확인해주세요.`);
      return;
    }
    setPending(items);
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(FORMAT_PROMPT);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1800);
    } catch {
      setError("클립보드 복사에 실패했어요. 아래 프롬프트를 직접 선택해서 복사해주세요.");
    }
  };

  const updatePending = (id, next) => setPending(pending.map(p => p.id === id ? next : p));
  const removePending = (id) => setPending(pending.filter(p => p.id !== id));
  const addRow = (atIndex) => {
    const newItem = { id: genId(), english: "", group: "", senses: [makeSense()] };
    setPending(prev => {
      const idx = atIndex === undefined ? prev.length : atIndex;
      const next = [...prev];
      next.splice(idx, 0, newItem);
      return next;
    });
  };

  const save = () => {
    const n = addWords(pending.map(p => ({ ...p, group: activeGroup })));
    if (n > 0) {
      showToast(`"${activeGroup || "미분류"}"에 ${n}개 단어를 추가했어요`);
      setPending(null); setError(""); setFormattedText("");
      goList();
    } else {
      setError("저장할 단어가 없어요. 영어와 한글을 모두 입력해 주세요.");
    }
  };

  return (
    <div>
      <div className="section-title"><Type size={18} /> 가져오기</div>
      <p className="section-sub">텍스트를 붙여넣거나 직접 입력해서 단어를 추가하세요.</p>

      {!pending && (
        <div className="submode-row">
          <button className={`submode-btn ${subMode === "format" ? "active" : ""}`} onClick={() => setSubMode("format")}><Sparkles size={14} /> AI 텍스트</button>
          <button className={`submode-btn ${subMode === "manual" ? "active" : ""}`} onClick={() => setSubMode("manual")}><Plus size={14} /> 직접 입력</button>
        </div>
      )}

      {subMode === "manual" && !pending ? (
        <AddTab addWords={addWords} showToast={showToast} groups={groups} groupCounts={groupCounts} activeGroup={activeGroup} setActiveGroup={setActiveGroup} addFolder={addFolder} />
      ) : (
        <>
          <GroupPicker groups={groups} value={activeGroup} onChange={setActiveGroup} counts={groupCounts} onCreateFolder={addFolder} />

          {!pending && subMode === "format" && (
            <>
              <div className="format-help">
                <div style={{ fontWeight: 800, marginBottom: 6 }}>AI로 정리해서 가져오기</div>
                <p style={{ margin: "0 0 8px" }}>단어장 사진(또는 텍스트)을 아무 AI 챗봇(클로드 앱, 챗GPT 등)에 올리고 아래 프롬프트를 이어서 붙여넣어 정리를 부탁하세요. 그 결과를 아래 칸에 붙여넣으면 바로 저장돼요.</p>
                <textarea className="paste-area format-prompt-box" readOnly value={FORMAT_PROMPT} onFocus={e => e.target.select()} />
                <button type="button" className="btn btn-outline" style={{ marginTop: 8 }} onClick={copyPrompt}>
                  <Sparkles size={14} /> {promptCopied ? "복사됐어요!" : "프롬프트 복사하기"}
                </button>
                <div className="field-hint" style={{ marginTop: 8 }}>형식: <code>영어단어|품사|한글뜻|유의어|콜로케이션패턴|예문</code> — 한 줄에 하나씩</div>
              </div>
              <textarea className="paste-area" value={formattedText} onChange={e => setFormattedText(e.target.value)}
                placeholder={`consent|명사|동의||consent ___ N>to>~에 동의|\nconsent|동사|동의하다, 승낙하다||consent ___ N>to>~에 동의하다|\nincrease considerably|부사|상당히 증가하다|increase significantly,increase substantially||`} />
              <button className="btn btn-primary btn-full" style={{ marginTop: 10 }} disabled={!formattedText.trim()} onClick={runFormatParse}>
                <LayoutGrid size={16} /> 형식대로 가져오기
              </button>
              {error && <div style={{ color: "var(--red-ink)", fontSize: 12.5, marginTop: 10, fontWeight: 600 }}>{error}</div>}
            </>
          )}

          {pending && (
            <div>
              <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 10, fontWeight: 600 }}>인식된 {pending.length}개 항목을 확인하고 필요하면 수정하세요. ("{activeGroup || "미분류"}" 묶음으로 저장돼요)</div>
              {error && <div style={{ color: "var(--red-ink)", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{error}</div>}
              <InsertRowButton onClick={() => addRow(0)} />
              {pending.map((p, idx) => (
                <React.Fragment key={p.id}>
                  <PendingCard item={p} onChange={(next) => updatePending(p.id, next)} onRemove={() => removePending(p.id)} />
                  <InsertRowButton onClick={() => addRow(idx + 1)} />
                </React.Fragment>
              ))}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-outline" onClick={() => { setPending(null); setError(""); }}>다시 시도</button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={save}><Check size={16} /> 단어장에 저장</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ManageFolderRows({ nodes, depth, expanded, toggleExpand, counts, editingPath, editValue, setEditValue, startRename, confirmRename, cancelRename, startAdd, confirmDeletePath, setConfirmDeletePath, doDelete, addingUnder, newName, setNewName, confirmAddNew, cancelAdd, colorPickerPath, setColorPickerPath }) {
  const { colors, setColor } = useContext(FolderColorsContext);
  return nodes.map(node => (
    <React.Fragment key={node.fullPath}>
      {editingPath === node.fullPath ? (
        <div className="folder-row folder-add-input" style={{ paddingLeft: 12 + depth * 20 }}>
          <input autoFocus value={editValue} onChange={e => setEditValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") confirmRename(); }} />
          <button className="icon-btn" onClick={confirmRename} aria-label="저장"><Check size={15} color="var(--green-ink)" /></button>
          <button className="icon-btn" onClick={cancelRename} aria-label="취소"><X size={15} /></button>
        </div>
      ) : (
        <div className="folder-row manage-row" style={{ paddingLeft: 12 + depth * 20 }}>
          {node.children.length > 0 ? (
            <span className="folder-chevron" onClick={() => toggleExpand(node.fullPath)}>
              <ChevronRight size={14} style={{ transform: expanded.has(node.fullPath) ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
            </span>
          ) : <span className="folder-chevron-spacer" />}
          <button className="folder-dot-btn" onClick={(e) => { e.stopPropagation(); setColorPickerPath(colorPickerPath === node.fullPath ? null : node.fullPath); }} aria-label="색 바꾸기">
            <span className="folder-dot" style={{ background: colorFor(node.fullPath, colors) }} />
          </button>
          <span className="folder-name">{node.name}</span>
          <span className="folder-count">{counts[node.fullPath] || 0}개</span>
          <span className="manage-actions">
            <button className="icon-btn" onClick={() => startAdd(node.fullPath)} aria-label="하위 묶음 추가"><Plus size={14} /></button>
            <button className="icon-btn" onClick={() => startRename(node.fullPath)} aria-label="이름 바꾸기"><Pencil size={14} /></button>
            {confirmDeletePath === node.fullPath ? (
              <>
                <button className="icon-btn danger" onClick={() => doDelete(node.fullPath)} aria-label="삭제 확인"><Check size={14} /></button>
                <button className="icon-btn" onClick={() => setConfirmDeletePath(null)} aria-label="취소"><X size={14} /></button>
              </>
            ) : (
              <button className="icon-btn danger" onClick={() => setConfirmDeletePath(node.fullPath)} aria-label="삭제"><Trash2 size={14} /></button>
            )}
          </span>
        </div>
      )}
      {colorPickerPath === node.fullPath && (
        <div className="color-palette" style={{ paddingLeft: 12 + (depth + 1) * 20 }}>
          <label className="color-input-wrap" aria-label="직접 색 고르기">
            <input type="color" className="color-input-native" value={colorFor(node.fullPath, colors)} onChange={e => setColor(node.fullPath, e.target.value)} />
          </label>
          {GROUP_PALETTE.map(c => (
            <button key={c} className="swatch" style={{ background: c }} onClick={() => { setColor(node.fullPath, c); setColorPickerPath(null); }} aria-label={`색 ${c}`} />
          ))}
          <button className="swatch swatch-reset" onClick={() => { setColor(node.fullPath, null); setColorPickerPath(null); }} aria-label="기본 색으로"><RotateCcw size={12} /></button>
        </div>
      )}
      {addingUnder === node.fullPath && (
        <div className="folder-row folder-add-input" style={{ paddingLeft: 12 + (depth + 1) * 20 }}>
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") confirmAddNew(); }} placeholder="새 하위 묶음 이름" />
          <button className="icon-btn" onClick={confirmAddNew} aria-label="추가"><Check size={15} color="var(--green-ink)" /></button>
          <button className="icon-btn" onClick={cancelAdd} aria-label="취소"><X size={15} /></button>
        </div>
      )}
      {expanded.has(node.fullPath) && node.children.length > 0 && (
        <ManageFolderRows nodes={node.children} depth={depth + 1} expanded={expanded} toggleExpand={toggleExpand} counts={counts}
          editingPath={editingPath} editValue={editValue} setEditValue={setEditValue} startRename={startRename} confirmRename={confirmRename} cancelRename={cancelRename}
          startAdd={startAdd} confirmDeletePath={confirmDeletePath} setConfirmDeletePath={setConfirmDeletePath} doDelete={doDelete}
          addingUnder={addingUnder} newName={newName} setNewName={setNewName} confirmAddNew={confirmAddNew} cancelAdd={cancelAdd}
          colorPickerPath={colorPickerPath} setColorPickerPath={setColorPickerPath} />
      )}
    </React.Fragment>
  ));
}

function ManageGroupsTab({ groups, groupCounts, addFolder, renameFolder, deleteFolder, words, folderPaths, folderColors, wrongIds, wrongCounts, wrongDetails, onImport }) {
  const [expanded, setExpanded] = useState(new Set());
  const toggleExpand = (p) => setExpanded(prev => { const s = new Set(prev); s.has(p) ? s.delete(p) : s.add(p); return s; });
  const [editingPath, setEditingPath] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [addingUnder, setAddingUnder] = useState(undefined);
  const [newName, setNewName] = useState("");
  const [confirmDeletePath, setConfirmDeletePath] = useState(null);
  const [colorPickerPath, setColorPickerPath] = useState(null);
  const fileInputRef = useRef(null);
  const [importError, setImportError] = useState("");

  const tree = buildTree(groups);

  const startRename = (path) => { setEditingPath(path); setEditValue(leafName(path)); };
  const confirmRename = () => {
    const name = editValue.trim().replace(/\//g, "");
    if (name && name !== leafName(editingPath)) renameFolder(editingPath, name);
    setEditingPath(null); setEditValue("");
  };
  const startAdd = (parentPath) => {
    setAddingUnder(parentPath); setNewName("");
  };
  const confirmAddNew = () => {
    const name = newName.trim().replace(/\//g, "");
    if (name) { const full = addingUnder ? `${addingUnder}/${name}` : name; addFolder(full); }
    setAddingUnder(undefined); setNewName("");
  };
  const doDelete = (path) => { deleteFolder(path); setConfirmDeletePath(null); };

  const handleExport = () => {
    const payload = JSON.stringify({ words, folderPaths, folderColors, wrongIds, wrongCounts, wrongDetails, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vocab-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (file) => {
    if (!file) return;
    setImportError("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.words)) throw new Error("형식이 올바르지 않아요");
        onImport(data);
      } catch (e) {
        setImportError("파일을 읽지 못했어요. 이 앱에서 내보낸 백업 파일인지 확인해주세요.");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <div className="section-title"><Folder size={18} /> 묶음 관리</div>
      <p className="section-sub">묶음 이름을 바꾸거나 삭제하고, 새 묶음을 미리 만들어 둘 수 있어요. 색 점을 누르면 색을 직접 고를 수 있어요.</p>

      {groups.length === 0 ? (
        <div className="empty-state"><Folder size={34} /><div>아직 만든 묶음이 없어요.<br />아래 버튼으로 첫 묶음을 만들어보세요.</div></div>
      ) : (
        <div className="folder-list">
          <ManageFolderRows nodes={tree} depth={0} expanded={expandedFromCollapsed(groups, expanded)} toggleExpand={toggleExpand} counts={groupCounts}
            editingPath={editingPath} editValue={editValue} setEditValue={setEditValue}
            startRename={startRename} confirmRename={confirmRename} cancelRename={() => setEditingPath(null)}
            startAdd={startAdd} confirmDeletePath={confirmDeletePath} setConfirmDeletePath={setConfirmDeletePath} doDelete={doDelete}
            addingUnder={addingUnder} newName={newName} setNewName={setNewName} confirmAddNew={confirmAddNew} cancelAdd={() => setAddingUnder(undefined)}
            colorPickerPath={colorPickerPath} setColorPickerPath={setColorPickerPath} />
        </div>
      )}

      {addingUnder === "" ? (
        <div className="folder-row folder-add-input" style={{ marginTop: 10 }}>
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") confirmAddNew(); }} placeholder="예: Day 3" />
          <button className="icon-btn" onClick={confirmAddNew} aria-label="추가"><Check size={15} color="var(--green-ink)" /></button>
          <button className="icon-btn" onClick={() => setAddingUnder(undefined)} aria-label="취소"><X size={15} /></button>
        </div>
      ) : (
        <button className="btn btn-outline btn-full" style={{ marginTop: 12 }} onClick={() => startAdd("")}><Plus size={15} /> 최상위 묶음 만들기</button>
      )}
      <div className="field-hint" style={{ marginTop: 10 }}>묶음을 삭제하면 그 안의 단어는 사라지지 않고 "미분류"로 옮겨져요.</div>

      <div className="backup-section">
        <div className="section-title" style={{ fontSize: 15 }}>데이터 백업</div>
        <p className="section-sub">파일로 내보내서 iCloud Drive나 파일 앱에 저장해두면, 다른 기기에서 그 파일을 불러와 똑같이 복원할 수 있어요.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={handleExport}><Sparkles size={15} /> 내보내기 (파일 저장)</button>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => fileInputRef.current?.click()}><Folder size={15} /> 가져오기 (파일 불러오기)</button>
        </div>
        <input ref={fileInputRef} type="file" accept="application/json" style={{ display: "none" }} onChange={e => handleImportFile(e.target.files?.[0])} />
        {importError && <div style={{ color: "var(--red-ink)", fontSize: 12.5, marginTop: 8, fontWeight: 600 }}>{importError}</div>}
        <div className="field-hint">가져오기를 하면 지금 있는 단어장 내용이 파일 내용으로 바뀌니, 필요하면 먼저 내보내기로 백업해두세요.</div>
      </div>
    </div>
  );
}

function buildQuestion(m, i, sw, si, sp, ssyn, allWords) {
  if (m === "mc") {
    const item = si[i % si.length];
    const { word, sense } = item;
    const direction = Math.random() < 0.5 ? "e2k" : "k2e";
    if (direction === "e2k") {
      const correct = sense.korean;
      const distractors = [...new Set(shuffle(si.filter(x => x.word.id !== word.id).map(x => x.sense.korean)).filter(v => v && v !== correct))].slice(0, 3);
      return { type: "mc", word, sense, direction, options: shuffle([correct, ...distractors]), correct };
    }
    const correct = word.english;
    const distractors = [...new Set(shuffle(allWords.filter(w => w.id !== word.id).map(w => w.english)).filter(v => v && v !== correct))].slice(0, 3);
    return { type: "mc", word, sense, direction, options: shuffle([correct, ...distractors]), correct };
  }
  if (m === "typing") { const item = si[i % si.length]; return { type: "typing", word: item.word, sense: item.sense }; }
  if (m === "posmeaning") { const item = si[i % si.length]; return { type: "posmeaning", word: item.word, sense: item.sense }; }
  if (m === "flash") return { type: "flash", word: sw[i % sw.length], frontIsEnglish: Math.random() < 0.5 };
  if (m === "collocation") {
    const pat = sp[i % sp.length];
    const pool = [...new Set([...sp.map(p => p.blank.toLowerCase()), ...COMMON_PREPS])].filter(b => b !== pat.blank.toLowerCase());
    const distractors = shuffle(pool).slice(0, 3);
    return { type: "collocation", word: pat.word, sense: pat.sense, template: pat.template, korean: pat.korean, correct: pat.blank, options: shuffle([pat.blank, ...distractors]) };
  }
  if (m === "synonym") {
    const item = ssyn[i % ssyn.length];
    const blank = buildSynonymBlank(item.word, item.sense);
    return { type: "synonym", word: item.word, sense: item.sense, blank };
  }
}

function buildSession(mode, count, words, senseItems, patternsPool, synonymSenseItems) {
  const sw = shuffle(words), si = shuffle(senseItems), sp = shuffle(patternsPool), ssyn = shuffle(synonymSenseItems);
  const counters = { mc: 0, typing: 0, posmeaning: 0, flash: 0, collocation: 0, synonym: 0 };
  const questions = [];
  for (let i = 0; i < count; i++) {
    let m = mode;
    if (mode === "mix") {
      const candidates = ["mc", "typing", "flash", "posmeaning"];
      if (sp.length >= 3) candidates.push("collocation");
      if (ssyn.length >= 2) candidates.push("synonym");
      m = candidates[Math.floor(Math.random() * candidates.length)];
    }
    questions.push(buildQuestion(m, counters[m], sw, si, sp, ssyn, words));
    counters[m]++;
  }
  return questions;
}

function QuizTab({ words, groups, groupCounts, wrongCounts, markAnswer }) {
  const [phase, setPhase] = useState("setup");
  const [mode, setMode] = useState("mc");
  const [count, setCount] = useState(10);
  const [groupFilter, setGroupFilter] = useState([]);
  const [wrongThreshold, setWrongThreshold] = useState(2);
  const [treeExpanded, setTreeExpanded] = useState(new Set());
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [wrongWords, setWrongWords] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [selected, setSelected] = useState(null);
  const [typed, setTyped] = useState("");
  const [flipped, setFlipped] = useState(false);
  const [synAnswer, setSynAnswer] = useState("");
  const [synResult, setSynResult] = useState(null);

  const toggleTreeExpand = (p) => setTreeExpanded(prev => { const s = new Set(prev); s.has(p) ? s.delete(p) : s.add(p); return s; });
  const tree = buildTree(groups);
  const favoriteCount = words.filter(w => w.favorite).length;
  const wrongFolderCount = words.filter(w => (wrongCounts?.[w.id] || 0) >= wrongThreshold).length;
  const collocationWordCount = words.filter(hasCollocation).length;

  const matchFilter = (g, w) => g === UNGROUPED ? !w.group
    : g === "__favorites__" ? !!w.favorite
      : g === "__wrong__" ? (wrongCounts?.[w.id] || 0) >= wrongThreshold
        : g === "__collocation__" ? hasCollocation(w)
          : (w.group === g || (w.group || "").startsWith(g + "/"));
  const effectiveWords = groupFilter.length === 0 ? words : words.filter(w => groupFilter.some(g => matchFilter(g, w)));

  if (words.length < 4) {
    return (
      <div className="empty-state">
        <Layers size={34} />
        <div>퀴즈를 시작하려면 단어를 4개 이상 등록해주세요.<br />현재 {words.length}개</div>
      </div>
    );
  }

  const patternsPool = effectiveWords.flatMap(w => w.senses.flatMap(s => (s.patterns || []).map(p => ({ ...p, word: w, sense: s }))));
  const senseItems = effectiveWords.flatMap(w => w.senses.map(s => ({ word: w, sense: s })));
  const synonymSenseItems = effectiveWords.flatMap(w => w.senses.filter(s => (s.synonyms || []).length > 0).map(s => ({ word: w, sense: s })));
  const collocationOk = patternsPool.length >= 3;
  const synonymOk = synonymSenseItems.length >= 2;
  const toggleGroup = (g) => setGroupFilter(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);

  const modeMax = mode === "collocation" ? patternsPool.length
    : mode === "synonym" ? synonymSenseItems.length
      : mode === "flash" || mode === "mix" ? effectiveWords.length
        : senseItems.length;
  const boundedCount = Math.max(1, Math.min(count, modeMax || 1));

  const start = () => {
    setQueue(buildSession(mode, boundedCount, effectiveWords, senseItems, patternsPool, synonymSenseItems));
    setIdx(0); setScore(0); setWrongWords([]); setFeedback(null); setSelected(null); setTyped(""); setFlipped(false); setSynAnswer(""); setSynResult(null);
    setPhase("running");
  };

  const current = queue[idx];

  const next = () => {
    setFeedback(null); setSelected(null); setTyped(""); setFlipped(false); setSynAnswer(""); setSynResult(null);
    if (idx + 1 >= queue.length) setPhase("done");
    else setIdx(idx + 1);
  };

  const answerMc = (opt) => {
    if (feedback) return;
    const ok = opt === current.correct;
    setSelected(opt); setFeedback(ok ? "correct" : "wrong");
    markAnswer(current.word.id, ok, "meaning");
    if (ok) setScore(s => s + 1); else setWrongWords(w => [...w, current.word]);
  };

  const answerCollocation = (opt) => {
    if (feedback) return;
    const ok = opt.toLowerCase() === current.correct.toLowerCase();
    setSelected(opt); setFeedback(ok ? "correct" : "wrong");
    markAnswer(current.word.id, ok, "collocation");
    if (ok) setScore(s => s + 1); else setWrongWords(w => [...w, current.word]);
  };

  const answerTyping = () => {
    if (feedback) return;
    const accepted = current.word.english.split(/[\/,]/).map(s => s.trim().toLowerCase());
    const ok = accepted.includes(typed.trim().toLowerCase());
    setFeedback(ok ? "correct" : "wrong");
    markAnswer(current.word.id, ok, "spelling");
    if (ok) setScore(s => s + 1); else setWrongWords(w => [...w, current.word]);
  };

  const answerPosMeaning = () => {
    if (feedback) return;
    const accepted = current.sense.korean.split(",").map(s => s.trim());
    const ok = accepted.some(a => a === typed.trim());
    setFeedback(ok ? "correct" : "wrong");
    markAnswer(current.word.id, ok, "meaning");
    if (ok) setScore(s => s + 1); else setWrongWords(w => [...w, current.word]);
  };

  const answerFlash = (know) => {
    if (feedback) return;
    setFeedback(know ? "correct" : "wrong");
    markAnswer(current.word.id, know, "other");
    if (know) setScore(s => s + 1); else setWrongWords(w => [...w, current.word]);
  };

  const answerSynonym = () => {
    if (feedback || !synAnswer.trim()) return;
    const entries = [...new Set(synAnswer.split(/[,\n]/).map(s => s.trim()).filter(Boolean))];
    const submittedLower = new Set(entries.map(e => e.toLowerCase()));
    const accepted = current.blank.accepted;
    const found = accepted.filter(a => submittedLower.has(a.toLowerCase()));
    const missed = accepted.filter(a => !submittedLower.has(a.toLowerCase()));
    const extra = entries.filter(e => !accepted.some(a => a.toLowerCase() === e.toLowerCase()));
    const ok = missed.length === 0;
    setSynResult({ found, missed, extra });
    setFeedback(ok ? "correct" : "wrong");
    markAnswer(current.word.id, ok, "meaning");
    if (ok) setScore(s => s + 1); else setWrongWords(w => [...w, current.word]);
  };

  if (phase === "setup") {
    return (
      <div>
        <div className="section-title"><Layers size={18} /> 퀴즈</div>
        <p className="section-sub">범위, 유형, 문제 수를 선택하고 시작하세요.</p>

        <div className="field">
          <label>범위 선택 (선택 안 하면 전체)</label>
          <div className="folder-list">
            <button className={`folder-row ${groupFilter.includes("__favorites__") ? "selected" : ""}`} onClick={() => toggleGroup("__favorites__")}>
              <span className="folder-chevron-spacer" />
              <Star size={14} color="#E3A730" fill={favoriteCount > 0 ? "#E3A730" : "none"} style={{ flexShrink: 0 }} />
              <span className="folder-name">즐겨찾기</span>
              <span className="folder-count">{favoriteCount}개</span>
              {groupFilter.includes("__favorites__") && <Check size={15} color="var(--blue-ink)" />}
            </button>
            <button className={`folder-row ${groupFilter.includes("__wrong__") ? "selected" : ""}`} onClick={() => toggleGroup("__wrong__")}>
              <span className="folder-chevron-spacer" />
              <XCircle size={14} color="var(--red-ink)" style={{ flexShrink: 0 }} />
              <span className="folder-name">틀린 항목</span>
              <span className="folder-count">{wrongFolderCount}개</span>
              {groupFilter.includes("__wrong__") && <Check size={15} color="var(--blue-ink)" />}
            </button>
            <button className={`folder-row ${groupFilter.includes("__collocation__") ? "selected" : ""}`} onClick={() => toggleGroup("__collocation__")}>
              <span className="folder-chevron-spacer" />
              <Link2 size={14} color="var(--coral-ink)" style={{ flexShrink: 0 }} />
              <span className="folder-name">콜로케이션</span>
              <span className="folder-count">{collocationWordCount}개</span>
              {groupFilter.includes("__collocation__") && <Check size={15} color="var(--blue-ink)" />}
            </button>
            {words.some(w => !w.group) && (
              <button className={`folder-row ${groupFilter.includes(UNGROUPED) ? "selected" : ""}`} onClick={() => toggleGroup(UNGROUPED)}>
                <span className="folder-chevron-spacer" />
                <span className="folder-dot" style={{ background: "#B9C2CF" }} />
                <span className="folder-name">미분류</span>
                <span className="folder-count">{groupCounts?.[""] || 0}개</span>
                {groupFilter.includes(UNGROUPED) && <Check size={15} color="var(--blue-ink)" />}
              </button>
            )}
            <FolderTreeRows nodes={tree} depth={0} expanded={expandedFromCollapsed(groups, treeExpanded)} toggleExpand={toggleTreeExpand} isSelected={p => groupFilter.includes(p)} onToggle={toggleGroup} counts={groupCounts || {}} />
          </div>
          {groupFilter.includes("__wrong__") && (
            <div className="chip-row" style={{ marginTop: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-soft)", alignSelf: "center" }}>기준</span>
              {[1, 2, 3, 5].map(n => (
                <button key={n} className={`chip ${wrongThreshold === n ? "selected" : ""}`} onClick={() => setWrongThreshold(n)}>{n}번 이상</button>
              ))}
            </div>
          )}
        </div>
        {effectiveWords.length < 4 && (
          <div style={{ color: "var(--red-ink)", fontSize: 12.5, marginBottom: 12, fontWeight: 600 }}>선택한 범위에 단어가 너무 적어요 (현재 {effectiveWords.length}개, 최소 4개 필요).</div>
        )}

        <div className="field"><label>유형</label></div>
        <div className="mode-grid">
          {[
            ["mc", "객관식", "4지선다", true],
            ["typing", "타이핑", "뜻 보고 영어 입력", true],
            ["posmeaning", "품사별 뜻 쓰기", "동사/명사 뜻 구분해서 쓰기", true],
            ["flash", "플래시카드", "뒤집어서 확인", true],
            ["collocation", "전치사 빈칸", collocationOk ? "패턴 채우기" : "패턴 데이터 부족", collocationOk],
            ["synonym", "유의어 전부 쓰기", synonymOk ? "빈칸 채우고 유의어 모두 쓰기" : "유의어 데이터 부족", synonymOk],
            ["mix", "랜덤 믹스", "가능한 유형 섞어서", true],
          ].map(([v, label, desc, ok]) => (
            <button key={v} className={`mode-card ${mode === v ? "selected" : ""}`} disabled={!ok} onClick={() => ok && setMode(v)}>
              {label}<span>{desc}</span>
            </button>
          ))}
        </div>
        <div className="field">
          <label>문제 수</label>
          <select value={boundedCount} onChange={e => setCount(Number(e.target.value))}>
            {[5, 10, 15, modeMax].filter((v, i, a) => v > 0 && a.indexOf(v) === i && v <= modeMax).sort((a, b) => a - b).map(n => (
              <option key={n} value={n}>{n === modeMax ? `전체 (${n})` : n}</option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary btn-full" disabled={effectiveWords.length < 4 || modeMax < 1} onClick={start}><Sparkles size={16} /> 퀴즈 시작</button>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div>
        <div className="section-title"><CheckCircle2 size={18} color="var(--green-ink)" /> 결과</div>
        <div className="score-ring">{score} / {queue.length}</div>
        <p style={{ textAlign: "center", color: "var(--ink-soft)", fontSize: 13, fontWeight: 600 }}>{Math.round((score / queue.length) * 100)}% 정답</p>
        {wrongWords.length > 0 && (
          <div className="review-list">
            <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>다시 볼 단어</div>
            {wrongWords.map((w, i) => (
              <div className="word-row" key={i} style={{ padding: "6px 0" }}>
                <div className="word-row-top">
                  <div className="word-main">
                    <div className="word-eng" onClick={() => speak(w.english)}><SpeakerBtn text={w.english} />{w.english}</div>
                    <div className="word-kor">{w.senses[0]?.korean}</div>
                  </div>
                  <PosBadge pos={w.senses[0]?.pos} />
                  {wrongCounts?.[w.id] > 0 && <span className="wrong-badge">✕ {wrongCounts[w.id]}번</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setPhase("setup")}>다시 설정</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={start}><RotateCcw size={15} /> 다시 풀기</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="quiz-progress"><span>{idx + 1} / {queue.length}</span><span>맞은 개수 {score}</span></div>

      {current.type === "mc" && (
        <>
          <div className="quiz-card" style={{ position: "relative" }}>
            {feedback === "correct" && <div className="stamp">참 잘했어요<Sparkles size={13} /></div>}
            <div className="quiz-prompt">{current.direction === "e2k" ? "이 단어의 뜻은?" : "이 뜻에 맞는 단어는?"}</div>
            <div className="quiz-main">
              {current.direction === "e2k" && <SpeakerBtn text={current.word.english} size={19} />}
              {current.direction === "e2k" ? current.word.english : current.sense.korean}
              <PosBadge pos={current.sense.pos} />
            </div>
          </div>
          <div className="mc-options">
            {current.options.map((opt, i) => (
              <button key={i} className={`mc-opt ${feedback ? (opt === current.correct ? "correct" : (opt === selected ? "wrong" : "")) : ""}`} onClick={() => answerMc(opt)}>{opt}</button>
            ))}
          </div>
        </>
      )}

      {current.type === "collocation" && (
        <>
          <div className="quiz-card" style={{ position: "relative" }}>
            {feedback === "correct" && <div className="stamp">참 잘했어요<Sparkles size={13} /></div>}
            <div className="quiz-prompt">빈칸에 들어갈 알맞은 말을 고르세요</div>
            <div className="quiz-main">{current.template.split("___")[0]}<span className="blank">____</span>{current.template.split("___")[1]}</div>
            <div className="word-kor">{current.korean}</div>
          </div>
          <div className="mc-options">
            {current.options.map((opt, i) => (
              <button key={i} className={`mc-opt ${feedback ? (opt.toLowerCase() === current.correct.toLowerCase() ? "correct" : (opt === selected ? "wrong" : "")) : ""}`} onClick={() => answerCollocation(opt)}>{opt}</button>
            ))}
          </div>
        </>
      )}

      {current.type === "synonym" && (
        <>
          <div className="quiz-card" style={{ position: "relative" }}>
            {feedback === "correct" && <div className="stamp">참 잘했어요<Sparkles size={13} /></div>}
            <div className="quiz-prompt">빈칸에 들어갈 수 있는 표현을 전부 쓰세요 (정답 {current.blank.accepted.length}개)</div>
            <div className="quiz-main">
              {current.blank.prefix}<span className="blank">{" ____ "}</span>{current.blank.suffix}
            </div>
            <div className="word-kor">{current.blank.korean}</div>
          </div>
          <textarea className="syn-answer" placeholder="쉼표(,) 또는 줄바꿈으로 구분해서 입력" value={synAnswer} disabled={!!feedback} onChange={e => setSynAnswer(e.target.value)} />
          {!feedback && <button className="btn btn-secondary btn-full" disabled={!synAnswer.trim()} onClick={answerSynonym}>확인</button>}
          {feedback && synResult && (
            <div className="review-list" style={{ marginBottom: 10 }}>
              {synResult.found.map((f, i) => <div key={"f" + i} className="syn-result-item" style={{ color: "var(--green-ink)" }}><CheckCircle2 size={14} />{f}</div>)}
              {synResult.missed.map((f, i) => <div key={"m" + i} className="syn-result-item" style={{ color: "var(--red-ink)" }}><XCircle size={14} />{f} (놓침)</div>)}
              {synResult.extra.map((f, i) => <div key={"e" + i} className="syn-result-item" style={{ color: "var(--ink-soft)", fontWeight: 500 }}><X size={14} />{f} (정답 아님)</div>)}
            </div>
          )}
        </>
      )}

      {current.type === "typing" && (
        <>
          <div className="quiz-card" style={{ position: "relative" }}>
            {feedback === "correct" && <div className="stamp">참 잘했어요<Sparkles size={13} /></div>}
            <div className="quiz-prompt">이 뜻에 맞는 영어 단어를 입력하세요</div>
            <div className="quiz-main">{current.sense.korean}<PosBadge pos={current.sense.pos} /></div>
          </div>
          <input style={{ width: "100%", padding: "12px 14px", border: "1.5px solid var(--line)", borderRadius: 12, fontSize: 15, marginBottom: 10 }}
            placeholder="영어로 입력..." value={typed} disabled={!!feedback}
            onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === "Enter") answerTyping(); }} />
          {feedback && (
            <div style={{ fontSize: 13, marginBottom: 10, color: feedback === "correct" ? "var(--green-ink)" : "var(--red-ink)", fontWeight: 800, display: "flex", alignItems: "center", gap: 6 }}>
              {feedback === "correct" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {feedback === "correct" ? "정답이에요!" : `정답: ${current.word.english}`}
              <SpeakerBtn text={current.word.english} />
            </div>
          )}
          {!feedback && <button className="btn btn-secondary btn-full" disabled={!typed.trim()} onClick={answerTyping}>확인</button>}
        </>
      )}

      {current.type === "posmeaning" && (
        <>
          <div className="quiz-card" style={{ position: "relative" }}>
            {feedback === "correct" && <div className="stamp">참 잘했어요<Sparkles size={13} /></div>}
            <div className="quiz-prompt">{current.sense.pos ? `${current.sense.pos}의 뜻을 쓰세요` : "이 단어의 뜻을 쓰세요"}</div>
            <div className="quiz-main"><SpeakerBtn text={current.word.english} size={19} />{current.word.english}<PosBadge pos={current.sense.pos} /></div>
          </div>
          <input style={{ width: "100%", padding: "12px 14px", border: "1.5px solid var(--line)", borderRadius: 12, fontSize: 15, marginBottom: 10 }}
            placeholder="한글 뜻 입력..." value={typed} disabled={!!feedback}
            onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === "Enter") answerPosMeaning(); }} />
          {feedback && (
            <div style={{ fontSize: 13, marginBottom: 10, color: feedback === "correct" ? "var(--green-ink)" : "var(--red-ink)", fontWeight: 800, display: "flex", alignItems: "center", gap: 6 }}>
              {feedback === "correct" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {feedback === "correct" ? "정답이에요!" : `정답: ${current.sense.korean}`}
            </div>
          )}
          {!feedback && <button className="btn btn-secondary btn-full" disabled={!typed.trim()} onClick={answerPosMeaning}>확인</button>}
        </>
      )}

      {current.type === "flash" && (
        <div className="flip-card" onClick={() => !feedback && setFlipped(f => !f)}>
          <div className={`flip-inner ${flipped ? "flipped" : ""}`}>
            <div className="flip-face">
              <div className="quiz-prompt">{flipped ? "" : "탭해서 뒤집기"}</div>
              <div className="quiz-main">{current.frontIsEnglish && <SpeakerBtn text={current.word.english} size={19} />}{current.frontIsEnglish ? current.word.english : current.word.senses[0]?.korean}</div>
            </div>
            <div className="flip-face flip-back">
              <SpeakerBtn text={current.word.english} size={19} />
              <div className="quiz-main">{current.word.english}</div>
              <div className="browse-detail"><SenseList senses={current.word.senses} /></div>
            </div>
          </div>
        </div>
      )}
      {current.type === "flash" && flipped && !feedback && (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => answerFlash(false)}><XCircle size={15} /> 모른다</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => answerFlash(true)}><CheckCircle2 size={15} /> 안다</button>
        </div>
      )}

      {feedback && current.type !== "flash" && (
        <button className="btn btn-secondary btn-full" style={{ marginTop: 10 }} onClick={next}>다음 <ChevronRight size={15} /></button>
      )}
      {feedback && current.type === "flash" && (
        <button className="btn btn-secondary btn-full" style={{ marginTop: 12 }} onClick={next}>다음 <ChevronRight size={15} /></button>
      )}
    </div>
  );
}
