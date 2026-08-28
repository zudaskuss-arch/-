import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Stethoscope, Type, Plus, Layers, Search, Star, XCircle, Check, X,
  ChevronDown, ChevronRight, ChevronLeft, Trash2, Pencil, Sparkles, CheckCircle2,
  Folder, LayoutGrid, List as ListIcon, Link2,
} from "lucide-react";
import { getItem, setItem } from "./lib/storage";
import {
  genId, shuffle, speak,
  buildTree, expandedFromCollapsed, ancestorsOf,
  FolderColorsContext, FolderTreeRows, GroupPicker, GroupField, ManageGroupsTab,
  GroupBadge, SpeakerBtn,
} from "./VocabApp";

const UNGROUPED = "미분류";
const hasFullTerm = (t) => t.senses.some(s => (s.fullTerm || "").trim());

const MED_FORMAT_PROMPT = `아래 의학용어 학습 자료(사진 또는 텍스트)를 정리해줘. 설명이나 다른 텍스트 없이, 아래 형식의 줄들만 자료에 나온 순서대로 출력해줘.

형식 (하나의 뜻마다 한 줄):
용어또는약어|한글뜻|유의어|풀텀

- 용어또는약어: 원형 그대로 (약어면 약어 그대로, 예: MI, COPD)
- 한글뜻: 그 뜻 (여러 뜻이면 콤마로 연결)
- 유의어: 동의/유사 표현이 있으면 쉼표(,)로 구분해서 적기, 없으면 비워두기
- 풀텀: 약어일 경우 그 약어의 전체 표현(full term)을 적기 (예: MI → Myocardial Infarction). 약어가 아니면 비워두기

규칙:
1. 같은 용어가 여러 뜻을 가지면, 한 줄로 합치지 말고 뜻마다 줄을 따로 만들어줘 (용어는 그대로 반복)
2. 약어가 아닌 일반 의학 용어는 풀텀 칸을 비워둬도 돼

예시:
입력: "MI 심근경색"
출력:
MI|심근경색||Myocardial Infarction

입력: "COPD 만성폐쇄성폐질환 = chronic obstructive pulmonary disease"
출력:
COPD|만성폐쇄성폐질환|chronic obstructive pulmonary disease|Chronic Obstructive Pulmonary Disease

입력: "hypertension 고혈압"
출력:
hypertension|고혈압||

이제 아래 자료를 이 형식으로 정리해줘 (사진을 올리거나 텍스트를 붙여넣어서 이어서 물어보세요):`;

function makeMedSense(partial = {}) {
  return { id: genId(), korean: "", synonyms: [], fullTerm: "", ...partial };
}

function migrateMedTerm(t) {
  const senses = Array.isArray(t.senses) && t.senses.length > 0
    ? t.senses.map(s => makeMedSense({ korean: s.korean || "", synonyms: s.synonyms || [], fullTerm: s.fullTerm || "" }))
    : [makeMedSense()];
  return { id: t.id || genId(), term: t.term || "", group: t.group || "", favorite: !!t.favorite, senses };
}

function parseMedFormattedText(text) {
  const lines = text.split(/\r?\n/);
  const byKey = new Map();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || !line.includes("|")) continue;
    const [termRaw, koreanRaw = "", synRaw = "", fullTermRaw = ""] = line.split("|");
    const term = (termRaw || "").trim();
    const korean = (koreanRaw || "").trim();
    if (!term || !korean) continue;
    const synonyms = (synRaw || "").split(",").map(s => s.trim()).filter(Boolean);
    const key = term.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { id: genId(), term, group: "", senses: [] });
    byKey.get(key).senses.push(makeMedSense({ korean, synonyms, fullTerm: (fullTermRaw || "").trim() }));
  }
  return [...byKey.values()];
}

