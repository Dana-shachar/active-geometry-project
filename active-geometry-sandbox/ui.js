import GUI from 'lil-gui';

// Shared State
export const settings = {
    stage: 'unit_cell', 
    shapeType: 0, 
    width: 0.5,
    height: 0.5,
    lockProportions: true,
    ambientLight: 0.1,
    lightX: 2.0,
    posOffset: new THREE.Vector3(0, 0, 0),
};

export function initMouseControls(settings) {
    let isDragging = false;

    window.addEventListener('mousedown', () => { isDragging = true; });
    window.addEventListener('mouseup', () => { isDragging = false; });

    window.addEventListener('mousemove', (event) => {
        if (!isDragging) return;

        // Sensitivity: 0.005 is a good starting point for [-1, 1] space
        const sensitivity = 0.005;
        
        // Update the shared settings object
        settings.posOffset.x += event.movementX * sensitivity;
        settings.posOffset.y -= event.movementY * sensitivity; // Y is inverted in screen space
    });
}

export function initUI() {
    const gui = new GUI({ title: 'Active Geometry Sandbox' });

    // =============================================
    //Section 1: General (Top Right)
    // =============================================
    const general = gui.addFolder('General controls');
    general.add(settings, 'ambientLight', 0, 0.5).name('Ambient light');
    general.add(settings, 'lightX', -10, 10).name('X pos light');

    // =============================================
    //Section 2: Local (Middle Right)
    // =============================================
    const local = gui.addFolder('Local controls');

    // Width Control with Logic
    const wCtrl = local.add(settings, 'width', 0.1, 1.5).name('Width / Radius');
    wCtrl.onChange((val) => {
        if (settings.lockProportions) {
            settings.height = val;
            hCtrl.updateDisplay(); // Sync the UI
        }
    });

    // Height Control
    const hCtrl = local.add(settings, 'height', 0.1, 1.5).name('Height');
    hCtrl.onChange((val) => {
        if (settings.lockProportions) {
            settings.width = val;
            wCtrl.updateDisplay(); // Sync the UI
        }
    });
    
    // Wireframe placeholders
    local.addFolder('boolean operations').close();
    local.addFolder('moving controls').close();
    local.addFolder('transformation controls').close();

    // =============================================
    //Section 3: Navigation (Bottom)
    // =============================================
    const navigation = gui.addFolder('Navigation');
    navigation.add(settings, 'stage', ['unit_cell', 'locking', 'lattice', 'simulation']).name('Current Stage');
    navigation.add(settings, 'shapeType', { Sphere: 0, Box: 1, Cylinder: 2 }).name('Base Shape');

    return gui;
}