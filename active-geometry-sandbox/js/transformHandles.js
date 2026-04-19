import * as THREE from 'three';
import { getActiveShape } from './shapeManager.js';
import { pushSnapshot } from './history.js';

// Each ring is perpendicular to its own axis (standard rotation handle convention).
// X ring wraps in YZ plane, Y ring wraps in XZ plane, Z ring wraps in XY plane.
const AXIS_CONFIGS = [
    { key: 'x', color: '#ff4444', dir: new THREE.Vector3(1, 0, 0),
      ringPlaneA: new THREE.Vector3(0, 1, 0), ringPlaneB: new THREE.Vector3(0, 0, 1) },
    { key: 'y', color: '#44ff88', dir: new THREE.Vector3(0, 1, 0),
      ringPlaneA: new THREE.Vector3(1, 0, 0), ringPlaneB: new THREE.Vector3(0, 0, 1) },
    { key: 'z', color: '#4488ff', dir: new THREE.Vector3(0, 0, 1),
      ringPlaneA: new THREE.Vector3(1, 0, 0), ringPlaneB: new THREE.Vector3(0, 1, 0) },
];

// Handle sizes are derived from settings.width each frame so they scale with
// both the shape size and the zoom level (world-space = proportional to camera distance).
const ARROW_SCALE   = 0.85;   // arrow shaft length  = shapeWidth * ARROW_SCALE
const RING_SCALE    = 0.55;  // ring radius          = shapeWidth * RING_SCALE
const CUBE_SCALE    = 1.00;  // scale cube distance  = shapeWidth * CUBE_SCALE
const HEAD_LEN      = 12;   // arrowhead length in pixels
const HEAD_WIDTH    =  6;   // arrowhead half-width in pixels
const CUBE_SIZE        =  7;               // axis scale cube half-size in pixels
const CENTER_CUBE_SIZE = CUBE_SIZE * 1.5;  // uniform scale cube
const RING_STEPS    = 48;   // polyline segments per ring
const RING_WIDTH    =  6;   // rotation ring stroke width in pixels
const HOVER_RADIUS  = 15;   // pixel proximity threshold for hover detection
const DRAG_SENSITIVITY     = 0.2;                    // mm per pixel of mouse movement along axis
const SNAP_MOVE_MM         = 10;                     // Cmd/Ctrl+drag snaps to 10mm increments
const DRAG_SENSITIVITY_ROT   = 0.5 * Math.PI / 180;   // radians per pixel for rotation drag
const SNAP_ROTATE_RAD        = 15  * Math.PI / 180;   // Cmd/Ctrl+drag snaps to 15° increments
const DRAG_SENSITIVITY_SCALE = 0.02;                   // scale factor per pixel (2%/px)
const HANDLE_SIZE_RATIO      = 1;   // handles are always 25% of shape's average dimension

// Per-shape-type mapping: which param each axis scale cube drives.
// Shapes with unused axes (e.g. polyhedron ignores height/depth) remap those axes to 'width'.
const SHAPE_AXIS_TO_PARAM = {
    box:        { x: 'width', y: 'height', z: 'depth'  },
    cylinder:   { x: 'width', y: 'height', z: 'width'  },
    prism:      { x: 'width', y: 'height', z: 'width'  },
    sphere:     { x: 'width', y: 'width',  z: 'width'  },
    polyhedron: { x: 'width', y: 'width',  z: 'width'  },
    helix:      { x: 'width', y: 'width',  z: 'width'  },
};
const SNAP_SCALE_FACTOR      = 0.1;                    // Cmd/Ctrl+drag snaps to 10% increments

