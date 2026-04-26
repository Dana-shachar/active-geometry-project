import * as THREE from 'three';
import { getActiveShape, duplicateShape } from './shapeManager.js';
import { pushSnapshot } from './history.js';

// Shared scene-level state — per-shape state lives on shape objects in shapeManager.js
export const settings = {
    stage:            'unit_cell',
    ambientLight:     0.2,
    lightX:           -8.0,
    lightY:           7.0,
    handleDragActive: false,  // true while a transform handle is being dragged
    zoomLevel:        100,
    clipAxis:         0,      // 0=off  1=X  2=Y  3=Z
    clipPos:          0,
};

export function initMouseControls(settings, canvas, cameraControls, shapeHit, camera) {
    let isDragging    = false;
    let dragStartX    = 0;
    let dragStartY    = 0;
    const dragThreshold = 6; // px — below this, treat as click/orbit, not a drag

    // ----------------------------------------------------------
    // Duplicate on Alt+drag
    // Alt held at mousedown on a shape → on first move past threshold,
    // a copy is created and dragged. Original stays in place.
    // Alt+click on empty space still pans normally (ShapePressed returns early).
    // altHeld is tracked via keydown/keyup — more reliable than pressEvent.altKey
    // on macOS where MouseEvent modifier state can be inconsistent.
    // ----------------------------------------------------------
    let altHeld          = false;
    let duplicateActive  = false;
    let duplicateCreated = false;

    window.addEventListener('keydown', e => { if (e.key === 'Alt') altHeld = true; });
    window.addEventListener('keyup',   e => { if (e.key === 'Alt') altHeld = false; });

    function ShapePressed(pressEvent) {
        if (pressEvent.button !== 0 || settings.uIsSelected !== 1) return;
        const hit = shapeHit(pressEvent.clientX, pressEvent.clientY);
        if (!hit) return;
        isDragging       = true;
        dragStartX       = pressEvent.clientX;
        dragStartY       = pressEvent.clientY;
        duplicateActive  = altHeld;
        duplicateCreated = false;
        canvas.setPointerCapture(pressEvent.pointerId);
        if (duplicateActive) {
            cameraControls.enabled = false;
            cameraControls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
        }
    }

    function ShapeReleased() {
        isDragging       = false;
        duplicateActive  = false;
        duplicateCreated = false;
        cameraControls.enabled = true;
    }

    function ShapeDragged(dragEvent) {
        if (!isDragging || settings.handleDragActive) return;
        const moveDistPx = Math.hypot(dragEvent.clientX - dragStartX, dragEvent.clientY - dragStartY);
        if (moveDistPx <= dragThreshold) return;

        cameraControls.enabled = false;

        // On first move past threshold with alt held — create the duplicate
        if (duplicateActive && !duplicateCreated) {
            const source = getActiveShape();
            if (source) {
                pushSnapshot();
                duplicateShape(source);
                duplicateCreated = true;
            }
        }

        const dragSensitivity = 0.1;
        const deltaX =  dragEvent.movementX * dragSensitivity;
        const deltaY = -dragEvent.movementY * dragSensitivity;
        const activeShape = getActiveShape();
        if (activeShape) {
            activeShape.posOffset.x += deltaX;
            activeShape.posOffset.y += deltaY;
        }
        // During alt+drag, camera stays fixed so user can see original and copy together
        if (!duplicateActive) {
            camera.position.x       += deltaX;
            camera.position.y       += deltaY;
            cameraControls.target.x += deltaX;
            cameraControls.target.y += deltaY;
        }
    }

    // All three on canvas — setPointerCapture in ShapePressed ensures pointermove/pointerup
    // route here even when the mouse leaves the canvas bounds during a drag.
    canvas.addEventListener('pointerdown', ShapePressed, { capture: true });
    canvas.addEventListener('pointermove', ShapeDragged);
    canvas.addEventListener('pointerup',   ShapeReleased);
}

