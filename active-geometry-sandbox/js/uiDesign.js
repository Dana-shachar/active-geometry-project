import { settings } from './uiSettings.js';
import { addShape, getActiveShape, setBooleanOp } from './shapeManager.js';
import { pushSnapshot } from './history.js';

// ============================================================
// CONFIG
// ============================================================
const STAGE_NAMES = ['Unit Cell', 'Locking', 'Lattice', 'Geometry Simulation'];

const PRIMITIVE_TYPES = [
    { type: 'sphere',     label: 'Sphere',     icon: '●' },
    { type: 'cylinder',   label: 'Cylinder',   icon: '▮' },
    { type: 'box',        label: 'Box',        icon: '■' },
    { type: 'prism',      label: 'Prism',      icon: '▲' },
    { type: 'polyhedron', label: 'Polyhedron', icon: '◆' },
    { type: 'helix',      label: 'Helix',      icon: '⊛' },
];

// Module-level refs updated by buildRightPanel, read by updatePanels each frame
let posInputs              = {};
let rotInputs              = {};
let scaleInputs            = {};
let localControlsContainer = null;
let lastRenderedShapeId    = -1;
let lastRenderedShapeType  = null;

// ============================================================
// MATH EXPRESSION PARSER
// Allows digits and basic operators only — no arbitrary JS.
// ============================================================
function evalMath(str) {
    const sanitized = str.trim();
    if (!/^[\d\s\+\-\*\/\.\(\)]+$/.test(sanitized)) return null;
    try {
        const result = Function('return ' + sanitized)();
        if (typeof result !== 'number' || !isFinite(result)) return null;
        return result;
    } catch { return null; }
}