export class TransformHandles {
    constructor(camera, settings, cameraControls, canvas) {
        this.camera          = camera;
        this.settings        = settings;
        this.cameraControls  = cameraControls;
        this.canvas          = canvas;
        this._elems          = {};
        this._mousePos       = { x: -9999, y: -9999 };
        this._hoveredKey     = null;
        this._hoveredType    = null;
        this._activeKey      = null;
        this._activeType     = null;
        this._screenAxisDir  = {};       // screen-space direction per axis, updated each frame
        this._isDragging     = false;
        this._dragAxisKey    = null;
        this._dragStartValue        = 0;    // posOffset/rotation/scale value when drag began
        this._dragCenterStartValues = null; // { width, height, depth } stored for center cube drag
        this._dragCumulativeDot     = 0;    // accumulated mouse-dot-axis pixels since drag start
        this._tooltipTimer          = null;

        window.addEventListener('mousemove', mouseEvent => {
            this._mousePos = { x: mouseEvent.clientX, y: mouseEvent.clientY };
            this._onDragMove(mouseEvent);
        });
        window.addEventListener('mouseup',   () => this._onDragEnd());
        canvas.addEventListener('mousedown', mouseEvent => this._onCanvasMousedown(mouseEvent));

        this._buildSVG();
        this._buildDragUI();
    }

    _buildDragUI() {
        this._tooltip = document.createElement('div');
        this._tooltip.style.cssText = `
            position: fixed;
            padding: 4px 8px;
            background: rgba(0,0,0,0.7);
            color: #fff;
            font: 400 12px var(--font);
            border-radius: 4px;
            pointer-events: none;
            display: none;
            z-index: 10000;
        `;
        this._tooltip.textContent = 'Hold Cmd / Ctrl to snap';
        document.body.appendChild(this._tooltip);

        this._liveLabel = document.createElement('div');
        this._liveLabel.style.cssText = `
            position: fixed;
            padding: 3px 7px;
            background: rgba(0,0,0,0.8);
            color: #fff;
            font: 400 12px var(--font);
            border-radius: 3px;
            pointer-events: none;
            display: none;
            z-index: 10000;
        `;
        document.body.appendChild(this._liveLabel);
    }

    _buildSVG() {
        const svgNS = 'http://www.w3.org/2000/svg';
        this.svg = document.createElementNS(svgNS, 'svg');
        this.svg.style.cssText = `
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
            overflow: visible;
            z-index: 9999;
        `;
        this.svg.style.display = 'none';

        for (const cfg of AXIS_CONFIGS) {
            // Rotation wedge — filled arc indicator during ring drag, drawn first (behind everything)
            const wedge = document.createElementNS(svgNS, 'polygon');
            wedge.setAttribute('fill', cfg.color);
            wedge.setAttribute('fill-opacity', '0.3');
            wedge.setAttribute('stroke', 'none');
            wedge.style.display = 'none';

            // Rotation ring — drawn second so it sits on top of wedge but behind arrows
            const ring = document.createElementNS(svgNS, 'path');
            ring.setAttribute('stroke', cfg.color);
            ring.setAttribute('stroke-width', String(RING_WIDTH));
            ring.setAttribute('stroke-opacity', '0.75');
            ring.setAttribute('fill', 'none');
            ring.setAttribute('stroke-linecap', 'round');

            // Arrow shaft
            const shaft = document.createElementNS(svgNS, 'line');
            shaft.setAttribute('stroke', cfg.color);
            shaft.setAttribute('stroke-width', '2');
            shaft.setAttribute('stroke-linecap', 'round');

            // Arrowhead (move handle)
            const head = document.createElementNS(svgNS, 'polygon');
            head.setAttribute('fill', cfg.color);

            // Scale cube — screen-aligned square
            const cube = document.createElementNS(svgNS, 'rect');
            cube.setAttribute('fill', cfg.color);
            cube.setAttribute('fill-opacity', '0.9');

            this.svg.appendChild(wedge);
            this.svg.appendChild(ring);
            this.svg.appendChild(shaft);
            this.svg.appendChild(head);
            this.svg.appendChild(cube);

            this._elems[cfg.key] = { wedge, ring, shaft, head, cube };
        }

        // Center cube — uniform scale handle, sits at origin
        this._centerCubeElem = document.createElementNS(svgNS, 'rect');
        this._centerCubeElem.setAttribute('fill', '#ffd700');
        this._centerCubeElem.setAttribute('fill-opacity', '0.3');
        this.svg.appendChild(this._centerCubeElem);

        document.body.appendChild(this.svg);
    }

    // Converts a world-space THREE.Vector3 to {x, y, z} screen coords.
    // z is NDC depth — points behind the camera have z > 1.
    _project(worldPos) {
        const ndc = worldPos.clone().project(this.camera);
        return {
            x: (ndc.x + 1) * 0.5 * window.innerWidth,
            y: (1 - ndc.y) * 0.5 * window.innerHeight,
            z: ndc.z,
        };
    }

