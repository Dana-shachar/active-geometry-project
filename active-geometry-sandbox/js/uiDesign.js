import { settings } from './uiSettings.js';
import { addShape, getActiveShape, setBooleanOp, selectedShapeIds, shapeList, keyObjId } from './shapeManager.js';
import { pushSnapshot } from './history.js';
import { alignShapes, distributeShapes, distributeShapesLive } from './alignDistribute.js';

// ============================================================
// CONFIG
// ============================================================
const STAGE_NAMES = ['Scene', 'Shape', 'Export & Import'];

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
let shellTogglePill        = null;
let shellThicknessField    = null;
let shellFormGridEl        = null;
let shellClipContainer     = null;
let shapeControlsEl        = null;
let activateTab            = null;   // fn(tabName) — programmatically switches tabs
let lastSelectionSize      = 0;
let localControlsContainer = null;
let lastRenderedShapeId    = -1;
let lastRenderedShapeType  = null;
let boolButtonsEl          = null;
let boolIcons              = {};   // op → <img> element

// ----------------------------------------------------------
// Alignment / Position section
// ----------------------------------------------------------
let alignCtrlsEl   = null;   // alignment + distribute sub-container — hidden when < 2 shapes selected
let alignIcons     = [];     // <img> elements for the 6 alignment icon buttons
let distAxisSelectEl = null; // <select> for the distribution axis
let distAxisSel      = 'X'; // currently active distribution axis
let alignBtnsRowEl   = null; // row of 6 alignment icon buttons — disabled when < 2 shapes
let distributeFormEl = null; // distribute axis + spacing form — disabled when < 2 shapes
let spacingInput   = null;
let filletSectionEl         = null;  // fillet section — hidden for unsupported shapes
let filletTrailingDividerEl = null;  // divider after fillet, shown/hidden with filletSectionEl
let filletField             = null;  // corner radius input

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

            --shell-toggle-frame-size:    36px;
            --shell-toggle-pill-w:        32px;
            --shell-toggle-pill-h:        16px;
            --shell-toggle-circle:        12px;
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
            width: max-content;
            max-width: var(--right-panel-max-width);
            min-height: 100vh;
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
            width: 100%;
        }
        .ag-stage-tab {
            flex: 1;
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
        .ag-bool-btn:hover { background: var(--btn-icon-active-bg); }
        .ag-bool-btn.ag-bool-active { background: var(--btn-icon-active-bg); }
        .ag-bool-btn:disabled { opacity: var(--btn-disabled-bg-opacity); cursor: default; pointer-events: none; }
        .ag-text-bool-btn { width: auto; padding: 0 var(--text-input-gap); }
        .ag-shell-form > input,
        .ag-shell-form > select:not(.ag-compact-select) { width: 100%; min-width: 0; }

        /* ── Shell toggle ── */
        .ag-shell-toggle-row {
            display: flex;
            align-items: center;
            gap: var(--text-input-gap);
            cursor: pointer;
        }
        .ag-shell-toggle-frame {
            width: var(--shell-toggle-frame-size);
            height: var(--shell-toggle-frame-size);
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }
        .ag-shell-toggle-pill {
            width: var(--shell-toggle-pill-w);
            height: var(--shell-toggle-pill-h);
            border-radius: 8px;
            background: var(--btn-icon-bg);
            border: var(--btn-stroke-weight) solid var(--btn-stroke);
            display: flex;
            align-items: center;
            padding: 2px;
        }
        .ag-shell-toggle-circle {
            width: var(--shell-toggle-circle);
            height: var(--shell-toggle-circle);
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.3);
            transition: transform 0.15s ease, background 0.1s;
            flex-shrink: 0;
        }
        .ag-shell-toggle-pill.ag-active .ag-shell-toggle-circle {
            transform: translateX(calc(var(--shell-toggle-pill-w) - var(--shell-toggle-circle) - 4px));
            background: var(--accent-primary);
        }
        .ag-shell-toggle-label {
            font: 300 12px var(--font);
            color: var(--text-primary);
        }
        .ag-shell-form {
            display: grid;
            grid-template-columns: max-content 1fr;
            column-gap: var(--text-input-gap);
            row-gap: var(--item-gap);
            align-items: center;
        }
        .ag-shell-form label {
            font: 300 12px var(--font);
            color: var(--text-primary);
            white-space: nowrap;
        }
        .ag-shell-thickness-field {
            flex: 1;
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
        .ag-shell-thickness-field:focus { outline: none; border-color: var(--input-focus-stroke); }
        .ag-tab-panel {
            display: flex;
            flex-direction: column;
            gap: var(--section-gap);
        }
        .ag-tab-panel--hidden {
            visibility: hidden;
            height: 0;
            overflow: hidden;
        }
        .ag-shape-controls-wrapper {
            display: flex;
            flex-direction: column;
            gap: var(--section-gap);
        }
        .ag-shell-section-disabled {
            opacity: var(--btn-disabled-text-opacity);
            pointer-events: none;
        }

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
            justify-self: start;
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
    if (shape.type === 'cylinder') {
        addRow('Cap ends', checkbox(() => shape.caps, v => { shape.caps = v; }));
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
function buildClipControls(forGrid = false) {
    const container = document.createElement('div');
    container.style.cssText = forGrid ? 'display:none' : 'display:flex; flex-direction:column; gap:var(--item-gap)';

    const axisLbl = document.createElement('label');
    axisLbl.textContent = 'Clip axis';
    const axisSelect = document.createElement('select');
    axisSelect.className = 'ag-compact-select';
    [['Off', 0], ['YZ', 1], ['XZ', 2], ['XY', 3]].forEach(([name, val]) => {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = name;
        if (settings.clipAxis === val) opt.selected = true;
        axisSelect.appendChild(opt);
    });

    const posLbl = document.createElement('label');
    posLbl.textContent = 'Position (mm)';
    const posInput = document.createElement('input');
    posInput.type = 'text';
    posInput.className = forGrid ? 'ag-shell-thickness-field' : 'ag-local-input';
    posInput.value = Number(settings.clipPos).toFixed(1);

    const commitPos = () => {
        const val = evalMath(posInput.value);
        if (val !== null) settings.clipPos = val;
        posInput.value = Number(settings.clipPos).toFixed(1);
    };
    posInput.addEventListener('blur', commitPos);
    posInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { commitPos(); posInput.blur(); }
        if (e.key === 'Escape') posInput.blur();
    });
    makeScrubber(posInput, () => settings.clipPos, v => { settings.clipPos = v; }, -200, 0.5, 5);

    function updateEnabled() {
        const isOff = settings.clipAxis === 0;
        posInput.disabled = isOff;
        posLbl.style.opacity = isOff ? 'var(--btn-disabled-text-opacity)' : '1';
        posInput.style.opacity = isOff ? 'var(--btn-disabled-text-opacity)' : '1';
        posInput.style.pointerEvents = isOff ? 'none' : 'auto';
    }
    updateEnabled();

    axisSelect.addEventListener('change', () => {
        settings.clipAxis = parseInt(axisSelect.value);
        updateEnabled();
    });

    if (forGrid) {
        container.appendChild(axisLbl); container.appendChild(axisSelect);
        container.appendChild(posLbl);  container.appendChild(posInput);
    } else {
        const axisRow = document.createElement('div');
        axisRow.className = 'ag-local-row';
        axisRow.appendChild(axisLbl); axisRow.appendChild(axisSelect);
        const posRow = document.createElement('div');
        posRow.className = 'ag-local-row';
        posRow.appendChild(posLbl); posRow.appendChild(posInput);
        container.appendChild(axisRow); container.appendChild(posRow);
    }

    return container;
}

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

    // ---- SCENE PANEL ----
    const scenePanel = document.createElement('div');
    scenePanel.className = 'ag-tab-panel';
    const lightSection = section('Lighting');
    addSlider(lightSection, 'Ambient light',  0,   0.5, 0.01, () => settings.ambientLight, v => { settings.ambientLight = v; });
    addSlider(lightSection, 'X pos light',   -10,  10,  0.1,  () => settings.lightX,       v => { settings.lightX = v; });
    addSlider(lightSection, 'Y pos light',   -10,  10,  0.1,  () => settings.lightY,       v => { settings.lightY = v; });
    scenePanel.appendChild(lightSection);
    scenePanel.appendChild(divider());

    // ---- DISPLAY SECTION ----
    const displaySection = section('Display');
    displaySection.appendChild(buildClipControls());
    scenePanel.appendChild(displaySection);
    content.appendChild(scenePanel);

    // ---- SHAPE PANEL ----
    const shapePanel = document.createElement('div');
    shapePanel.className = 'ag-tab-panel ag-tab-panel--hidden';

    // ---- SHAPE CONTROLS WRAPPER (greyed out when nothing selected) ----
    const shapeControlsWrapper = document.createElement('div');
    shapeControlsWrapper.className = 'ag-shape-controls-wrapper';
    shapeControlsEl = shapeControlsWrapper;

    // ---- ALIGNMENT / POSITION ----
    const alignPositionSection = section('Alignment / Position');
    const localCtrlSection = alignPositionSection; // alias — alignment controls are appended below

    // ── Alignment: plane picker + 6 icon buttons
    const alignForm = document.createElement('div');
    alignForm.className = 'ag-shell-form';
    const alignPlaneLabel = document.createElement('label');
    alignPlaneLabel.textContent = 'Alignment on plane';
    const alignPlaneSelect = document.createElement('select');
    alignPlaneSelect.className = 'ag-compact-select';
    ['XY', 'XZ', 'YZ'].forEach(plane => {
        const opt = document.createElement('option');
        opt.value = plane; opt.textContent = plane;
        alignPlaneSelect.appendChild(opt);
    });
    alignForm.appendChild(alignPlaneLabel);
    alignForm.appendChild(alignPlaneSelect);
    localCtrlSection.appendChild(alignForm);

    const alignBtnsRow = document.createElement('div');
    alignBtnsRow.className = 'ag-bool-buttons';
    alignBtnsRowEl = alignBtnsRow;
    alignIcons = [];
    [
        { op: 'left',    icon: 'alignLeft',        title: 'Align left'              },
        { op: 'hcenter', icon: 'horizontalCenter', title: 'Align horizontal center' },
        { op: 'right',   icon: 'alignRight',       title: 'Align right'             },
        { op: 'top',     icon: 'alignTop',         title: 'Align top'               },
        { op: 'vcenter', icon: 'verticalCenter',   title: 'Align vertical center'   },
        { op: 'bottom',  icon: 'alignBottom',      title: 'Align bottom'            },
    ].forEach(({ op, icon, title }) => {
        const btn = document.createElement('button');
        btn.className = 'ag-bool-btn';
        btn.title = title;
        const img = document.createElement('img');
        img.src = `/assets/icons/no-bg/${icon}.svg`;
        img.width = 24; img.height = 24; img.alt = title;
        btn.appendChild(img);
        btn.addEventListener('click', () => {
            const shapes = shapeList.filter(s => selectedShapeIds.has(s.id));
            alignShapes(shapes, alignPlaneSelect.value, op, keyObjId);
        });
        alignBtnsRow.appendChild(btn);
        alignIcons.push(img);
    });
    localCtrlSection.appendChild(alignBtnsRow);

    // ── Distribution: axis selector + spacing input
    const distributeForm = document.createElement('div');
    distributeForm.className = 'ag-shell-form';
    distributeFormEl = distributeForm;
    const distAxisLabel = document.createElement('label');
    distAxisLabel.textContent = 'Distribute to axis';
    distAxisSelectEl = document.createElement('select');
    distAxisSelectEl.className = 'ag-compact-select';
    ['X', 'Y', 'Z'].forEach(axis => {
        const opt = document.createElement('option');
        opt.value = axis; opt.textContent = axis;
        distAxisSelectEl.appendChild(opt);
    });
    distAxisSelectEl.addEventListener('change', () => {
        distAxisSel = distAxisSelectEl.value;
        const spacingMm = keyObjId !== null ? (evalMath(spacingInput.value) ?? null) : null;
        const shapes = shapeList.filter(s => selectedShapeIds.has(s.id));
        distributeShapes(shapes, distAxisSel, spacingMm, keyObjId);
    });
    distributeForm.appendChild(distAxisLabel);
    distributeForm.appendChild(distAxisSelectEl);
    const spacingLabel = document.createElement('label');
    spacingLabel.textContent = 'Spacing (mm)';
    spacingInput = document.createElement('input');
    spacingInput.type = 'text';
    spacingInput.className = 'ag-shell-thickness-field';
    spacingInput.placeholder = 'Auto';
    spacingInput.readOnly = true;
    const commitSpacing = () => {
        if (keyObjId === null) return;
        const shapes = shapeList.filter(s => selectedShapeIds.has(s.id));
        distributeShapes(shapes, distAxisSel, evalMath(spacingInput.value) ?? null, keyObjId);
    };
    spacingInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { commitSpacing(); spacingInput.blur(); }
        if (e.key === 'Escape') spacingInput.blur();
    });
    spacingInput.addEventListener('blur', commitSpacing);
    makeScrubber(
        spacingInput,
        () => parseFloat(spacingInput.value) || 0,
        v => {
            if (keyObjId === null || selectedShapeIds.size < 2) return;
            const mm = Math.max(0, v);
            spacingInput.value = mm.toFixed(2);
            const shapes = shapeList.filter(s => selectedShapeIds.has(s.id));
            distributeShapesLive(shapes, distAxisSel, mm, keyObjId);
        },
        0, 0.5, 1
    );
    distributeForm.appendChild(spacingLabel);
    distributeForm.appendChild(spacingInput);

    // Wrap alignment + distribute in a sub-container that hides when < 2 shapes selected
    alignCtrlsEl = document.createElement('div');
    alignCtrlsEl.className = 'ag-panel-section';
    alignCtrlsEl.style.display = 'none';
    alignCtrlsEl.appendChild(alignForm);
    alignCtrlsEl.appendChild(alignBtnsRow);
    alignCtrlsEl.appendChild(distributeForm);
    alignPositionSection.appendChild(alignCtrlsEl);

    // Shape-specific params always visible below alignment controls
    localControlsContainer = document.createElement('div');
    localControlsContainer.className = 'ag-panel-section';
    localControls(getActiveShape(), localControlsContainer);
    alignPositionSection.appendChild(localControlsContainer);

    shapeControlsWrapper.appendChild(alignPositionSection);
    shapeControlsWrapper.appendChild(divider());

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

    shapeControlsWrapper.appendChild(transformSection);
    shapeControlsWrapper.appendChild(divider());

    // ---- FILLET (box and cylinder only — wrapper hidden for unsupported shapes) ----
    filletSectionEl = document.createElement('div');
    filletSectionEl.style.cssText = 'display:none; flex-direction:column; gap:var(--section-gap)';
    const filletSection = section('Fillet');
    const filletForm = document.createElement('div');
    filletForm.className = 'ag-shell-form';
    const filletLabel = document.createElement('label');
    filletLabel.textContent = 'Corner radius (mm)';
    filletField = document.createElement('input');
    filletField.type = 'text';
    filletField.className = 'ag-shell-thickness-field';
    const commitFillet = () => {
        const shape = getActiveShape();
        if (!shape) return;
        const val = evalMath(filletField.value);
        if (val !== null && val >= 0) { pushSnapshot(); shape.cornerRadius = val; }
        filletField.value = Number(shape.cornerRadius).toFixed(2);
    };
    filletField.addEventListener('blur', commitFillet);
    filletField.addEventListener('keydown', e => {
        if (e.key === 'Enter') { commitFillet(); filletField.blur(); }
        if (e.key === 'Escape') filletField.blur();
    });
    makeScrubber(filletField, () => getActiveShape()?.cornerRadius ?? 0, v => { const s = getActiveShape(); if (s) s.cornerRadius = Math.max(0, v); }, 0, 0.1, 1);
    filletForm.appendChild(filletLabel);
    filletForm.appendChild(filletField);
    filletSection.appendChild(filletForm);
    filletSectionEl.appendChild(filletSection);
    shapeControlsWrapper.appendChild(filletSectionEl);

    // Trailing divider after Fillet — shown/hidden together with filletSectionEl
    filletTrailingDividerEl = divider();
    filletTrailingDividerEl.style.display = 'none';
    shapeControlsWrapper.appendChild(filletTrailingDividerEl);

    // ---- BOOLEANS ----
    const boolSection = section('Booleans');
    boolButtonsEl = document.createElement('div');
    boolButtonsEl.className = 'ag-bool-buttons';
    boolIcons = {};
    [
        { op: 'union',     label: 'Union'     },
        { op: 'subtract',  label: 'Subtract'  },
        { op: 'intersect', label: 'Intersect' },
        { op: 'exclude',   label: 'Exclude'   },
    ].forEach(({ op, label }) => {
        const btn = document.createElement('button');
        btn.className = 'ag-bool-btn';
        btn.title = label;
        btn.dataset.boolOp = op;
        const img = document.createElement('img');
        img.src = `/assets/icons/no-bg/${op}.svg`;
        img.width = 24;
        img.height = 24;
        img.alt = label;
        btn.appendChild(img);
        boolIcons[op] = img;
        btn.addEventListener('click', () => {
            const shape = getActiveShape();
            if (!shape) return;
            setBooleanOp(shape, op);
        });
        boolButtonsEl.appendChild(btn);
    });
    boolSection.appendChild(boolButtonsEl);
    shapeControlsWrapper.appendChild(boolSection);
    shapeControlsWrapper.appendChild(divider());

    // ---- SHELL ----
    const shellSection = section('Shell');

    const shellToggleRow = document.createElement('div');
    shellToggleRow.className = 'ag-shell-toggle-row';

    const shellFrame = document.createElement('div');
    shellFrame.className = 'ag-shell-toggle-frame';
    shellTogglePill = document.createElement('div');
    shellTogglePill.className = 'ag-shell-toggle-pill';
    const shellCircle = document.createElement('div');
    shellCircle.className = 'ag-shell-toggle-circle';
    shellTogglePill.appendChild(shellCircle);
    shellFrame.appendChild(shellTogglePill);

    const shellLabel = document.createElement('span');
    shellLabel.className = 'ag-shell-toggle-label';
    shellLabel.textContent = 'Shell';

    shellToggleRow.appendChild(shellFrame);
    shellToggleRow.appendChild(shellLabel);
    shellToggleRow.addEventListener('click', () => {
        const selectedShapes = shapeList.filter(s => selectedShapeIds.has(s.id));
        if (selectedShapes.length === 0) return;
        pushSnapshot();
        const newShellState = !selectedShapes[0].shellEnabled;
        selectedShapes.forEach(s => { s.shellEnabled = newShellState; });
        shellTogglePill.classList.toggle('ag-active', newShellState);
        if (shellClipContainer) shellClipContainer.style.display = newShellState ? 'contents' : 'none';
    });
    shellSection.appendChild(shellToggleRow);

    const shellFormGrid = document.createElement('div');
    shellFormGrid.className = 'ag-shell-form';
    shellFormGridEl = shellFormGrid;

    const shellThicknessLabel = document.createElement('label');
    shellThicknessLabel.textContent = 'Wall thickness (mm)';
    shellThicknessField = document.createElement('input');
    shellThicknessField.type = 'text';
    shellThicknessField.className = 'ag-shell-thickness-field';
    const commitThickness = () => {
        const selectedShapes = shapeList.filter(s => selectedShapeIds.has(s.id));
        if (selectedShapes.length === 0) return;
        const val = evalMath(shellThicknessField.value);
        if (val !== null && val > 0) {
            pushSnapshot();
            selectedShapes.forEach(s => { s.shellThickness = val; });
        }
        shellThicknessField.value = Number(selectedShapes[0].shellThickness ?? 1).toFixed(2);
    };
    shellThicknessField.addEventListener('blur', commitThickness);
    shellThicknessField.addEventListener('keydown', e => {
        if (e.key === 'Enter') { commitThickness(); shellThicknessField.blur(); }
        if (e.key === 'Escape') shellThicknessField.blur();
    });
    makeScrubber(shellThicknessField, () => getActiveShape()?.shellThickness ?? 1, v => {
        const mm = Math.max(0.1, v);
        shapeList.filter(s => selectedShapeIds.has(s.id)).forEach(s => { s.shellThickness = mm; });
    }, 0.1, 0.1, 0.5);
    shellFormGrid.appendChild(shellThicknessLabel);
    shellFormGrid.appendChild(shellThicknessField);
    shellSection.appendChild(shellFormGrid);

    shellClipContainer = buildClipControls(true);
    shellClipContainer.style.display = 'none';
    shellFormGrid.appendChild(shellClipContainer);

    shapeControlsWrapper.appendChild(shellSection);
    shapeControlsWrapper.appendChild(divider());
    shapePanel.appendChild(shapeControlsWrapper);
    content.appendChild(shapePanel);

    // ---- EXPORT & IMPORT PANEL ----
    const exportImportPanel = document.createElement('div');
    exportImportPanel.className = 'ag-tab-panel ag-tab-panel--hidden';

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
    exportImportPanel.appendChild(exportSection);
    exportImportPanel.appendChild(divider());

    // ---- UPLOAD ----
    const uploadSection = section('Upload');
    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'ag-action-btn';
    uploadBtn.textContent = 'UPLOAD FILE';
    uploadSection.appendChild(uploadBtn);
    exportImportPanel.appendChild(uploadSection);
    content.appendChild(exportImportPanel);

    return [
        { name: 'Scene',            el: scenePanel },
        { name: 'Shape',            el: shapePanel },
        { name: 'Export & Import',  el: exportImportPanel },
    ];
}

