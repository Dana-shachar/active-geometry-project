import GUI from 'lil-gui';
import * as THREE from 'three';

// Shared State
export const settings = {
    stage: 'unit_cell', 
    shapeType: 0, 
    width: 0.5,
    height: 0.5,
    lockProportions: true,
    ambientLight: 0.1,
    lightX: 2.0,
    lightY: 2.0,
    posOffset: new THREE.Vector3(0, 0, 0),
    zoomLevel: 100,
};

export function initMouseControls(settings, canvas, cameraControls) {
    let isDragging = false;

    function ShapePressed(pressEvent) {
        if (pressEvent.button !== 0 || settings.uIsSelected !== 1) return;
        isDragging = true;
        cameraControls.enabled = false;
    }

    function ShapeReleased() {
        if (!isDragging) return;
        isDragging = false;
        cameraControls.enabled = true;
    }

    function ShapeDragged(dragEvent) {
        if (!isDragging) return;
        const dragSensitivity = 0.005;
        settings.posOffset.x += dragEvent.movementX * dragSensitivity;
        settings.posOffset.y -= dragEvent.movementY * dragSensitivity; // Y is inverted in screen space
    }

    canvas.addEventListener('mousedown', ShapePressed);
    window.addEventListener('mouseup',   ShapeReleased);
    window.addEventListener('mousemove', ShapeDragged);
}

export function initUI() {
    const gui = new GUI({ title: 'Active Geometry Sandbox' });

    const zoomCtrl = gui.add(settings, 'zoomLevel', 10, 200, 1).name('Zoom');

    // =============================================
    //Section 1: General (Top Right)
    // =============================================
    const general = gui.addFolder('General controls');
    general.add(settings, 'ambientLight', 0, 0.5).name('Ambient light');
    general.add(settings, 'lightX', -10, 10).name('Light X');
    general.add(settings, 'lightY', -10, 10).name('Light Y');

    // =============================================
    //Section 2: Local (Middle Right)
    // =============================================
    const local = gui.addFolder('Local controls');

    // Width Control with Logic
    const wCtrl = local.add(settings, 'width', 0.001, 2).name('Width / Radius');
    wCtrl.onChange((val) => {
        if (settings.lockProportions) {
            settings.height = val;
            hCtrl.updateDisplay(); // Sync the UI
        }
    });

    // Height Control
    const hCtrl = local.add(settings, 'height', 0.001, 2).name('Height');
    hCtrl.onChange((val) => {
        if (settings.lockProportions) {
            settings.width = val;
            wCtrl.updateDisplay(); // Sync the UI
        }
    });
    
    local.add(settings, 'lockProportions').name('Lock proportions');

    // Wireframe placeholders
    local.addFolder('boolean operations').close();
    local.addFolder('moving controls').close();
    local.addFolder('transformation controls').close();

    // =============================================
    //Section 3: Navigation (Bottom)
    // =============================================
    const navigation = gui.addFolder('Navigation');
    navigation.add(settings, 'stage', ['unit_cell', 'locking', 'lattice', 'simulation']).name('Current Stage');
    navigation.add(settings, 'shapeType', { Sphere: 0, Box: 1, Cylinder: 2, Ellipsoid: 3 }).name('Base Shape');

    return { zoomCtrl };
}