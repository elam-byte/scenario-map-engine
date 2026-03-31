import { useRef, useState } from 'react';
import type { Tool } from '../hooks/useEditorState';
import type { MapAction } from '../store/mapReducer';
import { WORLD_SIZES } from '@shared/types';
import { safeParseMapModel } from '@shared/validation';

type Props = {
  activeTool: Tool;
  onToolChange: (t: Tool) => void;
  dispatch: (a: MapAction) => void;
  canUndo: boolean;
  canRedo: boolean;
};

const TOOLS: { tool: Tool; label: string; icon: string; title: string }[] = [
  { tool: 'select',           icon: '↖',  label: 'Select',   title: 'Select / Move (S)' },
  { tool: 'draw-line',        icon: '╱',  label: 'Line',     title: 'Draw Line Road (L)' },
  { tool: 'draw-arc',         icon: '⌒',  label: 'Arc',      title: 'Draw Arc Road (A)' },
  { tool: 'place-junction',   icon: '⊞',  label: '4-Way',    title: 'Place 4-Way Junction (J)' },
  { tool: 'place-t-junction', icon: '⊤',  label: 'T-Junc',  title: 'Place T-Junction (T)' },
  { tool: 'place-vehicle',    icon: '▭',  label: 'Vehicle',  title: 'Place Vehicle (V)' },
];

const SIDEBAR_WIDTH = 152;

const sidebarStyle: React.CSSProperties = {
  width: SIDEBAR_WIDTH,
  minWidth: SIDEBAR_WIDTH,
  background: '#12122a',
  borderRight: '1px solid #2d2d4a',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  padding: '10px 6px',
  gap: 4,
  overflowY: 'auto',
};

const BTN_WIDTH = SIDEBAR_WIDTH - 16;

function ToolButton({
  icon,
  label,
  title,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: BTN_WIDTH,
        padding: '8px 10px',
        background: active ? '#3b3b6b' : 'transparent',
        border: active ? '1px solid #6366f1' : '1px solid transparent',
        borderRadius: 6,
        color: active ? '#a5b4fc' : '#9ca3af',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        fontSize: 18,
        lineHeight: 1,
        transition: 'background 0.1s',
      }}
    >
      <span style={{ width: 22, textAlign: 'center' }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: active ? 600 : 400 }}>{label}</span>
    </button>
  );
}

function Divider() {
  return <div style={{ width: BTN_WIDTH, height: 1, background: '#2d2d4a', margin: '4px 0' }} />;
}

function IconButton({
  icon,
  label,
  title,
  onClick,
  disabled,
}: {
  icon: string;
  label?: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: BTN_WIDTH,
        padding: '6px 10px',
        background: 'transparent',
        border: '1px solid transparent',
        borderRadius: 6,
        color: disabled ? '#374151' : '#9ca3af',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        fontSize: 16,
      }}
    >
      <span style={{ width: 22, textAlign: 'center' }}>{icon}</span>
      {label && <span style={{ fontSize: 12 }}>{label}</span>}
    </button>
  );
}

export function Toolbar({ activeTool, onToolChange, dispatch, canUndo, canRedo }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [worldPickerOpen, setWorldPickerOpen] = useState(false);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text !== 'string') return;
      try {
        const json = JSON.parse(text);
        const result = safeParseMapModel(json);
        if (result.ok) {
          dispatch({ type: 'IMPORT_MAP', model: result.model });
        } else {
          alert(`Invalid map file:\n${result.error}`);
        }
      } catch {
        alert('Failed to parse JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div style={sidebarStyle}>
      {/* New world */}
      <IconButton icon="＋" label="New World" title="New World" onClick={() => setWorldPickerOpen(true)} />

      {worldPickerOpen && (
        <WorldDialog
          onConfirm={(w, h) => {
            dispatch({ type: 'NEW_WORLD', world: { width: w, height: h } });
            setWorldPickerOpen(false);
          }}
          onCancel={() => setWorldPickerOpen(false)}
        />
      )}

      <Divider />

      {/* Drawing tools */}
      {TOOLS.map(({ tool, icon, label, title }) => (
        <ToolButton
          key={tool}
          icon={icon}
          label={label}
          title={title}
          active={activeTool === tool}
          onClick={() => onToolChange(tool)}
        />
      ))}

      <Divider />

      {/* Undo / Redo */}
      <IconButton icon="↩" label="Undo" title="Undo (Ctrl+Z)" onClick={() => dispatch({ type: 'UNDO' })} disabled={!canUndo} />
      <IconButton icon="↪" label="Redo" title="Redo (Ctrl+Y)" onClick={() => dispatch({ type: 'REDO' })} disabled={!canRedo} />

      <Divider />

      {/* Import / Export */}
      <IconButton
        icon="📂"
        label="Import"
        title="Import Map JSON"
        onClick={() => fileInputRef.current?.click()}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleImport}
      />
      <IconButton
        icon="💾"
        label="Export"
        title="Export Map JSON"
        onClick={() => document.dispatchEvent(new CustomEvent('ats-export'))}
      />
    </div>
  );
}

function WorldDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: (w: number, h: number) => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: '#1a1a2e',
          border: '1px solid #3d3d5c',
          borderRadius: 8,
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minWidth: 260,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ color: '#e5e7eb', fontWeight: 600, fontSize: 15 }}>New World</div>
        {WORLD_SIZES.map(({ width, height }) => (
          <button
            key={`${width}x${height}`}
            onClick={() => onConfirm(width, height)}
            style={{
              background: '#0f0f23',
              border: '1px solid #4a4a7a',
              borderRadius: 6,
              color: '#a5b4fc',
              padding: '10px 16px',
              cursor: 'pointer',
              fontSize: 14,
              textAlign: 'left',
            }}
          >
            <div style={{ fontWeight: 600 }}>{width} × {height} m</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>16:9 · {width === 500 ? 'Small' : 'Large'}</div>
          </button>
        ))}
        <button
          onClick={onCancel}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#6b7280',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