// ============================================================
// PER-FRAME UPDATE — called from main.js animate()
// ============================================================
export function updatePanels() {
    const shape = getActiveShape();

    // Auto-switch tabs on selection change
    if (activateTab) {
        const currentSize = selectedShapeIds.size;
        if (currentSize > 0 && lastSelectionSize === 0) activateTab('Shape');
        if (currentSize === 0 && lastSelectionSize > 0) activateTab('Scene');
        lastSelectionSize = currentSize;
    }

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

    // Refresh shell toggle + thickness field
    if (shellTogglePill && shellThicknessField && shapeControlsEl) {
        shapeControlsEl.classList.toggle('ag-shell-section-disabled', selectedShapeIds.size === 0);
        shellTogglePill.classList.toggle('ag-active', !!shape?.shellEnabled);
        if (shellFormGridEl) shellFormGridEl.classList.toggle('ag-shell-section-disabled', !shape?.shellEnabled);
        if (shellClipContainer) shellClipContainer.style.display = shape?.shellEnabled ? 'contents' : 'none';
        if (shape && document.activeElement !== shellThicknessField) {
            shellThicknessField.value = Number(shape.shellThickness).toFixed(2);
        }
    }

    // ── Alignment controls: show when 1+ shapes selected; disable when < 2
    if (alignCtrlsEl) {
        const hasSelection = selectedShapeIds.size >= 1;
        const canAlign     = selectedShapeIds.size >= 2;
        alignCtrlsEl.style.display = hasSelection ? '' : 'none';
        if (alignBtnsRowEl)   alignBtnsRowEl.classList.toggle('ag-shell-section-disabled', !canAlign);
        if (distributeFormEl) distributeFormEl.classList.toggle('ag-shell-section-disabled', !canAlign);
    }
    // ── Spacing input: disabled when < 2 shapes; readOnly (Auto) when no key object
    if (spacingInput && document.activeElement !== spacingInput) {
        const canDistribute = selectedShapeIds.size >= 2;
        const hasKeyObj     = keyObjId !== null;
        spacingInput.disabled    = !canDistribute;
        spacingInput.readOnly    = canDistribute && !hasKeyObj;
        spacingInput.placeholder = (canDistribute && !hasKeyObj) ? 'Auto' : '';
        if (!canDistribute || !hasKeyObj) spacingInput.value = '';
    }
    // ── Fillet: show only for box and cylinder
    if (filletSectionEl && filletField && document.activeElement !== filletField) {
        const showFillet = shape?.type === 'box' || shape?.type === 'cylinder';
        filletSectionEl.style.display = showFillet ? 'flex' : 'none';
        if (filletTrailingDividerEl) filletTrailingDividerEl.style.display = showFillet ? '' : 'none';
        if (showFillet) filletField.value = Number(shape.cornerRadius).toFixed(2);
    }

    // Sync boolean buttons — all yellow by default, Dis only when disabled,
    // background highlight on the current op
    if (boolButtonsEl) {
        const currentOp   = shape?.booleanOp ?? 'union';
        const singleShape = shapeList.length <= 1;
        boolButtonsEl.querySelectorAll('.ag-bool-btn').forEach(btn => {
            const btnOp     = btn.dataset.boolOp;
            const isDisabled = singleShape;
            boolIcons[btnOp].src = `/assets/icons/no-bg/${isDisabled ? btnOp + 'Dis' : btnOp}.svg`;
            btn.disabled = isDisabled;
            btn.classList.toggle('ag-bool-active', !!shape && btnOp === currentOp);
        });
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
    const panels = buildRightPanel(rightOuter);
    rightOuter._initTabSwitcher(panels);
}

function buildStageTabs(rightOuter) {
    const tabs = document.createElement('div');
    tabs.className = 'ag-stage-tabs';
    const tabButtons = [];

    STAGE_NAMES.forEach((name, i) => {
        const tab = document.createElement('button');
        tab.className = 'ag-stage-tab' + (i === 0 ? ' ag-active' : '');
        tab.textContent = name;
        tab.addEventListener('click', () => activateTab && activateTab(name));
        tabs.appendChild(tab);
        tabButtons.push({ name, tab });
    });

    rightOuter.appendChild(tabs);

    // Called after buildRightPanel has created the panels
    rightOuter._initTabSwitcher = (panels) => {
        activateTab = (targetName) => {
            tabButtons.forEach(({ name, tab }) => tab.classList.toggle('ag-active', name === targetName));
            panels.forEach(({ name, el }) => el.classList.toggle('ag-tab-panel--hidden', name !== targetName));
            settings.stage = targetName.toLowerCase().replace(/\s+/g, '_');
        };
    };
}
