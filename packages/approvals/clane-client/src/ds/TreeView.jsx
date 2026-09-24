// STAGING STUB — not copied to the platform: verbatim copy of clane-client/src/ds/TreeView.jsx (2026-09-24) so specs run against the real markup.
import React from 'react';

function Node({ node, depth, expanded, toggle, selected, onSelect }) {
  const kids = node.children || [];
  const open = expanded.has(node.id);
  const isSel = selected === node.id;
  const [h, setH] = React.useState(false);
  const [f, setF] = React.useState(false);
  return (
    <div>
      <div
        onClick={() => {
          kids.length ? toggle(node.id) : null;
          onSelect && onSelect(node.id);
        }}
        onMouseOver={() => setH(true)}
        onMouseOut={() => setH(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '6px 8px',
          paddingLeft: 8 + depth * 18,
          borderRadius: 7,
          cursor: 'pointer',
          boxSizing: 'border-box',
          background: isSel ? 'var(--blue-tint)' : h ? 'var(--bg-app)' : 'transparent',
          border: isSel ? '1px solid var(--blue-selected-border)' : '1px solid transparent',
        }}
      >
        <span
          style={{ width: 14, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 }}
        >
          {kids.length > 0 && (
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#8A9BB8"
              strokeWidth="2.2"
              strokeLinecap="round"
              style={{
                transform: open ? 'rotate(90deg)' : 'none',
                transition: 'transform .15s ease',
              }}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          )}
        </span>
        {node.icon}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            color: isSel ? 'var(--ink)' : 'var(--text-secondary)',
            fontWeight: isSel ? 500 : 400,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {node.label}
        </span>
        {node.meta && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10.5,
              color: 'var(--text-faint)',
              flexShrink: 0,
            }}
          >
            {node.meta}
          </span>
        )}
        {node.trailing && (
          <span
            onClick={(e) => e.stopPropagation()}
            onFocusCapture={() => setF(true)}
            onBlurCapture={() => setF(false)}
            style={{
              display: 'inline-flex',
              flexShrink: 0,
              // Revealed on focus as well as hover: a control that is
              // invisible but still clickable and tabbable is a trap.
              opacity: h || isSel || f ? 1 : 0,
              transition: 'opacity .12s ease',
            }}
          >
            {node.trailing}
          </span>
        )}
      </div>
      {open &&
        kids.map((k) => (
          <Node
            key={k.id}
            node={k}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

// File/folder tree: chevron rotate, blue-tint selection, mono meta; controlled or uncontrolled expansion.
export function TreeView({ nodes, defaultExpanded = [], selected, onSelect, style }) {
  const [expanded, setExpanded] = React.useState(new Set(defaultExpanded));
  const toggle = (id) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, ...style }}>
      {nodes.map((n) => (
        <Node
          key={n.id}
          node={n}
          depth={0}
          expanded={expanded}
          toggle={toggle}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
