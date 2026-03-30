// ==========================================================
// HISTORY — Undo / Redo + Snapshot Serialization
//
// toSnapshot() produces the canonical app-state JSON agreed in the roadmap.
// The same format is used for the undo stack, Pin Board, and (Phase 4) LLM payload.
// ==========================================================

import { shapeList, clearSelection, restoreShapeList } from './shapeManager.js';
import { settings } from './uiSettings.js';

const UNDO_STACK_LIMIT = 50;

const undoStack = [];
const redoStack = [];

// ==========================================================
// SERIALIZATION
// ==========================================================

// Serialize the current scene to a plain, JSON-safe object.
// THREE.Vector3 / THREE.Euler are flattened to plain {x, y, z} so JSON.stringify
// works without circular-reference errors.
// activeShapeIndex is intentionally excluded — selection always resets to -1 on restore.
export function toSnapshot() {
    return {
        scene_id: `snapshot_${Date.now()}`,
        global_settings: {
            // Live scene settings
            ambientLight:       settings.ambientLight,
            lightX:             settings.lightX,
            lightY:             settings.lightY,
            // Phase 2 placeholders — filled in when those features ship
            shell_mode:         false,
            shell_thickness_mm: 0.0,
            fillet_radius_mm:   0.0,
            // Phase 4 placeholder
            target_material:    null,
        },
        lattice_array: null,   // Phase 3 placeholder
        fgm_modifier:  null,   // Phase 3 placeholder
        unit_cell_tree: shapeList.map(shape => ({
            node_id:         String(shape.id),
            type:            shape.type,
            booleanOp:       shape.booleanOp,
            posOffset:       { x: shape.posOffset.x, y: shape.posOffset.y, z: shape.posOffset.z },
            rotation:        { x: shape.rotation.x,  y: shape.rotation.y,  z: shape.rotation.z  },
            lockProportions: shape.lockProportions,
            parameters: {
                width:        shape.width,
                height:       shape.height,
                depth:        shape.depth,
                cornerRadius: shape.cornerRadius,
                caps:         shape.caps,
                sides:        shape.sides,
                polyType:     shape.polyType,
                tubeRadius:   shape.tubeRadius,
                stepHeight:   shape.stepHeight,
                turns:        shape.turns,
            },
        })),
    };
}

// Restore scene state from a snapshot produced by toSnapshot().
// Mutates shapeList in-place via restoreShapeList() — never reassigns the export reference.
// Clears selection: no shape is active after undo (standard CAD convention).
function restoreFromSnapshot(snapshot) {
    settings.ambientLight = snapshot.global_settings.ambientLight;
    settings.lightX       = snapshot.global_settings.lightX;
    settings.lightY       = snapshot.global_settings.lightY;

    restoreShapeList(snapshot.unit_cell_tree);
    clearSelection();
}

// ==========================================================
// STACK OPERATIONS
// ==========================================================

// Save current state before a mutating action.
// Always call pushSnapshot() BEFORE the action, not after.
// Clears redoStack — a new action invalidates forward history.
export function pushSnapshot() {
    undoStack.push(toSnapshot());
    redoStack.length = 0;
    if (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
}

// Step backward: push current state to redo, restore previous.
export function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(toSnapshot());
    restoreFromSnapshot(undoStack.pop());
}

// Step forward: push current state to undo, restore next.
export function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(toSnapshot());
    restoreFromSnapshot(redoStack.pop());
}