    update() {
        const isSelected  = this.settings.uIsSelected === 1;
        const activeShape = getActiveShape();
        this.svg.style.display = (isSelected && activeShape) ? '' : 'none';
        if (!isSelected || !activeShape) {
            this._activeKey  = null;
            this._activeType = null;
            return;
        }

        const origin       = activeShape.posOffset;
        const originScreen = this._project(origin);
        const mouseX   = this._mousePos.x;
        const mouseY   = this._mousePos.y;
        // effectiveSize = 25% of shape's average dimension.
        // Handles always proportional to shape size — scales naturally with zoom.
        const avgDim        = (activeShape.width + activeShape.height + activeShape.depth) / 3;
        const effectiveSize = avgDim * HANDLE_SIZE_RATIO;
        const worldArrow    = effectiveSize * ARROW_SCALE;
        const worldRing     = effectiveSize * RING_SCALE;
        const worldCube     = effectiveSize * CUBE_SCALE;

        // === PASS 1: compute geometry + distances for every handle ===
        // Collect all candidates so we can find the single closest one before drawing.
        const perAxis = {};
        const hoverCandidates = [];   // { dist, key, type }

        for (const cfg of AXIS_CONFIGS) {
            // Arrow tip
            const tipWorld   = origin.clone().addScaledVector(cfg.dir, worldArrow);
            const tipScreen  = this._project(tipWorld);
            const screenDeltaX    = tipScreen.x - originScreen.x;
            const screenDeltaY    = tipScreen.y - originScreen.y;
            const arrowDistCenter = Math.sqrt(screenDeltaX * screenDeltaX + screenDeltaY * screenDeltaY);
            const arrowDirX  = arrowDistCenter > 0 ? screenDeltaX / arrowDistCenter : 1;
            const arrowDirY  = arrowDistCenter > 0 ? screenDeltaY / arrowDistCenter : 0;
            this._screenAxisDir[cfg.key] = { x: arrowDirX, y: arrowDirY, tipX: tipScreen.x, tipY: tipScreen.y };
            const arrowPx    = -arrowDirY;
            const arrowPy    =  arrowDirX;
            const arrowDist  = Math.hypot(mouseX - tipScreen.x, mouseY - tipScreen.y);
            hoverCandidates.push({ dist: arrowDist, key: cfg.key, type: 'arrow' });

            // Rotation ring — build SVG path and track closest point to mouse
            const ringPathParts = [];
            let penDown        = false;
            let minRingDist    = Infinity;

            for (let i = 0; i <= RING_STEPS; i++) {
                const angle       = (i / RING_STEPS) * Math.PI * 2;
                const ringPt      = origin.clone()
                    .addScaledVector(cfg.ringPlaneA, Math.cos(angle) * worldRing)
                    .addScaledVector(cfg.ringPlaneB, Math.sin(angle) * worldRing);
                const ringPointScreen = this._project(ringPt);

                if (ringPointScreen.z > 1) { penDown = false; continue; }

                const mouseDistToRingPoint = Math.hypot(mouseX - ringPointScreen.x, mouseY - ringPointScreen.y);
                if (mouseDistToRingPoint < minRingDist) minRingDist = mouseDistToRingPoint;

                ringPathParts.push(penDown
                    ? `L ${ringPointScreen.x.toFixed(1)} ${ringPointScreen.y.toFixed(1)}`
                    : `M ${ringPointScreen.x.toFixed(1)} ${ringPointScreen.y.toFixed(1)}`);
                penDown = true;
            }
            hoverCandidates.push({ dist: minRingDist, key: cfg.key, type: 'ring' });

            // Scale cube
            const cubeWorld  = origin.clone().addScaledVector(cfg.dir, worldCube);
            const cubeScreen = this._project(cubeWorld);
            const cubeDist   = Math.hypot(mouseX - cubeScreen.x, mouseY - cubeScreen.y);
            hoverCandidates.push({ dist: cubeDist, key: cfg.key, type: 'cube' });

            perAxis[cfg.key] = { tipScreen, arrowDirX, arrowDirY, arrowPx, arrowPy, ringPathParts, cubeScreen };
        }

        // Center cube — uniform scale handle at origin
        const centerDist = Math.hypot(mouseX - originScreen.x, mouseY - originScreen.y);
        hoverCandidates.push({ dist: centerDist, key: 'center', type: 'center' });
        this._screenAxisDir['center'] = { x: 1, y: 0, tipX: originScreen.x, tipY: originScreen.y };

        // Single winner: closest handle within HOVER_RADIUS — only this one gets bold.
        // Frozen to null during drag — no handles bold while interaction is active.
        const closest = hoverCandidates.reduce((best, c) => c.dist < best.dist ? c : best);
        this._hoveredKey  = (!this._isDragging && closest.dist < HOVER_RADIUS) ? closest.key  : null;
        this._hoveredType = (!this._isDragging && closest.dist < HOVER_RADIUS) ? closest.type : null;

        // === PASS 2: draw all handles, applying bold only to the winner ===
        for (const cfg of AXIS_CONFIGS) {
            const { wedge, ring, shaft, head, cube } = this._elems[cfg.key];
            const { tipScreen, arrowDirX, arrowDirY, arrowPx, arrowPy, ringPathParts, cubeScreen } = perAxis[cfg.key];

            const arrowHov = this._hoveredKey === cfg.key && this._hoveredType === 'arrow';
            const ringHov  = this._hoveredKey === cfg.key && this._hoveredType === 'ring';
            const cubeHov  = this._hoveredKey === cfg.key && this._hoveredType === 'cube';

            // Arrow shaft
            shaft.setAttribute('stroke-width', arrowHov ? '3' : '2');
            shaft.setAttribute('x1', originScreen.x.toFixed(1));
            shaft.setAttribute('y1', originScreen.y.toFixed(1));
            shaft.setAttribute('x2', tipScreen.x.toFixed(1));
            shaft.setAttribute('y2', tipScreen.y.toFixed(1));

            // Arrowhead
            const arrowHeadH      = arrowHov ? HEAD_LEN   * 1.4 : HEAD_LEN;
            const arrowHeadW      = arrowHov ? HEAD_WIDTH  * 1.4 : HEAD_WIDTH;
            const arrowTipX       = tipScreen.x;
            const arrowTipY       = tipScreen.y;
            const arrowBaseLeftX  = tipScreen.x - arrowHeadH * arrowDirX - arrowHeadW * arrowPx;
            const arrowBaseLeftY  = tipScreen.y - arrowHeadH * arrowDirY - arrowHeadW * arrowPy;
            const arrowBaseRightX = tipScreen.x - arrowHeadH * arrowDirX + arrowHeadW * arrowPx;
            const arrowBaseRightY = tipScreen.y - arrowHeadH * arrowDirY + arrowHeadW * arrowPy;
            head.setAttribute('points',
                `${arrowTipX.toFixed(1)},${arrowTipY.toFixed(1)} ` +
                `${arrowBaseLeftX.toFixed(1)},${arrowBaseLeftY.toFixed(1)} ` +
                `${arrowBaseRightX.toFixed(1)},${arrowBaseRightY.toFixed(1)}`
            );

            // Rotation ring
            ring.setAttribute('stroke-width',   ringHov ? String(RING_WIDTH * 1.6) : String(RING_WIDTH));
            ring.setAttribute('stroke-opacity', ringHov ? '1' : '0.75');
            ring.setAttribute('d', ringPathParts.join(' '));

            // Scale cube
            const cubeSize = cubeHov ? CUBE_SIZE * 1.5 : CUBE_SIZE;
            cube.setAttribute('x',      (cubeScreen.x - cubeSize).toFixed(1));
            cube.setAttribute('y',      (cubeScreen.y - cubeSize).toFixed(1));
            cube.setAttribute('width',  (cubeSize * 2).toFixed(1));
            cube.setAttribute('height', (cubeSize * 2).toFixed(1));

            // Rotation wedge — filled arc from angle 0 to current drag angle, shown only during ring drag
            const isActiveRingDrag = this._isDragging && this._activeType === 'ring' && this._dragAxisKey === cfg.key;
            if (isActiveRingDrag) {
                const wedgeAngle  = this._dragStartValue - getActiveShape().rotation[this._dragAxisKey];
                const wedgeSteps  = Math.max(2, Math.ceil(Math.abs(wedgeAngle) / (5 * Math.PI / 180)));
                const wedgePoints = [`${originScreen.x.toFixed(1)},${originScreen.y.toFixed(1)}`];
                for (let step = 0; step <= wedgeSteps; step++) {
                    const stepAngle   = wedgeAngle * step / wedgeSteps;
                    const wedgePt     = origin.clone()
                        .addScaledVector(cfg.ringPlaneA, Math.cos(stepAngle) * worldRing)
                        .addScaledVector(cfg.ringPlaneB, Math.sin(stepAngle) * worldRing);
                    const wedgePtScreen = this._project(wedgePt);
                    wedgePoints.push(`${wedgePtScreen.x.toFixed(1)},${wedgePtScreen.y.toFixed(1)}`);
                }
                wedge.setAttribute('points', wedgePoints.join(' '));
                wedge.style.display = '';
            } else {
                wedge.style.display = 'none';
            }
        }

        // Center cube draw
        const centerHov      = this._hoveredKey === 'center';
        const centerCubeSize = centerHov ? CENTER_CUBE_SIZE * 1.5 : CENTER_CUBE_SIZE;
        this._centerCubeElem.setAttribute('x',      (originScreen.x - centerCubeSize).toFixed(1));
        this._centerCubeElem.setAttribute('y',      (originScreen.y - centerCubeSize).toFixed(1));
        this._centerCubeElem.setAttribute('width',  (centerCubeSize * 2).toFixed(1));
        this._centerCubeElem.setAttribute('height', (centerCubeSize * 2).toFixed(1));
    }

