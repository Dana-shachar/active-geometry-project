import { settings } from './uiSettings.js';
import { addShape, getActiveShape } from './shapeManager.js';

// ============================================================
// CONFIG
// ============================================================
const STAGE_NAMES = ['unit cell', 'locking', 'lattice', 'Geometry simulation'];

const PRIMITIVE_TYPES = [
    { type: 'sphere',     label: 'Sphere'     },
    { type: 'cylinder',   label: 'Cylinder'   },
    { type: 'box',        label: 'Box'        },
    { type: 'prism',      label: 'Prism'      },
    { type: 'polyhedron', label: 'Polyhedron' },
    { type: 'helix',      label: 'Helix'      },
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
        /* ── Design tokens ── */
        :root {
            --bg-canvas:                  #0C0C0D;
            --bg-panel:                   rgba(255, 255, 255, 0.25);
            --bg-tab-inactive:            rgba(255, 255, 255, 0.10);

            --btn-default-bg:             #5B5B5B;
            --btn-hover-bg:               #757575;
            --btn-stroke:                 #FFFFFF;
            --btn-icon-active-bg:         #39393C;
            --btn-padding:                4px;
            --btn-radius:                 4px;
            --btn-disabled-bg-opacity:    0.30;
            --btn-disabled-text-opacity:  0.40;

            --toggle-btn-width:           32px;
            --toggle-btn-height:          16px;
            --toggle-active-fill:         rgba(255, 255, 255, 0.20);
            --toggle-radius:              4px;

            --icon-btn-size:              24px;
            --icon-btn-gap:               6px;

            --dropdown-bg:                rgba(91, 91, 91, 0.80);

            --input-fill:                 rgba(242, 242, 247, 0.15);
            --input-stroke:               #F2F2F7;
            --input-stroke-weight:        0.25px;
            --input-focus-stroke:         #00C8B3;

            --divider-stroke:             rgba(255, 255, 255, 0.20);
            --divider-weight:             0.5px;

            --error-fill:                 rgba(179, 38, 30, 0.80);
            --error-stroke:               #F9DEDC;
            --error-text:                 #F9DEDC;

            --accent-primary:             #00C8B3;
            --accent-alt:                 #E5C11F;

            --text-primary:               #FFFFFF;
            --font:                       Helvetica;

            --panel-padding:              8px;
            --panel-radius:               4px;
            --section-gap:                12px;
            --item-gap:                   4px;
            --label-input-gap:            2px;
            --input-field-gap:            6px;
            --text-input-gap:             8px;
            --shape-menu-gap:             8px;
            --tab-height:                 18px;
            --tab-padding:                8px;
        }

        *, *::before, *::after { box-sizing: border-box; }

        /* ── Panels ── */
        .ag-left-panel {
            position: fixed;
            top: 0; left: 0;
            width: fit-content;
            height: fit-content;
            background: var(--bg-panel);
            border-radius: var(--panel-radius);
            padding: var(--panel-padding);
            z-index: 50;
            display: flex;
            flex-direction: column;
            gap: var(--shape-menu-gap);
        }
        .ag-right-outer {
            position: fixed;
            top: 0; right: 0;
            width: fit-content;
            height: fit-content;
            background: var(--bg-panel);
            border-radius: var(--panel-radius);
            z-index: 50;
            display: flex;
            flex-direction: column;
        }
        .ag-right-content {
            padding: var(--panel-padding);
            display: flex;
            flex-direction: column;
            gap: var(--section-gap);
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
            padding: var(--tab-padding);
            display: flex;
            align-items: center;
            justify-content: center;
            font: 300 6pt var(--font);
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
            border-bottom: 1px solid var(--accent-primary);
        }

        /* ── Section titles + dividers ── */
        .ag-section-title {
            font: 700 8pt var(--font);
            color: var(--text-primary);
            margin-bottom: var(--item-gap);
        }
        .ag-section-divider {
            width: 100%;
            height: var(--divider-weight);
            background: var(--divider-stroke);
        }
        .ag-subsection-title {
            font: 400 6pt var(--font);
            color: var(--text-primary);
            margin-bottom: var(--item-gap);
        }

        /* ── Left panel: mode buttons (icon, 24×24) ── */
        .ag-mode-buttons {
            display: flex;
            gap: var(--icon-btn-gap);
        }
        .ag-mode-btn {
            width: var(--icon-btn-size);
            height: var(--icon-btn-size);
            padding: var(--btn-padding);
            border: 1px solid var(--btn-stroke);
            background: var(--btn-default-bg);
            border-radius: var(--btn-radius);
            color: var(--text-primary);
            font: 300 6pt var(--font);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .ag-mode-btn:hover { background: var(--btn-hover-bg); }
        .ag-mode-btn.ag-active { background: var(--btn-icon-active-bg); border-color: var(--accent-primary); }
        .ag-mode-btn:disabled { opacity: var(--btn-disabled-bg-opacity); cursor: default; }
        .ag-mode-btn:disabled span { opacity: var(--btn-disabled-text-opacity); }

        /* ── Solid / Strut toggle ── */
        .ag-toggle {
            display: flex;
            border-radius: var(--toggle-radius);
            overflow: hidden;
        }
        .ag-toggle-btn {
            width: var(--toggle-btn-width);
            height: var(--toggle-btn-height);
            border: none;
            background: transparent;
            color: var(--text-primary);
            font: 300 6pt var(--font);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .ag-toggle-btn.ag-active { background: var(--toggle-active-fill); }

        /* ── Primitive buttons (icon, 24×24) ── */
        .ag-primitives {
            display: flex;
            flex-direction: column;
            gap: var(--shape-menu-gap);
        }
        .ag-primitive-btn {
            width: var(--icon-btn-size);
            height: var(--icon-btn-size);
            padding: var(--btn-padding);
            background: var(--btn-default-bg);
            border: 1px solid var(--btn-stroke);
            border-radius: var(--btn-radius);
            color: var(--text-primary);
            font: 300 6pt var(--font);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .ag-primitive-btn:hover { background: var(--btn-hover-bg); }

        /* ── Sliders ── */
        .ag-slider-row {
            display: flex;
            align-items: center;
            gap: var(--text-input-gap);
        }
        .ag-slider-label {
            font: 300 6pt var(--font);
            color: var(--text-primary);
            flex-shrink: 0;
        }
        input[type=range].ag-slider {
            flex: 1;
            height: 2px;
            accent-color: var(--accent-primary);
            cursor: pointer;
        }

        /* ── XYZ input rows ── */
        .ag-xyz-row {
            display: flex;
            align-items: center;
            gap: var(--text-input-gap);
        }
        .ag-xyz-label {
            font: 300 6pt var(--font);
            color: var(--text-primary);
            flex-shrink: 0;
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
            font: 300 6pt var(--font);
            color: var(--text-primary);
            opacity: 0.5;
        }
        .ag-xyz-field {
            width: 100%;
            background: var(--input-fill);
            border: var(--input-stroke-weight) solid var(--input-stroke);
            border-radius: 2px;
            color: var(--text-primary);
            font: 300 6pt var(--font);
            padding: 3px 4px;
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
            background: var(--btn-default-bg);
            border: 1px solid var(--btn-stroke);
            border-radius: var(--btn-radius);
            color: var(--text-primary);
            font: 300 6pt var(--font);
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
            font: 300 6pt var(--font);
            color: var(--text-primary);
            flex-shrink: 0;
        }
        .ag-local-input {
            flex: 1; min-width: 0;
            background: var(--input-fill);
            border: var(--input-stroke-weight) solid var(--input-stroke);
            border-radius: 2px;
            color: var(--text-primary);
            font: 300 6pt var(--font);
            padding: 3px 4px;
        }
        .ag-local-select {
            flex: 1; min-width: 0;
            background: var(--dropdown-bg);
            border: var(--input-stroke-weight) solid var(--input-stroke);
            border-radius: 2px;
            color: var(--text-primary);
            font: 300 6pt var(--font);
            padding: 3px 4px;
        }
        .ag-local-input:focus,
        .ag-local-select:focus { outline: none; border-color: var(--input-focus-stroke); }
        .ag-local-checkbox { accent-color: var(--accent-primary); }
        .ag-no-selection {
            font: 300 6pt var(--font);
            color: var(--text-primary);
            opacity: 0.3;
            text-align: center;
            padding: 8px 0;
        }

        /* ── Action buttons (Export / Upload / To Ground / Reset) ── */
        .ag-action-btn {
            padding: var(--btn-padding);
            background: var(--btn-default-bg);
            border: 1px solid var(--btn-stroke);
            border-radius: var(--btn-radius);
            color: var(--text-primary);
            font: 300 6pt var(--font);
            cursor: pointer;
            width: 100%;
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
        .ag-kv-key   { font: 300 6pt var(--font); color: var(--text-primary); opacity: 0.6; }
        .ag-kv-value { font: 300 6pt var(--font); color: var(--text-primary); }

        /* ── Error / Warning ── */
        .ag-error {
            padding: var(--btn-padding);
            background: var(--error-fill);
            border: 1px solid var(--error-stroke);
            border-radius: var(--btn-radius);
            color: var(--error-text);
            font: 300 6pt var(--font);
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

    function numInput(getValue, setValue, min = 0.1) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'ag-local-input';
        input.value = Number(getValue()).toFixed(2);
        const commit = () => {
            const val = evalMath(input.value);
            if (val !== null && val >= min) setValue(val);
            input.value = Number(getValue()).toFixed(2);
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { commit(); input.blur(); }
            if (e.key === 'Escape') { input.value = Number(getValue()).toFixed(2); input.blur(); }
        });
        return input;
    }

    function checkbox(getValue, setValue) {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'ag-local-checkbox';
        input.checked = getValue();
        input.addEventListener('change', () => setValue(input.checked));
        return input;
    }

    if (shape.type === 'sphere') {
        addRow('Radius (mm)',       numInput(() => shape.width, v => { shape.width = v; if (shape.lockProportions) shape.height = v; }));
        addRow('Lock proportions',  checkbox(() => shape.lockProportions, v => { shape.lockProportions = v; }));
    }
    if (shape.type === 'box') {
        addRow('Corner radius (mm)', numInput(() => shape.cornerRadius, v => { shape.cornerRadius = v; }, 0));
    }
    if (shape.type === 'cylinder') {
        addRow('Cap ends',           checkbox(() => shape.caps,         v => { shape.caps = v; }));
        addRow('Corner radius (mm)', numInput(() => shape.cornerRadius, v => { shape.cornerRadius = v; }, 0));
    }
    if (shape.type === 'prism') {
        const sidesInput = document.createElement('input');
        sidesInput.type = 'text'; sidesInput.className = 'ag-local-input';
        sidesInput.value = shape.sides;
        const commitSides = () => {
            const val = Math.round(parseFloat(sidesInput.value));
            if (val >= 3 && val <= 20) shape.sides = val;
            sidesInput.value = shape.sides;
        };
        sidesInput.addEventListener('blur', commitSides);
        sidesInput.addEventListener('keydown', e => { if (e.key === 'Enter') { commitSides(); sidesInput.blur(); } });
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
        select.addEventListener('change', () => { shape.polyType = parseInt(select.value); });
        addRow('Type', select);
    }
    if (shape.type === 'helix') {
        addRow('Coil radius (mm)', numInput(() => shape.width,      v => { shape.width = v; }));
        addRow('Tube radius (mm)', numInput(() => shape.tubeRadius, v => { shape.tubeRadius = v; }));
        addRow('Step height (mm)', numInput(() => shape.stepHeight, v => { shape.stepHeight = v; }));
        addRow('Turns',            numInput(() => shape.turns,      v => { shape.turns = v; }, 0.01));
    }
}

// ============================================================
// XYZ INPUT ROW HELPER
// ============================================================
function xyzRow(labelText, axes) {
    const row = document.createElement('div');
    row.className = 'ag-xyz-row';
    const lbl = document.createElement('span');
    lbl.className = 'ag-xyz-label';
    lbl.textContent = labelText;
    row.appendChild(lbl);

    const inputs = {};
    axes.forEach(({ key, setValue, min = -Infinity }) => {
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
        row.appendChild(field);
        inputs[key] = field;
    });
    return { element: row, inputs };
}

// ============================================================
// LEFT PANEL
// ============================================================
function buildLeftPanel() {
    const panel = document.createElement('div');
    panel.className = 'ag-left-panel';

    const header = document.createElement('div');
    header.className = 'ag-panel-header';
    header.textContent = 'Shape Mode';
    panel.appendChild(header);

    // Point / Edge / Face select mode
    const modeRow = document.createElement('div');
    modeRow.className = 'ag-mode-buttons';
    const modes = [
        { key: 'point', label: 'PT', title: 'Point select' },
        { key: 'edge',  label: 'ED', title: 'Edge select'  },
        { key: 'face',  label: 'FA', title: 'Face select'  },
    ];
    settings.selectMode = 'face';
    modes.forEach(mode => {
        const btn = document.createElement('button');
        btn.className = 'ag-mode-btn' + (mode.key === 'face' ? ' ag-active' : '');
        btn.textContent = mode.label;
        btn.title = mode.title;
        btn.addEventListener('click', () => {
            modeRow.querySelectorAll('.ag-mode-btn').forEach(b => b.classList.remove('ag-active'));
            btn.classList.add('ag-active');
            settings.selectMode = mode.key;
        });
        modeRow.appendChild(btn);
    });
    panel.appendChild(modeRow);

    // Solid / Strut toggle
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
    panel.appendChild(toggle);

    // Primitive list — click to add that shape
    const primList = document.createElement('div');
    primList.className = 'ag-primitives';
    PRIMITIVE_TYPES.forEach(({ type, label }) => {
        const btn = document.createElement('button');
        btn.className = 'ag-primitive-btn';
        btn.textContent = label;
        btn.addEventListener('click', () => addShape(type));
        primList.appendChild(btn);
    });
    panel.appendChild(primList);

    document.body.appendChild(panel);
}

// ============================================================
// RIGHT PANEL
// ============================================================
function buildRightPanel(rightOuter) {
    const content = document.createElement('div');
    content.className = 'ag-right-content';
    rightOuter.appendChild(content);

    // ---- LIGHTING ----
    const lightSection = document.createElement('div');
    lightSection.className = 'ag-panel-section';
    const lightTitle = document.createElement('div');
    lightTitle.className = 'ag-section-title';
    lightTitle.textContent = 'Lighting';
    lightSection.appendChild(lightTitle);

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
        slider.addEventListener('input', () => setValue(parseFloat(slider.value)));
        row.appendChild(lbl); row.appendChild(slider);
        parent.appendChild(row);
    }
    addSlider(lightSection, 'Ambient light',  0,   0.5, 0.01, () => settings.ambientLight, v => { settings.ambientLight = v; });
    addSlider(lightSection, 'X pos light',   -10,  10,  0.1,  () => settings.lightX,       v => { settings.lightX = v; });
    addSlider(lightSection, 'Y pos light',   -10,  10,  0.1,  () => settings.lightY,       v => { settings.lightY = v; });
    content.appendChild(lightSection);

    // ---- SHAPE LOCAL CONTROLS ----
    const localSection = document.createElement('div');
    localSection.className = 'ag-panel-section';
    const localTitle = document.createElement('div');
    localTitle.className = 'ag-section-title';
    localTitle.textContent = 'Shape Local Controls';
    localSection.appendChild(localTitle);
    localControlsContainer = document.createElement('div');
    localSection.appendChild(localControlsContainer);
    localControls(getActiveShape(), localControlsContainer);
    content.appendChild(localSection);

    // ---- TRANSFORM ----
    const transformSection = document.createElement('div');
    transformSection.className = 'ag-panel-section';
    const transformTitle = document.createElement('div');
    transformTitle.className = 'ag-section-title';
    transformTitle.textContent = 'Transform';
    transformSection.appendChild(transformTitle);

    const posRow = xyzRow('Position (mm)', [
        { key: 'x', getValue: () => getActiveShape()?.posOffset.x ?? 0, setValue: v => { const s = getActiveShape(); if (s) s.posOffset.x = v; } },
        { key: 'y', getValue: () => getActiveShape()?.posOffset.y ?? 0, setValue: v => { const s = getActiveShape(); if (s) s.posOffset.y = v; } },
        { key: 'z', getValue: () => getActiveShape()?.posOffset.z ?? 0, setValue: v => { const s = getActiveShape(); if (s) s.posOffset.z = v; } },
    ]);
    posInputs = posRow.inputs;
    transformSection.appendChild(posRow.element);

    const rotRow = xyzRow('Rotation (deg)', [
        { key: 'x', getValue: () => (getActiveShape()?.rotation.x ?? 0) * 180 / Math.PI, setValue: v => { const s = getActiveShape(); if (s) s.rotation.x = v * Math.PI / 180; } },
        { key: 'y', getValue: () => (getActiveShape()?.rotation.y ?? 0) * 180 / Math.PI, setValue: v => { const s = getActiveShape(); if (s) s.rotation.y = v * Math.PI / 180; } },
        { key: 'z', getValue: () => (getActiveShape()?.rotation.z ?? 0) * 180 / Math.PI, setValue: v => { const s = getActiveShape(); if (s) s.rotation.z = v * Math.PI / 180; } },
    ]);
    rotInputs = rotRow.inputs;
    transformSection.appendChild(rotRow.element);

    const scaleRow = xyzRow('Scale (mm)', [
        { key: 'x', getValue: () => getActiveShape()?.width  ?? 0, setValue: v => { const s = getActiveShape(); if (s) s.width  = Math.max(0.1, v); }, min: 0.1 },
        { key: 'y', getValue: () => getActiveShape()?.height ?? 0, setValue: v => { const s = getActiveShape(); if (s) s.height = Math.max(0.1, v); }, min: 0.1 },
        { key: 'z', getValue: () => getActiveShape()?.depth  ?? 0, setValue: v => { const s = getActiveShape(); if (s) s.depth  = Math.max(0.1, v); }, min: 0.1 },
    ]);
    scaleInputs = scaleRow.inputs;
    transformSection.appendChild(scaleRow.element);

    // To Ground + Reset Rotation
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

    // ---- BOOLEANS ----
    const boolSection = document.createElement('div');
    boolSection.className = 'ag-panel-section';
    const boolTitle = document.createElement('div');
    boolTitle.className = 'ag-section-title';
    boolTitle.textContent = 'Booleans';
    boolSection.appendChild(boolTitle);
    const boolButtons = document.createElement('div');
    boolButtons.className = 'ag-bool-buttons';
    [
        { op: 'union',     label: 'Union'     },
        { op: 'subtract',  label: 'Subtract'  },
        { op: 'intersect', label: 'Intersect' },
        { op: 'exclude',   label: 'Exclude'   },
    ].forEach(({ op, label }) => {
        const btn = document.createElement('button');
        btn.className = 'ag-bool-btn';
        btn.textContent = label;
        btn.addEventListener('click', () => {
            const shape = getActiveShape();
            if (!shape) return;
            shape.booleanOp = op;
            boolButtons.querySelectorAll('.ag-bool-btn').forEach(b => b.classList.remove('ag-active'));
            btn.classList.add('ag-active');
        });
        boolButtons.appendChild(btn);
    });
    boolSection.appendChild(boolButtons);
    content.appendChild(boolSection);

    // ---- EXPORT ----
    const exportSection = document.createElement('div');
    exportSection.className = 'ag-panel-section';
    const exportTitle = document.createElement('div');
    exportTitle.className = 'ag-section-title';
    exportTitle.textContent = 'Export';
    exportSection.appendChild(exportTitle);

    const fmtRow = document.createElement('div'); fmtRow.className = 'ag-kv-row';
    const fmtKey = document.createElement('span'); fmtKey.className = 'ag-kv-key'; fmtKey.textContent = 'File format';
    const fmtVal = document.createElement('span'); fmtVal.className = 'ag-kv-value'; fmtVal.textContent = 'STL';
    fmtRow.appendChild(fmtKey); fmtRow.appendChild(fmtVal);
    exportSection.appendChild(fmtRow);

    const sizeRow = document.createElement('div'); sizeRow.className = 'ag-kv-row';
    const sizeKey = document.createElement('span'); sizeKey.className = 'ag-kv-key'; sizeKey.textContent = 'Size';
    const sizeVal = document.createElement('span'); sizeVal.className = 'ag-kv-value'; sizeVal.textContent = '—';
    sizeRow.appendChild(sizeKey); sizeRow.appendChild(sizeVal);
    exportSection.appendChild(sizeRow);

    const exportBtn = document.createElement('button');
    exportBtn.className = 'ag-action-btn';
    exportBtn.textContent = 'EXPORT FILE';
    exportSection.appendChild(exportBtn);
    content.appendChild(exportSection);

    // ---- UPLOAD ----
    const uploadSection = document.createElement('div');
    uploadSection.className = 'ag-panel-section';
    const uploadTitle = document.createElement('div');
    uploadTitle.className = 'ag-section-title';
    uploadTitle.textContent = 'Upload';
    uploadSection.appendChild(uploadTitle);
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

    // Refresh transform inputs — skip fields that are currently focused
    function refresh(field, value) {
        if (!field || document.activeElement === field) return;
        field.value = Number(value).toFixed(2);
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
