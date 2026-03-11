import GUI from 'lil-gui';
import * as THREE from 'three';

// Shared State
export const settings = {
    stage: 'unit_cell',
    shapeType: 0,
    width: 10,
    height: 10,
    depth: 10,           // box Z half-extent
    cornerRadius: 0.0,   // rounding: box edges or cylinder cap hemisphere radius
    caps: true,          // cylinder / prism: caps on (true) or open ends (false)
    sides: 3,            // N-gon prism: number of polygon sides (3–20)
    polyType: 0,         // polyhedron sub-type: 0=Tetrahedron, 1=Octahedron, 2=Icosahedron, 3=Dodecahedron
    tubeRadius: 2,       // helix: wire cross-section radius (mm)
    stepHeight: 10,      // helix: axial rise per full turn (mm)
    turns: 3,            // helix: number of turns
    lockProportions: true,
    ambientLight: 0.1,
    lightX: 2.0,
    lightY: 2.0,
    posOffset: new THREE.Vector3(0, 0, 0),
    zoomLevel: 100,
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
        if (!isDragging) return;
        // Only commit to drag once mouse has moved past the threshold
        const moveDistPx = Math.hypot(dragEvent.clientX - dragStartX, dragEvent.clientY - dragStartY);
        if (moveDistPx <= dragThreshold) return; // still in click range — let orbit handle it

        cameraControls.enabled = false; // commit to shape drag, lock orbit
        const dragSensitivity = 0.1;
        const deltaX =  dragEvent.movementX * dragSensitivity;
        const deltaY = -dragEvent.movementY * dragSensitivity; // Y is inverted in screen space
        settings.posOffset.x    += deltaX;
        settings.posOffset.y    += deltaY;
        camera.position.x       += deltaX;
        camera.position.y       += deltaY;
        cameraControls.target.x += deltaX;
        cameraControls.target.y += deltaY;
    }

    canvas.addEventListener('mousedown', ShapePressed);
    window.addEventListener('mouseup',   ShapeReleased);
    window.addEventListener('mousemove', ShapeDragged);
}

export function initUI() {
    const gui = new GUI({ title: 'Active Geometry Sandbox' });

    const zoomCtrl = gui.add(settings, 'zoomLevel', 10, 400, 1).name('Zoom');

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
    const wCtrl = local.add(settings, 'width', 0.1, 100).name('Width / Radius (mm)');
    wCtrl.onChange((val) => {
        if (settings.lockProportions) {
            settings.height = val;
            hCtrl.updateDisplay();
        }
    });

    // Height Control
    const hCtrl = local.add(settings, 'height', 0.1, 100).name('Height (mm)');
    hCtrl.onChange((val) => {
        if (settings.lockProportions) {
            settings.width = val;
            wCtrl.updateDisplay(); 
        }
    });
    
    const lockCtrl = local.add(settings, 'lockProportions').name('Lock proportions');

    // Shape-specific controls — visibility managed by updateLocalControls
    const depthCtrl        = local.add(settings, 'depth', 0.1, 100).name('Depth (mm)');
    const cornerRadiusCtrl = local.add(settings, 'cornerRadius', 0.0, 50).name('Corner radius (mm)');
    const capsCtrl         = local.add(settings, 'caps').name('Cap Shape?');
    const sidesCtrl        = local.add(settings, 'sides', 3, 20, 1).name('Sides');
    const polyTypeCtrl     = local.add(settings, 'polyType', { Tetrahedron: 0, Octahedron: 1, Icosahedron: 2, Dodecahedron: 3 }).name('Type');
    const tubeRadiusCtrl  = local.add(settings, 'tubeRadius', 0.1, 20).name('Tube radius (mm)');
    const stepHeightCtrl  = local.add(settings, 'stepHeight', 1, 50).name('Step height (mm)');
    const turnsCtrl       = local.add(settings, 'turns', 1, 10, 0.5).name('Turns');

    // When caps toggle changes: show/hide corner radius (cylinder only)
    capsCtrl.onChange((val) => {
        if (settings.shapeType === 2) {
            val ? cornerRadiusCtrl.show() : cornerRadiusCtrl.hide();
        }
    });

    function updateLocalControls(shapeType) {
        depthCtrl.hide();
        cornerRadiusCtrl.hide();
        capsCtrl.hide();
        sidesCtrl.hide();
        polyTypeCtrl.hide();
        tubeRadiusCtrl.hide();
        stepHeightCtrl.hide();
        turnsCtrl.hide();

        if (shapeType === 5) { // Polyhedron: uniform scale — height and lock irrelevant
            hCtrl.hide();
            lockCtrl.hide();
            polyTypeCtrl.show();
        } else if (shapeType === 6) { // Helix: height derived from turns × stepHeight
            hCtrl.hide();
            lockCtrl.hide();
            tubeRadiusCtrl.show();
            stepHeightCtrl.show();
            turnsCtrl.show();
        } else {
            hCtrl.show();
            lockCtrl.show();
            if (shapeType === 1) {        // Box: depth + corner radius always available
                depthCtrl.show();
                cornerRadiusCtrl.show();
            } else if (shapeType === 2) { // Cylinder: caps toggle + corner radius when caps are on
                capsCtrl.show();
                if (settings.caps) cornerRadiusCtrl.show();
            } else if (shapeType === 4) { // N-gon Prism: sides slider + caps toggle
                sidesCtrl.show();
                capsCtrl.show();
            }
        }
    }

    // Wireframe placeholders
    local.addFolder('boolean operations').close();
    local.addFolder('moving controls').close();
    local.addFolder('transformation controls').close();

    // =============================================
    //Section 3: Navigation (Bottom)
    // =============================================
    const navigation = gui.addFolder('Navigation');
    navigation.add(settings, 'stage', ['unit_cell', 'locking', 'lattice', 'simulation']).name('Current Stage');
    navigation.add(settings, 'shapeType', { Sphere: 0, Box: 1, Cylinder: 2, Ellipsoid: 3, 'N-gon Prism': 4, Polyhedron: 5, Helix: 6 })
        .name('Base Shape')
        .onChange(updateLocalControls);

    // Apply initial visibility for the default shape
    updateLocalControls(settings.shapeType);

    return { zoomCtrl };
}