    _onCanvasMousedown(mouseEvent) {
        if (mouseEvent.button !== 0) return;
        const validTypes = ['arrow', 'ring', 'cube', 'center'];
        if (!validTypes.includes(this._hoveredType) || this._hoveredKey === null) return;

        // Mousedown on a hovered handle = activate + start drag immediately.
        // Snapshot before any values change so undo restores the pre-drag state.
        pushSnapshot();
        this._activeKey  = this._hoveredKey;
        this._activeType = this._hoveredType;

        this._isDragging  = true;
        this._dragAxisKey = this._hoveredKey;

        const dragShape    = getActiveShape();
        const axisToParam  = SHAPE_AXIS_TO_PARAM[dragShape.type] ?? SHAPE_AXIS_TO_PARAM.box;
        if (this._hoveredType === 'ring') {
            this._dragStartValue = dragShape.rotation[this._hoveredKey];
        } else if (this._hoveredType === 'cube') {
            this._dragStartValue = dragShape[axisToParam[this._hoveredKey]];
        } else if (this._hoveredType === 'center') {
            this._dragStartValue        = dragShape.width;
            this._dragCenterStartValues = {
                width:  dragShape.width,
                height: dragShape.height,
                depth:  dragShape.depth,
            };
        } else {
            this._dragStartValue = dragShape.posOffset[this._hoveredKey];
        }
        this._dragCumulativeDot = 0;
        this.settings.handleDragActive = true;
        this.cameraControls.enabled    = false;

        const axisDir = this._screenAxisDir[this._activeKey];
        if (axisDir) {
            this._tooltip.style.left = (axisDir.tipX + 15) + 'px';
            this._tooltip.style.top  = (axisDir.tipY - 24) + 'px';
        }
        this._tooltip.style.display = '';
        clearTimeout(this._tooltipTimer);
        this._tooltipTimer = setTimeout(() => { this._tooltip.style.display = 'none'; }, 5000);
    }