function MedSenseEditor({ sense, onChange, onRemove, canRemove }) {
  const set = (patch) => onChange({ ...sense, ...patch });
  return (
    <div className="sense-card">
      <div className="sense-row">
        <input value={sense.korean} onChange={e => set({ korean: e.target.value })} placeholder="뜻" />
        {canRemove && <button className="icon-btn danger" onClick={onRemove} aria-label="이 뜻 삭제"><Trash2 size={14} /></button>}
      </div>
      <input className="sense-syn-input" value={(sense.synonyms || []).join(", ")} placeholder="유의어 (쉼표로 구분, 선택)"
        onChange={e => set({ synonyms: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} />
      <input className="sense-syn-input" style={{ marginTop: 6 }} value={sense.fullTerm || ""} placeholder="풀텀 (약어인 경우 전체 표현, 예: Myocardial Infarction)"
        onChange={e => set({ fullTerm: e.target.value })} />
    </div>
  );
}

function MedSenseList({ senses }) {
  return (
    <div className="sense-list-display">
      {senses.map((s, idx) => (
        <div key={s.id || idx} className="sense-detail-block">
          <div className="sense-detail-head"><span className="sense-detail-kor">{s.korean}</span></div>
          {s.synonyms && s.synonyms.length > 0 && (
            <div>
              <span style={{ fontWeight: 800, color: "var(--ink)", fontSize: 12 }}>유의어</span>{" "}
              {s.synonyms.map((x, i) => <span key={i} className="syn-chip">{x}</span>)}
            </div>
          )}
          {s.fullTerm && <div className="pattern-line">풀텀: <b>{s.fullTerm}</b></div>}
        </div>
      ))}
    </div>
  );
}

const MED_MISTAKE_LABELS = { spelling: "용어", meaning: "뜻", other: "기타" };
function MedMistakeBreakdown({ detail }) {
  if (!detail) return null;
  const entries = ["spelling", "meaning", "other"].filter(k => detail[k] > 0);
  if (entries.length === 0) return null;
  return (
    <div className="mistake-row">
      {entries.map(k => <span key={k} className="mistake-chip">{MED_MISTAKE_LABELS[k]} {detail[k]}번</span>)}
    </div>
  );
}

function MedEditRow({ term, groups, onSave, onCancel }) {
  const [text, setText] = useState(term.term);
  const [grp, setGrp] = useState(term.group || "");
  const [senses, setSenses] = useState(term.senses.map(s => ({ ...s, synonyms: [...(s.synonyms || [])] })));

  const updateSense = (idx, next) => setSenses(senses.map((s, i) => i === idx ? next : s));
  const addSense = () => setSenses([...senses, makeMedSense()]);
  const removeSense = (idx) => setSenses(senses.filter((_, i) => i !== idx));
  const save = () => onSave({ term: text, group: grp.trim(), senses });

  return (
    <div style={{ padding: "10px 0", borderBottom: "1px dashed var(--line)" }}>
      <div className="pending-row-single">
        <input value={text} onChange={ev => setText(ev.target.value)} placeholder="용어/약어" />
        <div style={{ display: "flex", gap: 4 }}>
          <button className="icon-btn" onClick={save} aria-label="저장"><Check size={16} color="var(--green-ink)" /></button>
          <button className="icon-btn" onClick={onCancel} aria-label="취소"><X size={16} /></button>
        </div>
      </div>
      <div style={{ marginBottom: 8 }}><GroupField value={grp} onChange={setGrp} groups={groups} /></div>
      {senses.map((s, idx) => (
        <MedSenseEditor key={s.id} sense={s} canRemove={senses.length > 1} onChange={next => updateSense(idx, next)} onRemove={() => removeSense(idx)} />
      ))}
      <button className="pending-toggle" onClick={addSense}><Plus size={12} /> 다른 뜻 추가</button>
    </div>
  );
}

function MedAddTab({ addTerms, showToast, groups, groupCounts, activeGroup, setActiveGroup, addFolder }) {
  const [text, setText] = useState("");
  const [senses, setSenses] = useState(() => [makeMedSense()]);

  const updateSense = (idx, next) => setSenses(senses.map((s, i) => i === idx ? next : s));
  const addSense = () => setSenses([...senses, makeMedSense()]);
  const removeSense = (idx) => setSenses(senses.filter((_, i) => i !== idx));

  const submit = () => {
    const n = addTerms([{ term: text, group: activeGroup, senses }]);
    if (n > 0) {
      showToast(`"${activeGroup || "미분류"}"에 용어를 추가했어요`);
      setText(""); setSenses([makeMedSense()]);
    }
  };

  const canSubmit = text.trim() && senses.some(s => s.korean.trim());

  return (
    <div>
      <div className="section-title"><Plus size={18} /> 직접 추가</div>
      <p className="section-sub">용어(또는 약어)와 뜻을 입력하세요. 약어면 풀텀도 적어주세요.</p>
      <GroupPicker groups={groups} value={activeGroup} onChange={setActiveGroup} counts={groupCounts} onCreateFolder={addFolder} />
      <div className="field"><label>용어 / 약어</label><input value={text} onChange={e => setText(e.target.value)} placeholder="예: MI" /></div>
      <div className="field">
        <label>뜻 (여러 개 추가 가능)</label>
        {senses.map((s, idx) => (
          <MedSenseEditor key={s.id} sense={s} canRemove={senses.length > 1} onChange={next => updateSense(idx, next)} onRemove={() => removeSense(idx)} />
        ))}
        <button className="btn btn-outline btn-full" onClick={addSense}><Plus size={14} /> 다른 뜻 추가</button>
      </div>
      <button className="btn btn-primary btn-full" disabled={!canSubmit} onClick={submit}><Plus size={16} /> 추가</button>
    </div>
  );
}

function MedInsertRowButton({ onClick }) {
  return (
    <button type="button" className="insert-row-btn" onClick={onClick} aria-label="여기에 새 용어 추가">
      <Plus size={12} /> 여기에 용어 추가
    </button>
  );
}

function MedPendingCard({ item, onChange, onRemove }) {
  const set = (patch) => onChange({ ...item, ...patch });
  const updateSense = (idx, next) => set({ senses: item.senses.map((s, i) => i === idx ? next : s) });
  const addSense = () => set({ senses: [...item.senses, makeMedSense()] });
  const removeSense = (idx) => set({ senses: item.senses.filter((_, i) => i !== idx) });
  return (
    <div className="pending-card">
      <div className="pending-row-single">
        <input value={item.term} placeholder="용어/약어" onChange={e => set({ term: e.target.value })} />
        <button className="icon-btn danger" onClick={onRemove} aria-label="항목 삭제"><Trash2 size={15} /></button>
      </div>
      {item.senses.map((s, idx) => (
        <MedSenseEditor key={s.id} sense={s} canRemove={item.senses.length > 1} onChange={next => updateSense(idx, next)} onRemove={() => removeSense(idx)} />
      ))}
      <button className="pending-toggle" onClick={addSense}><Plus size={12} /> 뜻 추가</button>
    </div>
  );
}

function MedImportTab({ addTerms, showToast, goList, groups, groupCounts, activeGroup, setActiveGroup, addFolder }) {
  const [subMode, setSubMode] = useState("format");
  const [formattedText, setFormattedText] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(null);
  const [promptCopied, setPromptCopied] = useState(false);

  const runFormatParse = () => {
    if (!formattedText.trim()) return;
    setError("");
    const items = parseMedFormattedText(formattedText);
    if (items.length === 0) {
      setError(`형식에 맞는 줄을 찾지 못했어요. "용어|한글뜻|유의어|풀텀" 형식인지 확인해주세요.`);
      return;
    }
    setPending(items);
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(MED_FORMAT_PROMPT);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1800);
    } catch {
      setError("클립보드 복사에 실패했어요. 아래 프롬프트를 직접 선택해서 복사해주세요.");
    }
  };

  const updatePending = (id, next) => setPending(pending.map(p => p.id === id ? next : p));
  const removePending = (id) => setPending(pending.filter(p => p.id !== id));
  const addRow = (atIndex) => {
    const newItem = { id: genId(), term: "", group: "", senses: [makeMedSense()] };
    setPending(prev => {
      const idx = atIndex === undefined ? prev.length : atIndex;
      const next = [...prev];
      next.splice(idx, 0, newItem);
      return next;
    });
  };

  const save = () => {
    const n = addTerms(pending.map(p => ({ ...p, group: activeGroup })));
    if (n > 0) {
      showToast(`"${activeGroup || "미분류"}"에 ${n}개 용어를 추가했어요`);
      setPending(null); setError(""); setFormattedText("");
      goList();
    } else {
      setError("저장할 용어가 없어요. 용어와 한글 뜻을 모두 입력해 주세요.");
    }
  };

  return (
    <div>
      <div className="section-title"><Type size={18} /> 가져오기</div>
      <p className="section-sub">텍스트를 붙여넣거나 직접 입력해서 용어를 추가하세요.</p>

      {!pending && (
        <div className="submode-row">
          <button className={`submode-btn ${subMode === "format" ? "active" : ""}`} onClick={() => setSubMode("format")}><Sparkles size={14} /> AI 텍스트</button>
          <button className={`submode-btn ${subMode === "manual" ? "active" : ""}`} onClick={() => setSubMode("manual")}><Plus size={14} /> 직접 입력</button>
        </div>
      )}

      {subMode === "manual" && !pending ? (
        <MedAddTab addTerms={addTerms} showToast={showToast} groups={groups} groupCounts={groupCounts} activeGroup={activeGroup} setActiveGroup={setActiveGroup} addFolder={addFolder} />
      ) : (
        <>
          <GroupPicker groups={groups} value={activeGroup} onChange={setActiveGroup} counts={groupCounts} onCreateFolder={addFolder} />

          {!pending && subMode === "format" && (
            <>
              <div className="format-help">
                <div style={{ fontWeight: 800, marginBottom: 6 }}>AI로 정리해서 가져오기</div>
                <p style={{ margin: "0 0 8px" }}>의학용어 자료(사진 또는 텍스트)를 아무 AI 챗봇에 올리고 아래 프롬프트를 이어서 붙여넣어 정리를 부탁하세요. 그 결과를 아래 칸에 붙여넣으면 바로 저장돼요.</p>
                <textarea className="paste-area format-prompt-box" readOnly value={MED_FORMAT_PROMPT} onFocus={e => e.target.select()} />
                <button type="button" className="btn btn-outline" style={{ marginTop: 8 }} onClick={copyPrompt}>
                  <Sparkles size={14} /> {promptCopied ? "복사됐어요!" : "프롬프트 복사하기"}
                </button>
                <div className="field-hint" style={{ marginTop: 8 }}>형식: <code>용어또는약어|한글뜻|유의어|풀텀</code> — 한 줄에 하나씩</div>
              </div>
              <textarea className="paste-area" value={formattedText} onChange={e => setFormattedText(e.target.value)}
                placeholder={`MI|심근경색||Myocardial Infarction\nCOPD|만성폐쇄성폐질환|chronic obstructive pulmonary disease|Chronic Obstructive Pulmonary Disease\nhypertension|고혈압||`} />
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
              <MedInsertRowButton onClick={() => addRow(0)} />
              {pending.map((p, idx) => (
                <React.Fragment key={p.id}>
                  <MedPendingCard item={p} onChange={(next) => updatePending(p.id, next)} onRemove={() => removePending(p.id)} />
                  <MedInsertRowButton onClick={() => addRow(idx + 1)} />
                </React.Fragment>
              ))}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-outline" onClick={() => { setPending(null); setError(""); }}>다시 시도</button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={save}><Check size={16} /> 저장</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MedBulkMoveModal({ groups, counts, onCreateFolder, onConfirm, onClose }) {
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

function MedBrowseCards({ terms, toggleFavorite }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [frontMode, setFrontMode] = useState("term");
  const i = Math.min(idx, terms.length - 1);
  const term = terms[i];

  const go = (delta) => { setFlipped(false); setIdx(v => Math.max(0, Math.min(terms.length - 1, v + delta))); };

  if (!term) return null;
  const frontIsTerm = frontMode === "term";
  const frontText = frontIsTerm ? term.term : term.senses[0]?.korean;

  return (
    <div>
      <div className="browse-controls">
        <div className="view-toggle">
          <button className={frontMode === "term" ? "active" : ""} onClick={() => { setFrontMode("term"); setFlipped(false); }}>용어 먼저</button>
          <button className={frontMode === "kr" ? "active" : ""} onClick={() => { setFrontMode("kr"); setFlipped(false); }}>한글 먼저</button>
        </div>
        <div className="browse-progress">{i + 1} / {terms.length}</div>
      </div>
      <div className={`browse-card ${flipped ? "flipped" : ""}`} onClick={() => setFlipped(f => !f)}>
        <button className="browse-star" onClick={(e) => { e.stopPropagation(); toggleFavorite(term.id); }} aria-label="즐겨찾기">
          <Star size={20} color="#E3A730" fill={term.favorite ? "#E3A730" : "none"} />
        </button>
        {!flipped ? (
          <>
            {frontIsTerm && <SpeakerBtn text={term.term} size={20} />}
            <div className="browse-main">{frontText}</div>
            <div style={{ fontSize: 11, color: "var(--ink-soft)", fontWeight: 700 }}>탭해서 뜻 보기</div>
          </>
        ) : (
          <>
            <SpeakerBtn text={term.term} size={20} />
            <div className="browse-main">{term.term}</div>
            <div className="browse-detail"><MedSenseList senses={term.senses} /></div>
          </>
        )}
      </div>
      <div className="browse-nav" style={{ justifyContent: "center", marginTop: 12 }}>
        <button onClick={() => go(-1)} disabled={i === 0}><ChevronLeft size={16} /></button>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => go(1)} disabled={i === terms.length - 1}>다음 카드 <ChevronRight size={15} /></button>
      </div>
    </div>
  );
}

function MedListTab({ terms, groups, groupCounts, wrongCounts, wrongDetails, updateTerm, deleteTerm, bulkMoveTerms, bulkDeleteTerms, toggleFavorite, clearWrong, addFolder, showToast }) {
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
    bulkMoveTerms(selectedIds, path);
    showToast && showToast(`${selectedIds.size}개 용어를 "${path || "미분류"}"로 옮겼어요`);
    setShowMoveModal(false);
    exitSelectMode();
  };
  const applyBulkDelete = () => {
    bulkDeleteTerms(selectedIds);
    showToast && showToast(`${selectedIds.size}개 용어를 삭제했어요`);
    exitSelectMode();
  };

  const toggleTreeExpand = (p) => setTreeExpanded(prev => { const s = new Set(prev); s.has(p) ? s.delete(p) : s.add(p); return s; });
  const tree = buildTree(groups);
  const favoriteCount = terms.filter(t => t.favorite).length;
  const wrongFolderCount = terms.filter(t => (wrongCounts?.[t.id] || 0) >= wrongThreshold).length;
  const fullTermCount = terms.filter(hasFullTerm).length;

  const filtered = terms.filter(t => {
    const matchQ = (t.term + " " + t.senses.map(s => s.korean).join(" ")).toLowerCase().includes(q.toLowerCase());
    const matchG = selectedFolder === null ? true
      : selectedFolder === "__favorites__" ? !!t.favorite
        : selectedFolder === "__wrong__" ? (wrongCounts?.[t.id] || 0) >= wrongThreshold
          : selectedFolder === "__fullterm__" ? hasFullTerm(t)
            : selectedFolder === "" ? !t.group
              : (t.group === selectedFolder || (t.group || "").startsWith(selectedFolder + "/"));
    return matchQ && matchG;
  });
  const sortedFiltered = selectedFolder === "__wrong__" ? [...filtered].sort((a, b) => (wrongCounts?.[b.id] || 0) - (wrongCounts?.[a.id] || 0)) : filtered;

  return (
    <div>
      <div className="section-title"><Stethoscope size={18} /> 의학용어</div>
      <p className="section-sub">용어를 누르면 발음을 들을 수 있어요. 별표를 누르면 즐겨찾기에 담겨요.</p>
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
            <span className="folder-dot" style={{ background: "linear-gradient(135deg, var(--teal), var(--blue))" }} />
            <span className="folder-name">전체</span>
            <span className="folder-count">{terms.length}개</span>
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
          <button className={`folder-row ${selectedFolder === "__fullterm__" ? "selected" : ""}`} onClick={() => setSelectedFolder("__fullterm__")}>
            <span className="folder-chevron-spacer" />
            <Link2 size={14} color="var(--teal-ink)" style={{ flexShrink: 0 }} />
            <span className="folder-name">풀텀</span>
            <span className="folder-count">{fullTermCount}개</span>
            {selectedFolder === "__fullterm__" && <Check size={15} color="var(--blue-ink)" />}
          </button>
          {terms.some(t => !t.group) && (
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
          <button className="chip" onClick={() => setSelectedIds(new Set(sortedFiltered.map(t => t.id)))}>전체 선택</button>
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
        <MedBulkMoveModal groups={groups} counts={groupCounts} onCreateFolder={addFolder} onConfirm={applyBulkMove} onClose={() => setShowMoveModal(false)} />
      )}

      {terms.length === 0 ? (
        <div className="empty-state">
          <Stethoscope size={34} />
          <div>아직 등록된 의학용어가 없어요.<br />가져오기나 직접 추가로 시작해보세요.</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">조건에 맞는 용어가 없어요.</div>
      ) : view === "card" ? (
        <MedBrowseCards terms={sortedFiltered} toggleFavorite={toggleFavorite} />
      ) : (
        <div>
          {sortedFiltered.map((t, idx) => (
            editingId === t.id ? (
              <MedEditRow key={t.id} term={t} groups={groups} onSave={(patch) => { updateTerm(t.id, patch); setEditingId(null); }} onCancel={() => setEditingId(null)} />
            ) : (
              <div className="word-row" key={t.id}>
                <div className="word-row-top">
                  {selectMode && (
                    <input type="checkbox" className="row-checkbox" checked={selectedIds.has(t.id)} onChange={() => toggleSelected(t.id)} aria-label="선택" />
                  )}
                  <span className="row-number">{idx + 1}</span>
                  <button className="icon-btn star-btn" onClick={() => toggleFavorite(t.id)} aria-label="즐겨찾기">
                    <Star size={16} color="#E3A730" fill={t.favorite ? "#E3A730" : "none"} />
                  </button>
                  <div className="word-main">
                    <div className="word-eng" onClick={() => speak(t.term)}>
                      <SpeakerBtn text={t.term} />{t.term}
                    </div>
                    <div className="word-kor">{t.senses[0]?.korean}{t.senses.length > 1 && <span className="more-senses"> 외 {t.senses.length - 1}개 뜻</span>}</div>
                  </div>
                  <GroupBadge group={t.group} />
                  {wrongCounts?.[t.id] > 0 && <span className="wrong-badge">✕ {wrongCounts[t.id]}번</span>}
                  <button className="icon-btn" onClick={() => setExpandedId(expandedId === t.id ? null : t.id)} aria-label="상세 보기">
                    <ChevronDown size={15} style={{ transform: expandedId === t.id ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                  </button>
                  <button className="icon-btn" onClick={() => setEditingId(t.id)} aria-label="수정"><Pencil size={15} /></button>
                  {confirmDeleteId === t.id ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="icon-btn danger" onClick={() => { deleteTerm(t.id); setConfirmDeleteId(null); }} aria-label="삭제 확인"><Check size={15} /></button>
                      <button className="icon-btn" onClick={() => setConfirmDeleteId(null)} aria-label="취소"><X size={15} /></button>
                    </div>
                  ) : (
                    <button className="icon-btn danger" onClick={() => setConfirmDeleteId(t.id)} aria-label="삭제"><Trash2 size={15} /></button>
                  )}
                </div>
                {selectedFolder === "__wrong__" && <MedMistakeBreakdown detail={wrongDetails?.[t.id]} />}
                {expandedId === t.id && <MedSenseList senses={t.senses} />}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}

function MedFullTermTab({ terms, groups }) {
  const [q, setQ] = useState("");
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [treeExpanded, setTreeExpanded] = useState(new Set());

  const toggleTreeExpand = (p) => setTreeExpanded(prev => { const s = new Set(prev); s.has(p) ? s.delete(p) : s.add(p); return s; });
  const tree = buildTree(groups);

  const items = terms.flatMap(t => t.senses.filter(s => (s.fullTerm || "").trim()).map((s, i) => ({ key: `${t.id}-${s.id}-${i}`, term: t, sense: s })));

  const fullTermCounts = useMemo(() => {
    const m = {};
    items.forEach(it => {
      const g = it.term.group || "";
      if (g) { const parts = g.split("/"); let acc = ""; parts.forEach(part => { acc = acc ? acc + "/" + part : part; m[acc] = (m[acc] || 0) + 1; }); }
      m[""] = (m[""] || 0) + (g ? 0 : 1);
    });
    return m;
  }, [items]);

  const filtered = items.filter(it => {
    const hay = (it.term.term + " " + it.sense.fullTerm + " " + it.sense.korean).toLowerCase();
    const matchQ = hay.includes(q.toLowerCase());
    const g = it.term.group || "";
    const matchG = selectedFolder === null ? true : (selectedFolder === "" ? !g : (g === selectedFolder || g.startsWith(selectedFolder + "/")));
    return matchQ && matchG;
  });

  return (
    <div>
      <div className="section-title"><Link2 size={18} /> 풀텀</div>
      <p className="section-sub">약어의 전체 표현(full term)만 모아서 볼 수 있어요.</p>
      <div className="search-row">
        <Search size={15} color="#A6ACBB" />
        <input placeholder="검색..." value={q} onChange={e => setQ(e.target.value)} />
        <span className="count-chip">{filtered.length}개</span>
      </div>

      {(groups.length > 0 || terms.some(t => !t.group)) && items.length > 0 && (
        <div className="field">
          <label>폴더에서 보기</label>
          <div className="folder-list">
            <button className={`folder-row ${selectedFolder === null ? "selected" : ""}`} onClick={() => setSelectedFolder(null)}>
              <span className="folder-chevron-spacer" />
              <span className="folder-dot" style={{ background: "linear-gradient(135deg, var(--teal), var(--blue))" }} />
              <span className="folder-name">전체</span>
              <span className="folder-count">{items.length}개</span>
              {selectedFolder === null && <Check size={15} color="var(--blue-ink)" />}
            </button>
            {terms.some(t => !t.group) && (
              <button className={`folder-row ${selectedFolder === "" ? "selected" : ""}`} onClick={() => setSelectedFolder("")}>
                <span className="folder-chevron-spacer" />
                <span className="folder-dot" style={{ background: "#B9C2CF" }} />
                <span className="folder-name">미분류</span>
                <span className="folder-count">{fullTermCounts[""] || 0}개</span>
                {selectedFolder === "" && <Check size={15} color="var(--blue-ink)" />}
              </button>
            )}
            <FolderTreeRows nodes={tree} depth={0} expanded={expandedFromCollapsed(groups, treeExpanded)} toggleExpand={toggleTreeExpand} isSelected={p => p === selectedFolder} onToggle={setSelectedFolder} counts={fullTermCounts} />
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty-state">
          <Link2 size={34} />
          <div>아직 등록된 풀텀이 없어요.<br />용어 추가할 때 "풀텀"을 입력해보세요.</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">조건에 맞는 풀텀이 없어요.</div>
      ) : (
        <div>
          {filtered.map((it, idx) => (
            <div className="word-row" key={it.key}>
              <div className="word-row-top">
                <span className="row-number">{idx + 1}</span>
                <div className="word-main">
                  <div className="word-eng" onClick={() => speak(it.sense.fullTerm)}>
                    <SpeakerBtn text={it.sense.fullTerm} />{it.term.term}
                  </div>
                  <div className="word-kor">{it.sense.fullTerm}</div>
                </div>
                <GroupBadge group={it.term.group} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function buildMedSession(mode, count, senseItems) {
  const pool = shuffle(senseItems);
  const counters = { term2kr: 0, kr2term: 0 };
  const questions = [];
  for (let i = 0; i < count; i++) {
    const m = mode === "mix" ? (Math.random() < 0.5 ? "term2kr" : "kr2term") : mode;
    const item = pool[counters[m] % pool.length];
    questions.push({ type: m, term: item.term, sense: item.sense });
    counters[m]++;
  }
  return questions;
}

function MedQuizTab({ terms, groups, groupCounts, wrongCounts, markAnswer }) {
  const [phase, setPhase] = useState("setup");
  const [mode, setMode] = useState("term2kr");
  const [count, setCount] = useState(10);
  const [groupFilter, setGroupFilter] = useState([]);
  const [wrongThreshold, setWrongThreshold] = useState(2);
  const [treeExpanded, setTreeExpanded] = useState(new Set());
  const [queue, setQueue] = useState([]);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [wrongTerms, setWrongTerms] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [typed, setTyped] = useState("");
  const [typedFullTerm, setTypedFullTerm] = useState("");

  const toggleTreeExpand = (p) => setTreeExpanded(prev => { const s = new Set(prev); s.has(p) ? s.delete(p) : s.add(p); return s; });
  const tree = buildTree(groups);
  const favoriteCount = terms.filter(t => t.favorite).length;
  const wrongFolderCount = terms.filter(t => (wrongCounts?.[t.id] || 0) >= wrongThreshold).length;
  const fullTermCount = terms.filter(hasFullTerm).length;

  const matchFilter = (g, t) => g === UNGROUPED ? !t.group
    : g === "__favorites__" ? !!t.favorite
      : g === "__wrong__" ? (wrongCounts?.[t.id] || 0) >= wrongThreshold
        : g === "__fullterm__" ? hasFullTerm(t)
          : (t.group === g || (t.group || "").startsWith(g + "/"));
  const effectiveTerms = groupFilter.length === 0 ? terms : terms.filter(t => groupFilter.some(g => matchFilter(g, t)));
  const toggleGroup = (g) => setGroupFilter(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);

  if (terms.length < 4) {
    return (
      <div className="empty-state">
        <Layers size={34} />
        <div>퀴즈를 시작하려면 용어를 4개 이상 등록해주세요.<br />현재 {terms.length}개</div>
      </div>
    );
  }

  const senseItems = effectiveTerms.flatMap(t => t.senses.map(s => ({ term: t, sense: s })));
  const modeMax = senseItems.length;
  const boundedCount = Math.max(1, Math.min(count, modeMax || 1));

  const start = () => {
    setQueue(buildMedSession(mode, boundedCount, senseItems));
    setIdx(0); setScore(0); setWrongTerms([]); setFeedback(null); setTyped(""); setTypedFullTerm("");
    setPhase("running");
  };

  const current = queue[idx];

  const next = () => {
    setFeedback(null); setTyped(""); setTypedFullTerm("");
    if (idx + 1 >= queue.length) setPhase("done");
    else setIdx(idx + 1);
  };

  const answerTerm2Kr = () => {
    if (feedback) return;
    const accepted = current.sense.korean.split(",").map(s => s.trim());
    const ok = accepted.some(a => a === typed.trim());
    setFeedback(ok ? "correct" : "wrong");
    markAnswer(current.term.id, ok, "meaning");
    if (ok) setScore(s => s + 1); else setWrongTerms(w => [...w, current.term]);
  };

  const answerKr2Term = () => {
    if (feedback) return;
    const acceptedTerm = current.term.term.split(/[\/,]/).map(s => s.trim().toLowerCase());
    const termOk = acceptedTerm.includes(typed.trim().toLowerCase());
    const needsFullTerm = !!(current.sense.fullTerm || "").trim();
    const fullTermOk = !needsFullTerm || typedFullTerm.trim().toLowerCase() === current.sense.fullTerm.trim().toLowerCase();
    const ok = termOk && fullTermOk;
    setFeedback(ok ? "correct" : "wrong");
    markAnswer(current.term.id, ok, "spelling");
    if (ok) setScore(s => s + 1); else setWrongTerms(w => [...w, current.term]);
  };

  if (phase === "setup") {
    return (
      <div>
        <div className="section-title"><Layers size={18} /> 의학용어 퀴즈</div>
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
            <button className={`folder-row ${groupFilter.includes("__fullterm__") ? "selected" : ""}`} onClick={() => toggleGroup("__fullterm__")}>
              <span className="folder-chevron-spacer" />
              <Link2 size={14} color="var(--teal-ink)" style={{ flexShrink: 0 }} />
              <span className="folder-name">풀텀</span>
              <span className="folder-count">{fullTermCount}개</span>
              {groupFilter.includes("__fullterm__") && <Check size={15} color="var(--blue-ink)" />}
            </button>
            {terms.some(t => !t.group) && (
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
        {effectiveTerms.length < 4 && (
          <div style={{ color: "var(--red-ink)", fontSize: 12.5, marginBottom: 12, fontWeight: 600 }}>선택한 범위에 용어가 너무 적어요 (현재 {effectiveTerms.length}개, 최소 4개 필요).</div>
        )}

        <div className="field"><label>유형</label></div>
        <div className="mode-grid">
          {[
            ["term2kr", "영어→한글", "용어 보고 한글 뜻 쓰기"],
            ["kr2term", "한글→영어", "뜻 보고 용어 쓰기 (약어면 풀텀까지)"],
            ["mix", "랜덤 믹스", "두 유형 섞어서"],
          ].map(([v, label, desc]) => (
            <button key={v} className={`mode-card ${mode === v ? "selected" : ""}`} onClick={() => setMode(v)}>
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
        <button className="btn btn-primary btn-full" disabled={effectiveTerms.length < 4 || modeMax < 1} onClick={start}><Sparkles size={16} /> 퀴즈 시작</button>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div>
        <div className="section-title"><CheckCircle2 size={18} color="var(--green-ink)" /> 결과</div>
        <div className="score-ring">{score} / {queue.length}</div>
        <p style={{ textAlign: "center", color: "var(--ink-soft)", fontSize: 13, fontWeight: 600 }}>{Math.round((score / queue.length) * 100)}% 정답</p>
        {wrongTerms.length > 0 && (
          <div className="review-list">
            <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>다시 볼 용어</div>
            {wrongTerms.map((t, i) => (
              <div className="word-row" key={i} style={{ padding: "6px 0" }}>
                <div className="word-row-top">
                  <div className="word-main">
                    <div className="word-eng" onClick={() => speak(t.term)}><SpeakerBtn text={t.term} />{t.term}</div>
                    <div className="word-kor">{t.senses[0]?.korean}</div>
                  </div>
                  {wrongCounts?.[t.id] > 0 && <span className="wrong-badge">✕ {wrongCounts[t.id]}번</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setPhase("setup")}>다시 설정</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={start}>다시 풀기</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="quiz-progress"><span>{idx + 1} / {queue.length}</span><span>맞은 개수 {score}</span></div>

      {current.type === "term2kr" && (
        <>
          <div className="quiz-card" style={{ position: "relative" }}>
            {feedback === "correct" && <div className="stamp">참 잘했어요<Sparkles size={13} /></div>}
            <div className="quiz-prompt">이 용어의 뜻은?</div>
            <div className="quiz-main"><SpeakerBtn text={current.term.term} size={19} />{current.term.term}</div>
          </div>
          <input style={{ width: "100%", padding: "12px 14px", border: "1.5px solid var(--line)", borderRadius: 12, fontSize: 15, marginBottom: 10 }}
            placeholder="한글 뜻 입력..." value={typed} disabled={!!feedback}
            onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === "Enter") answerTerm2Kr(); }} />
          {feedback && (
            <div style={{ fontSize: 13, marginBottom: 10, color: feedback === "correct" ? "var(--green-ink)" : "var(--red-ink)", fontWeight: 800, display: "flex", alignItems: "center", gap: 6 }}>
              {feedback === "correct" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {feedback === "correct" ? "정답이에요!" : `정답: ${current.sense.korean}`}
            </div>
          )}
          {!feedback && <button className="btn btn-secondary btn-full" disabled={!typed.trim()} onClick={answerTerm2Kr}>확인</button>}
        </>
      )}

      {current.type === "kr2term" && (
        <>
          <div className="quiz-card" style={{ position: "relative" }}>
            {feedback === "correct" && <div className="stamp">참 잘했어요<Sparkles size={13} /></div>}
            <div className="quiz-prompt">이 뜻에 맞는 용어를 입력하세요</div>
            <div className="quiz-main">{current.sense.korean}</div>
          </div>
          <input style={{ width: "100%", padding: "12px 14px", border: "1.5px solid var(--line)", borderRadius: 12, fontSize: 15, marginBottom: 8 }}
            placeholder="영어 용어/약어 입력..." value={typed} disabled={!!feedback}
            onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === "Enter") answerKr2Term(); }} />
          <input style={{ width: "100%", padding: "12px 14px", border: "1.5px solid var(--line)", borderRadius: 12, fontSize: 15, marginBottom: 10 }}
            placeholder="풀텀 (약어인 경우에만 입력)" value={typedFullTerm} disabled={!!feedback}
            onChange={e => setTypedFullTerm(e.target.value)} onKeyDown={e => { if (e.key === "Enter") answerKr2Term(); }} />
          {feedback && (
            <div style={{ fontSize: 13, marginBottom: 10, color: feedback === "correct" ? "var(--green-ink)" : "var(--red-ink)", fontWeight: 800, display: "flex", alignItems: "center", gap: 6 }}>
              {feedback === "correct" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {feedback === "correct" ? "정답이에요!" : `정답: ${current.term.term}${current.sense.fullTerm ? ` (${current.sense.fullTerm})` : ""}`}
              <SpeakerBtn text={current.term.term} />
            </div>
          )}
          {!feedback && <button className="btn btn-secondary btn-full" disabled={!typed.trim()} onClick={answerKr2Term}>확인</button>}
        </>
      )}

      {feedback && (
        <button className="btn btn-secondary btn-full" style={{ marginTop: 10 }} onClick={next}>다음 <ChevronRight size={15} /></button>
      )}
    </div>
  );
}

function MedWordsTab(props) {
  const [subMode, setSubMode] = useState("list");
  return (
    <div>
      <div className="submode-row">
        <button className={`submode-btn ${subMode === "list" ? "active" : ""}`} onClick={() => setSubMode("list")}><Stethoscope size={14} /> 용어 목록</button>
        <button className={`submode-btn ${subMode === "manage" ? "active" : ""}`} onClick={() => setSubMode("manage")}><Folder size={14} /> 묶음 관리</button>
      </div>
      {subMode === "list" ? (
        <MedListTab {...props} />
      ) : (
        <ManageGroupsTab groups={props.groups} groupCounts={props.groupCounts} addFolder={props.addFolder} renameFolder={props.renameFolder} deleteFolder={props.deleteFolder}
          words={props.terms} folderPaths={props.folderPaths} folderColors={props.folderColors} wrongIds={props.wrongIds} wrongCounts={props.wrongCounts} wrongDetails={props.wrongDetails}
          onImport={props.onImport} />
      )}
    </div>
  );
}

export default function MedTermApp() {
  const [terms, setTerms] = useState([]);
  const [folderPaths, setFolderPaths] = useState([]);
  const [folderColors, setFolderColors] = useState({});
  const [wrongIds, setWrongIds] = useState([]);
  const [wrongCounts, setWrongCounts] = useState({});
  const [wrongDetails, setWrongDetails] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [subTab, setSubTab] = useState("list");
  const [toast, setToast] = useState("");
  const [activeGroup, setActiveGroup] = useState("");

  useEffect(() => {
    (async () => {
      const tRes = await getItem("medterm-words-v1");
      const fRes = await getItem("medterm-folders-v1");
      const cRes = await getItem("medterm-folder-colors-v1");
      const xRes = await getItem("medterm-wrong-ids-v1");
      const ncRes = await getItem("medterm-wrong-counts-v1");
      const ndRes = await getItem("medterm-wrong-details-v1");
      setTerms(tRes ? JSON.parse(tRes.value).map(migrateMedTerm) : []);
      setFolderPaths(fRes ? JSON.parse(fRes.value) : []);
      setFolderColors(cRes ? JSON.parse(cRes.value) : {});
      setWrongIds(xRes ? JSON.parse(xRes.value) : []);
      setWrongCounts(ncRes ? JSON.parse(ncRes.value) : {});
      setWrongDetails(ndRes ? JSON.parse(ndRes.value) : {});
      setLoaded(true);
    })();
  }, []);

  const persist = useCallback(async (next) => {
    setTerms(next);
    try { await setItem("medterm-words-v1", JSON.stringify(next)); } catch (e) { console.error(e); }
  }, []);
  const persistFolders = useCallback(async (next) => {
    setFolderPaths(next);
    try { await setItem("medterm-folders-v1", JSON.stringify(next)); } catch (e) { console.error(e); }
  }, []);
  const persistColors = useCallback(async (next) => {
    setFolderColors(next);
    try { await setItem("medterm-folder-colors-v1", JSON.stringify(next)); } catch (e) { console.error(e); }
  }, []);
  const persistWrongIds = useCallback(async (next) => {
    setWrongIds(next);
    try { await setItem("medterm-wrong-ids-v1", JSON.stringify(next)); } catch (e) { console.error(e); }
  }, []);
  const persistWrongCounts = useCallback(async (next) => {
    setWrongCounts(next);
    try { await setItem("medterm-wrong-counts-v1", JSON.stringify(next)); } catch (e) { console.error(e); }
  }, []);
  const persistWrongDetails = useCallback(async (next) => {
    setWrongDetails(next);
    try { await setItem("medterm-wrong-details-v1", JSON.stringify(next)); } catch (e) { console.error(e); }
  }, []);

  const clearWrong = () => { persistWrongIds([]); persistWrongCounts({}); persistWrongDetails({}); };

  const markAnswer = useCallback((termId, correct, category = "other") => {
    const hasReview = wrongIds.includes(termId);
    if (correct && hasReview) {
      persistWrongIds(wrongIds.filter(id => id !== termId));
    } else if (!correct && !hasReview) {
      persistWrongIds([...wrongIds, termId]);
    }
    if (!correct) {
      persistWrongCounts({ ...wrongCounts, [termId]: (wrongCounts[termId] || 0) + 1 });
      const prevDetail = wrongDetails[termId] || { spelling: 0, meaning: 0, other: 0 };
      persistWrongDetails({ ...wrongDetails, [termId]: { ...prevDetail, [category]: (prevDetail[category] || 0) + 1 } });
    }
  }, [wrongIds, wrongCounts, wrongDetails, persistWrongIds, persistWrongCounts, persistWrongDetails]);

  const toggleFavorite = (id) => persist(terms.map(t => t.id === id ? { ...t, favorite: !t.favorite } : t));

  const setFolderColor = (path, color) => {
    const next = { ...folderColors };
    if (color) next[path] = color; else delete next[path];
    persistColors(next);
  };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(""), 1800); };

  const groups = useMemo(() => {
    const leafPaths = [...new Set([...terms.map(t => t.group).filter(Boolean), ...folderPaths])];
    const set = new Set();
    leafPaths.forEach(p => {
      const parts = p.split("/").filter(Boolean);
      let acc = "";
      parts.forEach(part => { acc = acc ? acc + "/" + part : part; set.add(acc); });
    });
    return [...set].sort();
  }, [terms, folderPaths]);
  const groupCounts = useMemo(() => {
    const m = { "": terms.filter(t => !t.group).length };
    groups.forEach(p => { m[p] = terms.filter(t => t.group === p || (t.group || "").startsWith(p + "/")).length; });
    return m;
  }, [terms, groups]);

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
    persist(terms.map(t => t.group && (t.group === oldPath || t.group.startsWith(oldPath + "/")) ? { ...t, group: remap(t.group) } : t));
    const nextColors = {};
    Object.entries(folderColors).forEach(([k, v]) => { nextColors[k === oldPath || k.startsWith(oldPath + "/") ? remap(k) : k] = v; });
    persistColors(nextColors);
    if (activeGroup && (activeGroup === oldPath || activeGroup.startsWith(oldPath + "/"))) setActiveGroup(remap(activeGroup));
  };

  const deleteFolder = (path) => {
    persistFolders(folderPaths.filter(p => p !== path && !p.startsWith(path + "/")));
    persist(terms.map(t => t.group && (t.group === path || t.group.startsWith(path + "/")) ? { ...t, group: "" } : t));
    const nextColors = {};
    Object.entries(folderColors).forEach(([k, v]) => { if (k !== path && !k.startsWith(path + "/")) nextColors[k] = v; });
    persistColors(nextColors);
    if (activeGroup && (activeGroup === path || activeGroup.startsWith(path + "/"))) setActiveGroup("");
  };

  const addTerms = (entries) => {
    const clean = entries
      .filter(e => e.term.trim() && (e.senses || []).some(s => (s.korean || "").trim()))
      .map(e => ({
        id: e.id || genId(),
        term: e.term.trim(),
        group: (e.group || "").trim(),
        senses: (e.senses || []).filter(s => (s.korean || "").trim()).map(s => makeMedSense({
          korean: s.korean.trim(),
          synonyms: (s.synonyms || []).filter(Boolean).map(x => x.trim()).filter(Boolean),
          fullTerm: (s.fullTerm || "").trim(),
        })),
      }))
      .filter(e => e.senses.length > 0);
    if (clean.length === 0) return 0;
    persist([...terms, ...clean]);
    return clean.length;
  };

  const updateTerm = (id, patch) => persist(terms.map(t => t.id === id ? { ...t, ...patch } : t));
  const deleteTerm = (id) => persist(terms.filter(t => t.id !== id));
  const bulkMoveTerms = (ids, group) => persist(terms.map(t => ids.has(t.id) ? { ...t, group } : t));
  const bulkDeleteTerms = (ids) => persist(terms.filter(t => !ids.has(t.id)));

  const commonProps = {
    terms, groups, groupCounts, wrongCounts, wrongDetails, wrongIds,
    updateTerm, deleteTerm, bulkMoveTerms, bulkDeleteTerms, toggleFavorite, clearWrong,
    addFolder, renameFolder, deleteFolder, folderPaths, folderColors, showToast,
    onImport: (data) => {
      persist((data.words || []).map(migrateMedTerm));
      persistFolders(data.folderPaths || []);
      persistColors(data.folderColors || {});
      persistWrongIds(data.wrongIds || []);
      persistWrongCounts(data.wrongCounts || {});
      persistWrongDetails(data.wrongDetails || {});
      showToast("백업 파일을 불러왔어요");
    },
  };

  return (
    <FolderColorsContext.Provider value={{ colors: folderColors, setColor: setFolderColor }}>
      <div>
        <div className="submode-row">
          <button className={`submode-btn ${subTab === "list" ? "active" : ""}`} onClick={() => setSubTab("list")}><Stethoscope size={14} /> 목록</button>
          <button className={`submode-btn ${subTab === "import" ? "active" : ""}`} onClick={() => setSubTab("import")}><Type size={14} /> 가져오기</button>
          <button className={`submode-btn ${subTab === "fullterm" ? "active" : ""}`} onClick={() => setSubTab("fullterm")}><Link2 size={14} /> 풀텀</button>
          <button className={`submode-btn ${subTab === "quiz" ? "active" : ""}`} onClick={() => setSubTab("quiz")}><Layers size={14} /> 퀴즈</button>
        </div>

        {!loaded ? (
          <div className="empty-state">불러오는 중...</div>
        ) : subTab === "list" ? (
          <MedWordsTab {...commonProps} />
        ) : subTab === "import" ? (
          <MedImportTab addTerms={addTerms} showToast={showToast} goList={() => setSubTab("list")} groups={groups} groupCounts={groupCounts} activeGroup={activeGroup} setActiveGroup={setActiveGroup} addFolder={addFolder} />
        ) : subTab === "fullterm" ? (
          <MedFullTermTab terms={terms} groups={groups} />
        ) : (
          <MedQuizTab terms={terms} groups={groups} groupCounts={groupCounts} wrongCounts={wrongCounts} markAnswer={markAnswer} />
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </FolderColorsContext.Provider>
  );
}
