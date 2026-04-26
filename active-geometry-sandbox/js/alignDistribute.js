import { setKeyObj, setActiveShape } from './shapeManager.js';
import { pushSnapshot } from './history.js';

// ==========================================================
// ALIGNMENT + DISTRIBUTION
// Align and distribute selected shapes on a chosen plane/axis.
// Also owns the key object click handler — the key object is
// the alignment reference shape that all others move relative to.
// ==========================================================

// ----------------------------------------------------------
// Key Object click handler
// Plain click on an already-selected shape in a 2+ multi-selection
// → marks it as the key object (alignment reference).
// Returns true if handled so main.js can skip its normal path.
// ----------------------------------------------------------
export function handleKeyObjClick(hitIndex, shapeList, selectedShapeIds) {
    if (hitIndex < 0)                                          return false;
    if (!selectedShapeIds.has(shapeList[hitIndex].id))         return false;
    if (selectedShapeIds.size <= 1)                            return false;
    setKeyObj(shapeList[hitIndex].id);
    setActiveShape(hitIndex);
    return true;
}

// ----------------------------------------------------------
// Bounding Box
// Approximate bounds per shape type — ignores rotation (MVP).
// Returns { minX, maxX, minY, maxY, minZ, maxZ }.
// ----------------------------------------------------------
export function shapeBounds(shape) {
    let hx, hy, hz;
    switch (shape.type) {
        case 'sphere':
        case 'polyhedron':
            hx = hy = hz = shape.width / 2;
            break;
        case 'box':
            hx = shape.width  / 2;
            hy = shape.height / 2;
            hz = shape.depth  / 2;
            break;
        case 'cylinder':
        case 'prism':
            hx = hz = shape.width  / 2;
            hy =      shape.height / 2;
            break;
        case 'helix':
            hx = hz = shape.width / 2 + shape.tubeRadius;
            hy =      (shape.stepHeight * shape.turns) / 2;
            break;
        default:
            hx = hy = hz = shape.width / 2;
    }
    return {
        minX: shape.posOffset.x - hx,  maxX: shape.posOffset.x + hx,
        minY: shape.posOffset.y - hy,  maxY: shape.posOffset.y + hy,
        minZ: shape.posOffset.z - hz,  maxZ: shape.posOffset.z + hz,
    };
}

// ----------------------------------------------------------
// Plane → axis mapping
// First axis = left / hcenter / right.
// Second axis = top / vcenter / bottom.
// ----------------------------------------------------------
const PLANE_AXIS1 = { XY: 'x', XZ: 'x', YZ: 'y' };
const PLANE_AXIS2 = { XY: 'y', XZ: 'z', YZ: 'z' };

// ----------------------------------------------------------
// Alignment
// plane:  'XY' | 'XZ' | 'YZ'
// iconOp: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
// Without key object: aligns to the collective bounding box extreme.
// With key object: aligns to the key object's edge/center (key object stays fixed).
// ----------------------------------------------------------
export function alignShapes(selectedShapes, plane, iconOp, keyObjId) {
    if (selectedShapes.length < 2) return;
    pushSnapshot();

    const isFirstAxis = ['left', 'hcenter', 'right'].includes(iconOp);
    const axis        = isFirstAxis ? PLANE_AXIS1[plane] : PLANE_AXIS2[plane];
    const minKey      = 'min' + axis.toUpperCase();
    const maxKey      = 'max' + axis.toUpperCase();
    const bounds      = selectedShapes.map(shapeBounds);

    // ── Reference edges
    let refMin, refMax;
    if (keyObjId !== null) {
        const keyIdx = selectedShapes.findIndex(s => s.id === keyObjId);
        refMin = bounds[keyIdx][minKey];
        refMax = bounds[keyIdx][maxKey];
    } else {
        refMin = Math.min(...bounds.map(b => b[minKey]));
        refMax = Math.max(...bounds.map(b => b[maxKey]));
    }
    const refCenter = (refMin + refMax) / 2;

    // ── Move each shape (key object never moves)
    for (let i = 0; i < selectedShapes.length; i++) {
        const shape = selectedShapes[i];
        if (keyObjId !== null && shape.id === keyObjId) continue;

        const halfSize = (bounds[i][maxKey] - bounds[i][minKey]) / 2;
        switch (iconOp) {
            case 'left':
            case 'bottom':   shape.posOffset[axis] = refMin + halfSize;  break;
            case 'hcenter':
            case 'vcenter':  shape.posOffset[axis] = refCenter;           break;
            case 'right':
            case 'top':      shape.posOffset[axis] = refMax - halfSize;  break;
        }
    }
}

// ----------------------------------------------------------
// Distribution
// axis:      'X' | 'Y' | 'Z'
// spacingMm: null   → auto — evenly distribute between the two extremes
//                    (extremes stay fixed, middles move)
//            number → exact gap in mm around key object
//                    (key object stays pinned, all others stack outward)
// ----------------------------------------------------------
export function distributeShapes(selectedShapes, axis, spacingMm, keyObjId) {
    if (selectedShapes.length < 2) return;
    pushSnapshot();

    const axisLow = axis.toLowerCase();
    const minKey  = 'min' + axis;
    const maxKey  = 'max' + axis;
    const bounds  = selectedShapes.map(shapeBounds);

    const sorted = selectedShapes
        .map((shape, i) => ({ shape, b: bounds[i] }))
        .sort((a, b) => a.b[minKey] - b.b[minKey]);

    if (spacingMm === null) {
        // ── Auto: evenly distribute — only middle shapes move
        const totalSpan      = sorted.at(-1).b[maxKey] - sorted[0].b[minKey];
        const totalShapeSize = sorted.reduce((sum, { b }) => sum + (b[maxKey] - b[minKey]), 0);
        const gapSize        = (totalSpan - totalShapeSize) / (sorted.length - 1);

        let cursor = sorted[0].b[minKey];
        for (let i = 0; i < sorted.length; i++) {
            const { shape, b } = sorted[i];
            const size = b[maxKey] - b[minKey];
            if (i > 0 && i < sorted.length - 1) {
                shape.posOffset[axisLow] = cursor + size / 2;
            }
            cursor += size + gapSize;
        }

    } else {
        // ── Exact spacing around key object (only active when key object is set)
        if (keyObjId === null) return;
        const keyIdx    = sorted.findIndex(({ shape }) => shape.id === keyObjId);
        const keyMinPos = sorted[keyIdx].b[minKey];
        const keyMaxPos = sorted[keyIdx].b[maxKey];

        // Shapes to the LEFT — stack outward from key object's min edge
        let cursor = keyMinPos;
        for (let i = keyIdx - 1; i >= 0; i--) {
            const size = sorted[i].b[maxKey] - sorted[i].b[minKey];
            const newMax = cursor - spacingMm;
            sorted[i].shape.posOffset[axisLow] = newMax - size / 2;
            cursor = newMax - size;
        }

        // Shapes to the RIGHT — stack outward from key object's max edge
        cursor = keyMaxPos;
        for (let i = keyIdx + 1; i < sorted.length; i++) {
            const size = sorted[i].b[maxKey] - sorted[i].b[minKey];
            const newMin = cursor + spacingMm;
            sorted[i].shape.posOffset[axisLow] = newMin + size / 2;
            cursor = newMin + size;
        }
    }
}
