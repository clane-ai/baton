"use client";

// The left column of the item screen: every document a step's inputs point at, one tab each.
// Emails show headers, decoded text and attachment names; PDFs use the browser's viewer; text as is.
import { useEffect, useState } from "react";
import { ExternalLink, Paperclip } from "lucide-react";
import type { DocumentRef } from "@/lib/types";
import { parseEml, type ParsedEmail } from "@/lib/documents";
import { Empty } from "@/components/ui";

const url = (path: string) => `/api/workspace?path=${encodeURIComponent(path)}`;

function useText(path: string | null, wanted: boolean): { text: string | null; error: string | null } {
  const [state, setState] = useState<{ text: string | null; error: string | null }>({ text: null, error: null });
  useEffect(() => {
    setState({ text: null, error: null });
    if (!path || !wanted) return;
    let alive = true;
    fetch(url(path), { cache: "no-store" })
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
          setState({ text: null, error: j.error?.message ?? `HTTP ${r.status}` });
          return;
        }
        setState({ text: await r.text(), error: null });
      })
      .catch((e) => alive && setState({ text: null, error: String(e) }));
    return () => { alive = false; };
  }, [path, wanted]);
  return state;
}

function Email({ mail }: { mail: ParsedEmail }) {
  const show = ["From", "To", "Subject", "Date"].filter((h) => mail.headers[h]);
  return (
    <div className="mail">
      <dl className="mail-h">
        {show.map((h) => (<div key={h}><dt>{h}</dt><dd>{mail.headers[h]}</dd></div>))}
      </dl>
      <div className="mail-b">{mail.text || <span className="muted">No text in this email.</span>}</div>
      {mail.attachments.length ? (
        <div className="mail-att">{mail.attachments.map((a) => <span key={a} className="att"><Paperclip size={12} /> {a}</span>)}</div>
      ) : null}
    </div>
  );
}

function Body({ doc }: { doc: DocumentRef }) {
  const isPdf = doc.type === "pdf";
  const { text, error } = useText(doc.path, !isPdf);
  if (isPdf) return <iframe className="doc-pdf" src={url(doc.path)} title={doc.label} />;
  if (error) return <div className="error">Cannot show {doc.path}: {error}</div>;
  if (text === null) return <div className="muted">Loading…</div>;
  if (doc.type === "email") return <Email mail={parseEml(text)} />;
  return <pre className="doc-text">{text}</pre>;
}

export default function Sources({ docs, itemKey }: { docs: DocumentRef[]; itemKey: string }) {
  const storeKey = `baton.source.${itemKey}`;
  const [i, setI] = useState(0);
  useEffect(() => {
    let saved = 0;
    try { saved = Number(sessionStorage.getItem(storeKey) ?? 0); } catch { saved = 0; }
    setI(Number.isFinite(saved) && saved < docs.length ? saved : 0);
  }, [storeKey, docs.length]);
  const pick = (k: number) => { setI(k); try { sessionStorage.setItem(storeKey, String(k)); } catch { /* per-viewer convenience only */ } };
  if (!docs.length) return <Empty title="No source documents for this step" hint="Documents appear here when an artefact names them or the workspace holds them." />;
  const cur = docs[Math.min(i, docs.length - 1)];
  return (
    <div className="sources">
      <div className="tabs">
        {docs.map((d, k) => (
          <button key={d.path} type="button" className={`tab${k === i ? " on" : ""}`} onClick={() => pick(k)} title={d.path}>{d.label}</button>
        ))}
        <span className="sp" />
        <a className="tab-tool" href={url(cur.path)} target="_blank" rel="noreferrer" title="Open in a new tab"><ExternalLink size={14} /></a>
      </div>
      <div className="pane-b"><Body doc={cur} /></div>
    </div>
  );
}