// ============================================================
// CSS
// ============================================================
function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        /* ── Fonts ── */
        @font-face {
            font-family: 'Helvetica';
            src: url('/assets/font/HelveticaLTStd-Light.ttf') format('truetype');
            font-weight: 300;
        }
        @font-face {
            font-family: 'Helvetica';
            src: url('/assets/font/HelveticaLTStd-Roman.ttf') format('truetype');
            font-weight: 400;
        }
        @font-face {
            font-family: 'Helvetica';
            src: url('/assets/font/HelveticaLTStd-Bold.ttf') format('truetype');
            font-weight: 700;
        }

        /* ── Design tokens ── */
        :root {
            --bg-canvas:                  #0C0C0D;
            --bg-panel:                   #49494A;
            --bg-tab-inactive:            #3A3A3B;

            --btn-default-bg:             #5B5B5B;
            --btn-hover-bg:               #757575;
            --btn-stroke:                 #8C8C8C;
            --btn-stroke-weight:          0.75px;
            --btn-icon-bg:                #39393C;
            --btn-icon-active-bg:         #4A4A4D;
            --btn-padding:                4px;
            --btn-radius:                 4px;
            --btn-disabled-bg-opacity:    0.30;
            --btn-disabled-text-opacity:  0.40;

            --toggle-btn-width:           32px;
            --toggle-btn-height:          16px;
            --toggle-active-fill:         rgba(255, 255, 255, 0.20);
            --toggle-radius:              4px;

            --icon-btn-size:              32px;
            --icon-btn-gap:               6px;

            --dropdown-bg:                rgba(91, 91, 91, 0.80);

            --input-fill:                 rgba(242, 242, 247, 0.15);
            --input-stroke:               #F2F2F7;
            --input-stroke-weight:        0.25px;
            --input-focus-stroke:         var(--accent-primary);

            --divider-stroke:             rgba(255, 255, 255, 0.20);
            --divider-weight:             0.5px;

            --error-fill:                 rgba(179, 38, 30, 0.80);
            --error-stroke:               #F9DEDC;
            --error-text:                 #F9DEDC;

            --accent-primary:             #E5C11F;
            --accent-alt:                 #00C8B3;

            --text-primary:               #FFFFFF;
            --font:                       'Helvetica', sans-serif;

            --panel-padding:              8px;
            --panel-radius:               4px;
            --right-panel-padding:        16px;
            --right-panel-max-width:      360px;
            --section-gap:                12px;
            --item-gap:                   12px;
            --label-input-gap:            2px;
            --input-field-gap:            6px;
            --text-input-gap:             8px;
            --shape-menu-gap:             8px;
            --tab-height:                 32px;
            --tab-padding:                8px;
        }

        *, *::before, *::after { box-sizing: border-box; }

        /* ── Panels ── */
        .ag-left-col {
            position: fixed;
            top: 16px; left: 16px;
            display: flex;
            flex-direction: column;
            gap: var(--section-gap);
            z-index: 50;
        }
        .ag-left-panel {
            background: var(--bg-panel);
            border-radius: var(--panel-radius);
            padding: var(--panel-padding);
            display: flex;
            flex-direction: column;
            gap: var(--item-gap);
            font-family: var(--font);
            color: var(--text-primary);
        }
        .ag-shape-mode-header {
            font-size: 12px;
            font-weight: 400;
            text-align: center;
            padding: 2px 0;
        }
        .ag-right-outer {
            position: fixed;
            top: 0; right: 0;
            width: fit-content;
            max-width: var(--right-panel-max-width);
            max-height: 100vh;
            background: var(--bg-panel);
            border-radius: var(--panel-radius);
            z-index: 50;
            display: flex;
            flex-direction: column;
        }
        .ag-right-content {
            padding: var(--right-panel-padding);
            display: flex;
            flex-direction: column;
            gap: var(--section-gap);
            flex: 1;
            overflow-y: auto;
            scrollbar-width: thin;
            scrollbar-color: rgba(255,255,255,0.15) transparent;
        }

        /* ── Stage tabs ── */
        .ag-stage-tabs {
            display: flex;
            flex-shrink: 0;
        }
        .ag-stage-tab {
            height: var(--tab-height);
            padding: 0 var(--tab-padding);
            display: flex;
            align-items: center;
            justify-content: center;
            font: 400 13px var(--font);
            color: var(--text-primary);
            opacity: 0.4;
            background: var(--bg-tab-inactive);
            cursor: pointer;
            border: none;
            white-space: nowrap;
        }
        .ag-stage-tab:hover { opacity: 0.7; }
        .ag-stage-tab.ag-active {
            background: var(--bg-panel);
            opacity: 1;
        }

        /* ── Section titles + dividers ── */
        .ag-section-title {
            font: 700 12px var(--font);
            color: var(--text-primary);
        }
        .ag-section-divider {
            width: 100%;
            min-height: 1px;
            height: var(--divider-weight);
            background: var(--divider-stroke);
            flex-shrink: 0;
        }
        .ag-subsection-title {
            font: 400 12px var(--font);
            color: var(--text-primary);
            margin-bottom: var(--item-gap);
        }

        /* ── Left panel: mode buttons ── */
        .ag-mode-buttons {
            display: flex;
            gap: var(--icon-btn-gap);
        }
        .ag-mode-btn {
            width: var(--icon-btn-size);
            height: var(--icon-btn-size);
            border: none;
            background: var(--btn-icon-bg);
            border-radius: var(--btn-radius);
            color: var(--text-primary);
            font-size: 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .ag-mode-btn:hover { background: var(--btn-hover-bg); }
        .ag-mode-btn.ag-active { background: var(--btn-icon-active-bg); border-color: var(--accent-primary); }
        .ag-mode-btn:disabled { opacity: var(--btn-disabled-bg-opacity); cursor: default; }

        /* ── Solid / Strut toggle ── */
        .ag-toggle {
            display: flex;
            justify-content: space-between;
            width: 100%;
        }
        .ag-toggle-btn {
            padding: var(--btn-padding);
            border: none;
            background: transparent;
            color: var(--text-primary);
            font-size: 12px;
            font-weight: 400;
            font-family: var(--font);
            cursor: pointer;
            white-space: nowrap;
            text-align: center;
            border-radius: var(--toggle-radius);
        }
        .ag-toggle-btn.ag-active { background: var(--toggle-active-fill); }

        /* ── Primitive buttons ── */
        .ag-primitives {
            background: rgba(0, 0, 0, 0.25);
            border-radius: var(--btn-radius);
            padding: var(--btn-padding);
            display: flex;
            flex-direction: column;
            gap: var(--icon-btn-gap);
            align-items: center;
        }
        .ag-primitive-btn {
            width: var(--icon-btn-size);
            height: var(--icon-btn-size);
            background: var(--btn-icon-bg);
            border: none;
            border-radius: var(--btn-radius);
            color: var(--text-primary);
            font-size: 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .ag-primitive-btn:hover { background: var(--btn-icon-active-bg); }

        /* ── Panel sections ── */
        .ag-panel-section {
            display: flex;
            flex-direction: column;
            gap: var(--item-gap);
        }

        /* ── Sliders ── */
        .ag-slider-row {
            display: flex;
            align-items: center;
            gap: var(--text-input-gap);
        }
        .ag-slider-label {
            font: 300 12px var(--font);
            color: var(--text-primary);
            flex-shrink: 0;
            min-width: 80px;
        }
        .ag-slider-value {
            font: 300 12px var(--font);
            color: var(--text-primary);
            opacity: 0.6;
            flex-shrink: 0;
            min-width: 36px;
            text-align: right;
        }
        input[type=range].ag-slider {
            -webkit-appearance: none;
            appearance: none;
            flex: 1;
            height: 2px;
            background: var(--btn-default-bg);
            border-radius: 1px;
            cursor: pointer;
            outline: none;
        }
        input[type=range].ag-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--text-primary);
            cursor: pointer;
        }
        input[type=range].ag-slider::-moz-range-thumb {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--text-primary);
            border: none;
            cursor: pointer;
        }

        /* ── XYZ input rows ── */
        .ag-xyz-row {
            display: flex;
            align-items: center;
            gap: var(--text-input-gap);
        }
        .ag-xyz-label {
            font: 300 12px var(--font);
            color: var(--text-primary);
            flex-shrink: 0;
            width: 100px;
        }
        .ag-xyz-fields {
            display: flex;
            gap: var(--input-field-gap);
            flex: 1;
        }
        .ag-xyz-field-wrap {
            display: flex;
            flex-direction: column;
            gap: var(--label-input-gap);
            flex: 1;
            min-width: 0;
        }
        .ag-xyz-axis-label {
            font: 300 12px var(--font);
            color: var(--text-primary);
            opacity: 0.5;
        }
        .ag-xyz-field {
            width: 100%;
            cursor: ew-resize;
            background: var(--input-fill);
            border: var(--input-stroke-weight) solid var(--input-stroke);
            border-radius: 2px;
            color: var(--text-primary);
            font: 300 12px var(--font);
            line-height: 0.9;
            padding: 6px 4px 4px;
            text-align: center;
        }
        .ag-xyz-field:focus {
            outline: none;
            border-color: var(--input-focus-stroke);
        }

        /* ── Boolean icon buttons ── */
        .ag-bool-buttons {
            display: flex;
            gap: var(--icon-btn-gap);
        }
        .ag-bool-btn {
            width: var(--icon-btn-size);
            height: var(--icon-btn-size);
            padding: var(--btn-padding);
            background: var(--btn-icon-bg);
            border: none;
            border-radius: var(--btn-radius);
            color: var(--text-primary);
            font: 300 12px var(--font);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .ag-bool-btn:hover,
        .ag-bool-btn.ag-active { background: var(--btn-icon-active-bg); }
        .ag-bool-btn:disabled { opacity: var(--btn-disabled-bg-opacity); cursor: default; }

        /* ── Local controls ── */
        .ag-local-row {
            display: flex;
            align-items: center;
            gap: var(--text-input-gap);
        }
        .ag-local-row label {
            font: 300 12px var(--font);
            color: var(--text-primary);
            flex-shrink: 0;
            white-space: nowrap;
        }
        .ag-local-input {
            flex: 1; min-width: 0;
            cursor: ew-resize;
            background: var(--input-fill);
            border: var(--input-stroke-weight) solid var(--input-stroke);
            border-radius: 2px;
            color: var(--text-primary);
            font: 300 12px var(--font);
            line-height: 0.9;
            padding: 6px 4px 4px;
            text-align: center;
        }
        .ag-local-select {
            flex: 1; min-width: 0;
            background: var(--dropdown-bg);
            border: var(--input-stroke-weight) solid var(--input-stroke);
            border-radius: 2px;
            color: var(--text-primary);
            font: 300 12px var(--font);
            line-height: 0.9;
            padding: 6px 4px 4px;
        }
        .ag-compact-select {
            width: fit-content;
            background: var(--dropdown-bg);
            border: var(--input-stroke-weight) solid var(--input-stroke);
            border-radius: 2px;
            color: var(--text-primary);
            font: 300 12px var(--font);
            line-height: 0.9;
            padding: 6px 8px 4px;
        }
        .ag-local-input:focus,
        .ag-local-select:focus,
        .ag-compact-select:focus { outline: none; border-color: var(--input-focus-stroke); }
        .ag-local-checkbox { accent-color: var(--accent-primary); }
        .ag-no-selection {
            font: 300 12px var(--font);
            color: var(--text-primary);
            opacity: 0.3;
            text-align: center;
            padding: 8px 0;
        }

        /* ── Action buttons (Export / Upload / To Ground / Reset) ── */
        .ag-action-btn {
            padding: 8px 8px 4px;
            background: var(--btn-default-bg);
            border: var(--btn-stroke-weight) solid var(--btn-stroke);
            border-radius: var(--btn-radius);
            color: var(--text-primary);
            font: 300 12px var(--font);
            line-height: 0.9;
            cursor: pointer;
            width: fit-content;
        }
        .ag-action-btn:hover { background: var(--btn-hover-bg); }
        .ag-action-btn:disabled { opacity: var(--btn-disabled-bg-opacity); cursor: default; }

        /* ── Key-value rows (Export info) ── */
        .ag-kv-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: var(--item-gap);
        }
        .ag-kv-key   { font: 300 12px var(--font); color: var(--text-primary); opacity: 0.6; }
        .ag-kv-value { font: 300 12px var(--font); color: var(--text-primary); }

        /* ── Error / Warning ── */
        .ag-error {
            padding: var(--btn-padding);
            background: var(--error-fill);
            border: 1px solid var(--error-stroke);
            border-radius: var(--btn-radius);
            color: var(--error-text);
            font: 300 12px var(--font);
        }
    `;
    document.head.appendChild(style);
}

// ============================================================
// LOCAL CONTROLS — rebuilt whenever active shape changes
// ============================================================
function localControls(shape, container) {
    container.innerHTML = '';
    if (!shape) {
        const msg = document.createElement('div');
        msg.className = 'ag-no-selection';
        msg.textContent = 'No shape selected';
        container.appendChild(msg);
        return;
    }

    function addRow(labelText, inputEl) {
        const row = document.createElement('div');
        row.className = 'ag-local-row';
        const lbl = document.createElement('label');
        lbl.textContent = labelText;
        row.appendChild(lbl);
        row.appendChild(inputEl);
        container.appendChild(row);
    }

    function numInput(getValue, setValue, min = 0.1, sensitivity = 0.1, snapIncrement = 1) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'ag-local-input';
        input.value = Number(getValue()).toFixed(2);
        const commit = () => {
            const val = evalMath(input.value);
            if (val !== null && val >= min) { pushSnapshot(); setValue(val); }
            input.value = Number(getValue()).toFixed(2);
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { commit(); input.blur(); }
            if (e.key === 'Escape') { input.value = Number(getValue()).toFixed(2); input.blur(); }
        });
        makeScrubber(input, getValue, setValue, min, sensitivity, snapIncrement);
        return input;
    }

    function checkbox(getValue, setValue) {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'ag-local-checkbox';
        input.checked = getValue();
        input.addEventListener('change', () => { pushSnapshot(); setValue(input.checked); });
        return input;
    }

    if (shape.type === 'sphere') {
        addRow('Radius (mm)',       numInput(() => shape.width, v => { shape.width = v; if (shape.lockProportions) shape.height = v; }, 0.1, 0.2, 1));
        addRow('Lock proportions',  checkbox(() => shape.lockProportions, v => { shape.lockProportions = v; }));
    }
    if (shape.type === 'box') {
        addRow('Corner radius (mm)', numInput(() => shape.cornerRadius, v => { shape.cornerRadius = v; }, 0, 0.1, 1));
    }
    if (shape.type === 'cylinder') {
        addRow('Cap ends',           checkbox(() => shape.caps,         v => { shape.caps = v; }));
        addRow('Corner radius (mm)', numInput(() => shape.cornerRadius, v => { shape.cornerRadius = v; }, 0, 0.1, 1));
    }
    if (shape.type === 'prism') {
        const sidesInput = document.createElement('input');
        sidesInput.type = 'text'; sidesInput.className = 'ag-local-input';
        sidesInput.value = shape.sides;
        const commitSides = () => {
            const val = Math.round(parseFloat(sidesInput.value));
            if (val >= 3 && val <= 20) { pushSnapshot(); shape.sides = val; }
            sidesInput.value = shape.sides;
        };
        sidesInput.addEventListener('blur', commitSides);
        sidesInput.addEventListener('keydown', e => { if (e.key === 'Enter') { commitSides(); sidesInput.blur(); } });
        makeScrubber(sidesInput, () => shape.sides, v => { const s = Math.round(Math.max(3, Math.min(20, v))); shape.sides = s; sidesInput.value = s; }, 3, 0.1, 1);
        addRow('Sides (3–20)', sidesInput);
        addRow('Cap ends', checkbox(() => shape.caps, v => { shape.caps = v; }));
    }
    if (shape.type === 'polyhedron') {
        const select = document.createElement('select');
        select.className = 'ag-local-select';
        [['Tetrahedron', 0], ['Octahedron', 1], ['Icosahedron', 2], ['Dodecahedron', 3]].forEach(([name, val]) => {
            const opt = document.createElement('option');
            opt.value = val; opt.textContent = name;
            if (shape.polyType === val) opt.selected = true;
            select.appendChild(opt);
        });
        select.addEventListener('change', () => { pushSnapshot(); shape.polyType = parseInt(select.value); });
        addRow('Type', select);
    }
    if (shape.type === 'helix') {
        addRow('Coil radius (mm)', numInput(() => shape.width,      v => { shape.width = v; },      0.1,  0.2,  1));
        addRow('Tube radius (mm)', numInput(() => shape.tubeRadius, v => { shape.tubeRadius = v; }, 0.1,  0.1,  1));
        addRow('Step height (mm)', numInput(() => shape.stepHeight, v => { shape.stepHeight = v; }, 0.1,  0.2,  1));
        addRow('Turns',            numInput(() => shape.turns,      v => { shape.turns = v; },      0.01, 0.02, 0.1));
    }
}

// ============================================================
// SCRUBBER — click+drag left/right on any numeric input to change its value.
// Hold Cmd/Ctrl to snap to integers. Click without dragging focuses for typing.
// ============================================================
function makeScrubber(input, getValue, setValue, min, sensitivity = 0.1, snapIncrement = 1) {
    input.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();

        let hasMoved = false;

        const onMove = (moveEvent) => {
            if (!hasMoved) pushSnapshot();
            hasMoved = true;
            let newVal = getValue() + moveEvent.movementX * sensitivity;
            if (moveEvent.metaKey || moveEvent.ctrlKey)
                newVal = Math.round(newVal / snapIncrement) * snapIncrement;
            newVal = Math.max(min, newVal);
            setValue(newVal);
            input.value = Number(getValue()).toFixed(2);
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (!hasMoved) { input.focus(); input.select(); }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// ============================================================
// XYZ INPUT ROW HELPER
// ============================================================
function xyzRow(labelText, axes, sensitivity = 0.1, snapIncrement = 1) {
    const row = document.createElement('div');
    row.className = 'ag-xyz-row';
    const lbl = document.createElement('span');
    lbl.className = 'ag-xyz-label';
    lbl.textContent = labelText;
    row.appendChild(lbl);

    const inputs = {};
    axes.forEach(({ key, getValue, setValue, min = -Infinity }) => {
        const field = document.createElement('input');
        field.type = 'text';
        field.className = 'ag-xyz-field';
        const commit = () => {
            const val = evalMath(field.value);
            if (val !== null && val >= min) setValue(val);
        };
        field.addEventListener('blur', commit);
        field.addEventListener('keydown', e => {
            if (e.key === 'Enter') { commit(); field.blur(); }
            if (e.key === 'Escape') field.blur();
        });
        makeScrubber(field, getValue, setValue, min, sensitivity, snapIncrement);
        row.appendChild(field);
        inputs[key] = field;
    });
    return { element: row, inputs };
}

// ============================================================
// LEFT PANEL
// ============================================================
function buildLeftPanel() {
    const col = document.createElement('div');
    col.className = 'ag-left-col';

    // ── Shape Mode panel ──
    const shapePanel = document.createElement('div');
    shapePanel.className = 'ag-left-panel';

    const header = document.createElement('div');
    header.className = 'ag-shape-mode-header';
    header.textContent = 'Shape Mode';
    shapePanel.appendChild(header);

    const modeRow = document.createElement('div');
    modeRow.className = 'ag-mode-buttons';
    const modes = [
        { key: 'point', icon: '⬡', title: 'Point select' },
        { key: 'edge',  icon: '⬢', title: 'Edge select'  },
        { key: 'face',  icon: '⬛', title: 'Face select'  },
    ];
    settings.selectMode = 'face';
    modes.forEach(mode => {
        const btn = document.createElement('button');
        btn.className = 'ag-mode-btn' + (mode.key === 'face' ? ' ag-active' : '');
        btn.textContent = mode.icon;
        btn.title = mode.title;
        btn.addEventListener('click', () => {
            modeRow.querySelectorAll('.ag-mode-btn').forEach(b => b.classList.remove('ag-active'));
            btn.classList.add('ag-active');
            settings.selectMode = mode.key;
        });
        modeRow.appendChild(btn);
    });
    shapePanel.appendChild(modeRow);
    col.appendChild(shapePanel);

    // ── Primitives panel ──
    const primPanel = document.createElement('div');
    primPanel.className = 'ag-left-panel';

    settings.primitiveMode = 'solid';
    const toggle = document.createElement('div');
    toggle.className = 'ag-toggle';
    ['Solid', 'Strut'].forEach(label => {
        const btn = document.createElement('button');
        btn.className = 'ag-toggle-btn' + (label === 'Solid' ? ' ag-active' : '');
        btn.textContent = label;
        btn.addEventListener('click', () => {
            toggle.querySelectorAll('.ag-toggle-btn').forEach(b => b.classList.remove('ag-active'));
            btn.classList.add('ag-active');
            settings.primitiveMode = label.toLowerCase();
        });
        toggle.appendChild(btn);
    });
    primPanel.appendChild(toggle);

    const primList = document.createElement('div');
    primList.className = 'ag-primitives';
    PRIMITIVE_TYPES.forEach(({ type, label, icon }) => {
        const btn = document.createElement('button');
        btn.className = 'ag-primitive-btn';
        btn.textContent = icon;
        btn.title = label;
        btn.addEventListener('click', () => { pushSnapshot(); addShape(type); });
        primList.appendChild(btn);
    });
    primPanel.appendChild(primList);
    col.appendChild(primPanel);

    document.body.appendChild(col);
}

// ============================================================
// RIGHT PANEL
// ============================================================
function buildRightPanel(rightOuter) {
    const content = document.createElement('div');
    content.className = 'ag-right-content';
    rightOuter.appendChild(content);

    function divider() {
        const d = document.createElement('div');
        d.className = 'ag-section-divider';
        return d;
    }

    function section(title) {
        const sec = document.createElement('div');
        sec.className = 'ag-panel-section';
        if (title) {
            const t = document.createElement('div');
            t.className = 'ag-section-title';
            t.textContent = title;
            sec.appendChild(t);
        }
        return sec;
    }

    function addSlider(parent, label, min, max, step, getValue, setValue) {
        const row = document.createElement('div');
        row.className = 'ag-slider-row';
        const lbl = document.createElement('span');
        lbl.className = 'ag-slider-label';
        lbl.textContent = label;
        const slider = document.createElement('input');
        slider.type = 'range'; slider.className = 'ag-slider';
        slider.min = min; slider.max = max; slider.step = step;
        slider.value = getValue();
        const valDisplay = document.createElement('span');
        valDisplay.className = 'ag-slider-value';
        valDisplay.textContent = Number(getValue()).toFixed(2);
        slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            setValue(v);
            valDisplay.textContent = v.toFixed(2);
        });
        slider.addEventListener('change', () => pushSnapshot());
        row.appendChild(lbl); row.appendChild(slider); row.appendChild(valDisplay);
        parent.appendChild(row);
    }

    // ---- LIGHTING ----
    const lightSection = section('Lighting');
    addSlider(lightSection, 'Ambient light',  0,   0.5, 0.01, () => settings.ambientLight, v => { settings.ambientLight = v; });
    addSlider(lightSection, 'X pos light',   -10,  10,  0.1,  () => settings.lightX,       v => { settings.lightX = v; });
    addSlider(lightSection, 'Y pos light',   -10,  10,  0.1,  () => settings.lightY,       v => { settings.lightY = v; });
    content.appendChild(lightSection);
    content.appendChild(divider());

    // ---- ALIGNMENT (placeholder) ----
    const alignSection = section('Local Controls');
    const alignRow = document.createElement('div');
    alignRow.className = 'ag-local-row';
    const alignLabel = document.createElement('label');
    alignLabel.textContent = 'Alignment to plane';
    const axisSelect = document.createElement('select');
    axisSelect.className = 'ag-compact-select';
    ['XY', 'XZ', 'YZ'].forEach(axis => {
        const opt = document.createElement('option');
        opt.value = axis; opt.textContent = axis;
        axisSelect.appendChild(opt);
    });
    alignRow.appendChild(alignLabel);
    alignRow.appendChild(axisSelect);
    alignSection.appendChild(alignRow);
    const alignBtns = document.createElement('div');
    alignBtns.className = 'ag-bool-buttons';
    for (let i = 0; i < 6; i++) {
        const btn = document.createElement('button');
        btn.className = 'ag-bool-btn';
        btn.textContent = '⊟';
        btn.title = 'Alignment (coming soon)';
        btn.disabled = true;
        alignBtns.appendChild(btn);
    }
    alignSection.appendChild(alignBtns);
    content.appendChild(alignSection);
    content.appendChild(divider());

    // ---- SHAPE LOCAL CONTROLS ----
    const localSection = section('Shape Local Controls');
    localControlsContainer = document.createElement('div');
    localControlsContainer.className = 'ag-panel-section';
    localSection.appendChild(localControlsContainer);
    localControls(getActiveShape(), localControlsContainer);
    content.appendChild(localSection);
    content.appendChild(divider());

    // ---- TRANSFORM ----
    const transformSection = section('Transform');

    const posRow = xyzRow('Position (mm)', [
        { key: 'x', getValue: () => getActiveShape()?.posOffset.x ?? 0, setValue: v => { const s = getActiveShape(); if (s) s.posOffset.x = v; } },
        { key: 'y', getValue: () => getActiveShape()?.posOffset.y ?? 0, setValue: v => { const s = getActiveShape(); if (s) s.posOffset.y = v; } },
        { key: 'z', getValue: () => getActiveShape()?.posOffset.z ?? 0, setValue: v => { const s = getActiveShape(); if (s) s.posOffset.z = v; } },
    ], 0.2, 10);
    posInputs = posRow.inputs;
    transformSection.appendChild(posRow.element);

    const rotRow = xyzRow('Rotation (deg)', [
        { key: 'x', getValue: () => (getActiveShape()?.rotation.x ?? 0) * 180 / Math.PI, setValue: v => { const s = getActiveShape(); if (s) s.rotation.x = v * Math.PI / 180; } },
        { key: 'y', getValue: () => (getActiveShape()?.rotation.y ?? 0) * 180 / Math.PI, setValue: v => { const s = getActiveShape(); if (s) s.rotation.y = v * Math.PI / 180; } },
        { key: 'z', getValue: () => (getActiveShape()?.rotation.z ?? 0) * 180 / Math.PI, setValue: v => { const s = getActiveShape(); if (s) s.rotation.z = v * Math.PI / 180; } },
    ], 0.5, 15);
    rotInputs = rotRow.inputs;
    transformSection.appendChild(rotRow.element);

    const scaleRow = xyzRow('Scale (mm)', [
        { key: 'x', getValue: () => getActiveShape()?.width  ?? 0, setValue: v => { const s = getActiveShape(); if (s) s.width  = Math.max(0.1, v); }, min: 0.1 },
        { key: 'y', getValue: () => getActiveShape()?.height ?? 0, setValue: v => { const s = getActiveShape(); if (s) s.height = Math.max(0.1, v); }, min: 0.1 },
        { key: 'z', getValue: () => getActiveShape()?.depth  ?? 0, setValue: v => { const s = getActiveShape(); if (s) s.depth  = Math.max(0.1, v); }, min: 0.1 },
    ], 0.2, 1);
    scaleInputs = scaleRow.inputs;
    transformSection.appendChild(scaleRow.element);

    const toGroundBtn = document.createElement('button');
    toGroundBtn.className = 'ag-action-btn';
    toGroundBtn.textContent = 'To Ground';
    toGroundBtn.addEventListener('click', () => {
        const shape = getActiveShape();
        if (!shape) return;
        const halfHeight =
            shape.type === 'sphere'     ? shape.width
          : shape.type === 'polyhedron' ? shape.width
          : shape.type === 'helix'      ? shape.turns * shape.stepHeight * 0.5 + shape.tubeRadius
          : shape.height;
        shape.posOffset.y = halfHeight;
    });
    transformSection.appendChild(toGroundBtn);

    const resetRotBtn = document.createElement('button');
    resetRotBtn.className = 'ag-action-btn';
    resetRotBtn.textContent = 'Reset Rotation';
    resetRotBtn.addEventListener('click', () => { getActiveShape()?.rotation.set(0, 0, 0); });
    transformSection.appendChild(resetRotBtn);

    content.appendChild(transformSection);
    content.appendChild(divider());

    // ---- BOOLEANS ----
    const boolSection = section('Booleans');
    const boolButtons = document.createElement('div');
    boolButtons.className = 'ag-bool-buttons';
    [
        { op: 'union',     label: 'Union',     icon: '∪' },
        { op: 'subtract',  label: 'Subtract',  icon: '∖' },
        { op: 'intersect', label: 'Intersect', icon: '∩' },
        { op: 'exclude',   label: 'Exclude',   icon: '⊻' },
    ].forEach(({ op, label, icon }) => {
        const btn = document.createElement('button');
        btn.className = 'ag-bool-btn';
        btn.textContent = icon;
        btn.title = label;
        btn.addEventListener('click', () => {
            const shape = getActiveShape();
            if (!shape) return;
            setBooleanOp(shape, op);
            boolButtons.querySelectorAll('.ag-bool-btn').forEach(b => b.classList.remove('ag-active'));
            btn.classList.add('ag-active');
        });
        boolButtons.appendChild(btn);
    });
    boolSection.appendChild(boolButtons);
    content.appendChild(boolSection);
    content.appendChild(divider());

    // ---- EXPORT ----
    const exportSection = section('Export');

    const fmtRow = document.createElement('div'); fmtRow.className = 'ag-local-row';
    const fmtKey = document.createElement('label'); fmtKey.className = 'ag-kv-key'; fmtKey.textContent = 'File format';
    const fmtSelect = document.createElement('select'); fmtSelect.className = 'ag-compact-select';
    ['STL', 'OBJ', 'STEP'].forEach(fmt => {
        const opt = document.createElement('option'); opt.value = fmt; opt.textContent = fmt;
        fmtSelect.appendChild(opt);
    });
    fmtRow.appendChild(fmtKey); fmtRow.appendChild(fmtSelect);
    exportSection.appendChild(fmtRow);

    const sizeRow = document.createElement('div'); sizeRow.className = 'ag-local-row';
    const sizeKey = document.createElement('span'); sizeKey.className = 'ag-kv-key'; sizeKey.textContent = 'Size estimation';
    const sizeVal = document.createElement('span'); sizeVal.className = 'ag-kv-value'; sizeVal.textContent = '—';
    sizeRow.appendChild(sizeKey); sizeRow.appendChild(sizeVal);
    exportSection.appendChild(sizeRow);

    const exportBtn = document.createElement('button');
    exportBtn.className = 'ag-action-btn';
    exportBtn.textContent = 'EXPORT FILE';
    exportSection.appendChild(exportBtn);
    content.appendChild(exportSection);
    content.appendChild(divider());

    // ---- UPLOAD ----
    const uploadSection = section('Upload');
    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'ag-action-btn';
    uploadBtn.textContent = 'UPLOAD FILE';
    uploadSection.appendChild(uploadBtn);
    content.appendChild(uploadSection);
}

// ============================================================
// PER-FRAME UPDATE — called from main.js animate()
// ============================================================
export function updatePanels() {
    const shape = getActiveShape();

    // Rebuild local controls only when active shape changes
    if (localControlsContainer) {
        const currentId   = shape ? shape.id   : -1;
        const currentType = shape ? shape.type : null;
        if (currentId !== lastRenderedShapeId || currentType !== lastRenderedShapeType) {
            localControls(shape, localControlsContainer);
            lastRenderedShapeId   = currentId;
            lastRenderedShapeType = currentType;
        }
    }

    // Refresh transform inputs — only write if value changed and field isn't focused
    function refresh(field, value) {
        if (!field || document.activeElement === field) return;
        const formatted = Number(value).toFixed(2);
        if (field.value !== formatted) field.value = formatted;
    }

    if (shape) {
        refresh(posInputs.x,   shape.posOffset.x);
        refresh(posInputs.y,   shape.posOffset.y);
        refresh(posInputs.z,   shape.posOffset.z);
        refresh(rotInputs.x,   shape.rotation.x * 180 / Math.PI);
        refresh(rotInputs.y,   shape.rotation.y * 180 / Math.PI);
        refresh(rotInputs.z,   shape.rotation.z * 180 / Math.PI);
        refresh(scaleInputs.x, shape.width);
        refresh(scaleInputs.y, shape.height);
        refresh(scaleInputs.z, shape.depth);
    } else {
        ['x', 'y', 'z'].forEach(k => {
            refresh(posInputs[k],   0);
            refresh(rotInputs[k],   0);
            refresh(scaleInputs[k], 0);
        });
    }
}

// ============================================================
// INIT — called once from main.js
// ============================================================
export function initPanels() {
    injectStyles();
    buildLeftPanel();

    const rightOuter = document.createElement('div');
    rightOuter.className = 'ag-right-outer';
    document.body.appendChild(rightOuter);

    buildStageTabs(rightOuter);
    buildRightPanel(rightOuter);
}

function buildStageTabs(rightOuter) {
    const tabs = document.createElement('div');
    tabs.className = 'ag-stage-tabs';
    STAGE_NAMES.forEach((name, i) => {
        const tab = document.createElement('button');
        tab.className = 'ag-stage-tab' + (i === 0 ? ' ag-active' : '');
        tab.textContent = name; tab.title = name;
        tab.addEventListener('click', () => {
            tabs.querySelectorAll('.ag-stage-tab').forEach(t => t.classList.remove('ag-active'));
            tab.classList.add('ag-active');
            settings.stage = name.toLowerCase().replace(/\s+/g, '_');
        });
        tabs.appendChild(tab);
    });
    rightOuter.appendChild(tabs);
}