    _onDragMove(mouseEvent) {
        if (!this._isDragging) return;
        const axisDir = this._screenAxisDir[this._dragAxisKey];
        if (!axisDir) return;

        // Arrows/cubes: project onto axis direction. Rings: perpendicular. Center: horizontal.
        const screenPerpX = -axisDir.y;
        const screenPerpY =  axisDir.x;
        const dragDirX = this._activeType === 'ring'   ? screenPerpX
                       : this._activeType === 'center' ? 1
                       : axisDir.x;
        const dragDirY = this._activeType === 'ring'   ? screenPerpY
                       : this._activeType === 'center' ? 0
                       : axisDir.y;
        this._dragCumulativeDot += mouseEvent.movementX * dragDirX + mouseEvent.movementY * dragDirY;

        const cmdHeld      = mouseEvent.metaKey || mouseEvent.ctrlKey;
        const moveShape    = getActiveShape();
        const axisToParam  = SHAPE_AXIS_TO_PARAM[moveShape.type] ?? SHAPE_AXIS_TO_PARAM.box;
        let newValue;
        let labelText;

        if (this._activeType === 'ring') {
            const rawAngle = this._dragCumulativeDot * DRAG_SENSITIVITY_ROT;
            newValue = cmdHeld
                ? Math.round((this._dragStartValue + rawAngle) / SNAP_ROTATE_RAD) * SNAP_ROTATE_RAD
                : this._dragStartValue + rawAngle;
            moveShape.rotation[this._dragAxisKey] = newValue;
            const angleDeg = (newValue * 180 / Math.PI).toFixed(1);
            labelText = `${this._dragAxisKey.toUpperCase()}: ${angleDeg}°`;
        } else if (this._activeType === 'cube') {
            const paramKey       = axisToParam[this._dragAxisKey];
            const rawScale       = this._dragCumulativeDot * DRAG_SENSITIVITY_SCALE;
            const snapIncrement  = this._dragStartValue * SNAP_SCALE_FACTOR;
            const scaledValue    = this._dragStartValue * (1 + rawScale);
            newValue = cmdHeld
                ? Math.round(scaledValue / snapIncrement) * snapIncrement
                : scaledValue;
            newValue = Math.max(0.1, newValue);
            moveShape[paramKey] = newValue;
            // For locked-proportion shapes (sphere, polyhedron), keep height/depth in sync with width.
            if (moveShape.lockProportions) {
                moveShape.width  = newValue;
                moveShape.height = newValue;
                moveShape.depth  = newValue;
            }
            labelText = `${paramKey.charAt(0).toUpperCase()}: ${newValue.toFixed(1)}`;
        } else if (this._activeType === 'center') {
            const rawScale    = this._dragCumulativeDot * DRAG_SENSITIVITY_SCALE;
            const scaleFactor = cmdHeld
                ? Math.round((1 + rawScale) / SNAP_SCALE_FACTOR) * SNAP_SCALE_FACTOR
                : 1 + rawScale;
            moveShape.width  = Math.max(0.1, this._dragCenterStartValues.width  * scaleFactor);
            moveShape.height = Math.max(0.1, this._dragCenterStartValues.height * scaleFactor);
            moveShape.depth  = Math.max(0.1, this._dragCenterStartValues.depth  * scaleFactor);
            newValue  = scaleFactor;
            labelText = `Scale: ${scaleFactor.toFixed(2)}×`;
        } else {
            const rawDisplacement = this._dragCumulativeDot * DRAG_SENSITIVITY;
            newValue = cmdHeld
                ? Math.round((this._dragStartValue + rawDisplacement) / SNAP_MOVE_MM) * SNAP_MOVE_MM
                : this._dragStartValue + rawDisplacement;
            moveShape.posOffset[this._dragAxisKey] = newValue;
            labelText = `${this._dragAxisKey.toUpperCase()}: ${newValue.toFixed(1)}`;
        }

        this._liveLabel.textContent   = labelText;
        this._liveLabel.style.left    = (axisDir.tipX + 15) + 'px';
        this._liveLabel.style.top     = (axisDir.tipY + 10) + 'px';
        this._liveLabel.style.display = '';
    }

    _onDragEnd() {
        if (!this._isDragging) return;
        this._isDragging               = false;
        this._dragAxisKey              = null;
        this.settings.handleDragActive = false;
        this.cameraControls.enabled    = true;
        this._liveLabel.style.display  = 'none';
    }

    // Called by main.js click handler before shape selection logic.
    // Returns true if the click was consumed by a handle (caller should skip deselection).
    handleClick() {
        if (this._hoveredKey !== null) {
            this._activeKey  = this._hoveredKey;
            this._activeType = this._hoveredType;
            return true;
        }
        this._activeKey  = null;
        this._activeType = null;
        return false;
    }
}
