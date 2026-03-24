import * as THREE from 'three';

// ==========================================================
// SHAPE TYPE → GLSL INTEGER MAP
// Used by the shader generator to dispatch to the right SDF.
// ==========================================================
export const SHAPE_TYPE_INT = {
    sphere:     0,
    box:        1,
    cylinder:   2,
    prism:      4,
    polyhedron: 5,
    helix:      6,
};

// ==========================================================
// SHAPE FACTORY
// All shapes share a flat param structure.
// Unused params for a given type are ignored in the shader.
// ==========================================================
function createShape(type) {
    return {
        id:              nextShapeId++,
        type,
        booleanOp:       'union',         // 'union' | 'subtract' | 'intersect' | 'exclude'
        posOffset:       new THREE.Vector3(0, 0, 0),
        rotation:        new THREE.Euler(0, 0, 0),
        lockProportions: type === 'sphere',  // spheres lock by default; others don't
        // geometry params
        width:           10,
        height:          10,
        depth:           10,
        cornerRadius:    0,
        caps:            true,
        sides:           3,               // prism: number of polygon sides (3–20)
        polyType:        0,               // polyhedron sub-type: 0=Tetra 1=Octa 2=Ico 3=Dodeca
        tubeRadius:      2,               // helix: wire cross-section radius (mm)
        stepHeight:      10,              // helix: axial rise per full turn (mm)
        turns:           3,               // helix: number of turns
    };
}

// ==========================================================
// SHAPE LIST & SELECTION STATE
// ==========================================================
export const shapeList = [];

// Index into shapeList of the shape being actively edited.
// -1 means nothing is active.
export let activeShapeIndex = -1;

// Set of shape ids in the current multi-selection (Shift+click).
export const selectedShapeIds = new Set();

// Increments whenever the list structure changes (shape added or removed).
// main.js watches this to know when to recompile the shader.
export let shapeListVersion = 0;

let nextShapeId = 0;

// ==========================================================
// MUTATIONS
// ==========================================================

// Add a new shape of the given type. Makes it the active shape.
// Returns the new shape object.
export function addShape(type) {
    const newShape = createShape(type);
    shapeList.push(newShape);
    activeShapeIndex = shapeList.length - 1;
    selectedShapeIds.clear();
    selectedShapeIds.add(newShape.id);
    shapeListVersion++;
    return newShape;
}

// Remove the shape with the given id.
// Adjusts activeShapeIndex so it stays valid.
export function removeShape(id) {
    const removalIndex = shapeList.findIndex(shape => shape.id === id);
    if (removalIndex === -1) return;

    shapeList.splice(removalIndex, 1);
    selectedShapeIds.delete(id);
    shapeListVersion++;

    if (shapeList.length === 0) {
        activeShapeIndex = -1;
    } else if (activeShapeIndex >= shapeList.length) {
        activeShapeIndex = shapeList.length - 1;
    }
}

// Set which shape is actively being edited (by list index).
export function setActiveShape(index) {
    activeShapeIndex = index;
}

// Toggle a shape in/out of the multi-selection set (Shift+click).
export function toggleShapeSelection(id) {
    if (selectedShapeIds.has(id)) {
        selectedShapeIds.delete(id);
    } else {
        selectedShapeIds.add(id);
    }
}

// Select exactly one shape by index (plain click). Clears any prior selection.
export function selectShape(index) {
    selectedShapeIds.clear();
    activeShapeIndex = index;
    if (index >= 0 && index < shapeList.length) {
        selectedShapeIds.add(shapeList[index].id);
    }
}

// Deselect everything and clear active shape.
export function clearSelection() {
    selectedShapeIds.clear();
    activeShapeIndex = -1;
}

// Sets the boolean op on a shape and increments shapeListVersion to trigger a shader recompile.
export function setBooleanOp(shape, op) {
    shape.booleanOp = op;
    shapeListVersion++;
}

// Convenience getter — returns the active shape object, or null.
export function getActiveShape() {
    if (activeShapeIndex < 0 || activeShapeIndex >= shapeList.length) return null;
    return shapeList[activeShapeIndex];
}
