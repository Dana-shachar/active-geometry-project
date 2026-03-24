import { getActiveShape } from './shapeManager.js';

// Shared scene-level state — per-shape state lives on shape objects in shapeManager.js
export const settings = {
    stage:            'unit_cell',
    ambientLight:     0.2,
    lightX:           -8.0,
    lightY:           7.0,
    handleDragActive: false,  // true while a transform handle is being dragged
    zoomLevel:        100,
};

export function initMouseControls(settings, canvas, cameraControls, shapeHit, camera) {
    let isDragging  = false;
    let dragStartX  = 0;
    let dragStartY  = 0;
    const dragThreshold = 6; // px — below this, treat as click/orbit, not a drag

    function ShapePressed(pressEvent) {
        if (pressEvent.button !== 0 || settings.uIsSelected !== 1) return;
        if (!shapeHit(pressEvent.clientX, pressEvent.clientY)) return;
        // Mark potential drag but leave orbit enabled until threshold confirms intent
        isDragging = true;
        dragStartX = pressEvent.clientX;
        dragStartY = pressEvent.clientY;
    }

    function ShapeReleased() {
        isDragging = false;
        cameraControls.enabled = true; // always restore — drag may or may not have committed
    }

    function ShapeDragged(dragEvent) {
        if (!isDragging || settings.handleDragActive) return;
        // Only commit to drag once mouse has moved past the threshold
        const moveDistPx = Math.hypot(dragEvent.clientX - dragStartX, dragEvent.clientY - dragStartY);
        if (moveDistPx <= dragThreshold) return; // still in click range — let orbit handle it

        cameraControls.enabled = false; // commit to shape drag, lock orbit
        const dragSensitivity = 0.1;
        const deltaX =  dragEvent.movementX * dragSensitivity;
        const deltaY = -dragEvent.movementY * dragSensitivity; // Y is inverted in screen space
        const activeShape = getActiveShape();
        if (activeShape) {
            activeShape.posOffset.x += deltaX;
            activeShape.posOffset.y += deltaY;
        }
        camera.position.x       += deltaX;
        camera.position.y       += deltaY;
        cameraControls.target.x += deltaX;
        cameraControls.target.y += deltaY;
    }

    canvas.addEventListener('mousedown', ShapePressed);
    window.addEventListener('mouseup',   ShapeReleased);
    window.addEventListener('mousemove', ShapeDragged);
}

