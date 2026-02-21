import * as THREE from 'three';
import vertexShader from './shaders/vertex.glsl';
import fragmentShader from './shaders/fragment.glsl';
// IMPORT THE SDF MANAGER AS RAW TEXT
import sdfManager from './shaders/sdf.glsl?raw';

import { settings, initUI, initMouseControls } from './ui.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Gumball } from './gumball.js';

//==========================================================
// CORE ENGINE SETUP
//==========================================================
// Create the menu and establish the shared 'settings' object
const { zoomCtrl } = initUI();
settings.uIsSelected = 0;
const defaultCameraDistance = 3;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 3);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const cameraControls = new OrbitControls(camera, renderer.domElement);
cameraControls.enableDamping = true;          // smooth deceleration on release
cameraControls.dampingFactor = 0.05;
cameraControls.mouseButtons  = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

const gumball = new Gumball(camera, cameraControls);

// mouse controls for dragging the shape (when selected)
initMouseControls(settings, renderer.domElement, cameraControls);

//==========================================================
// KEYBOARD CAMERA CONTROLS
//==========================================================
// Hold ALT to pan instead of rotate
function AltPressed(keyEvent) {
    if (keyEvent.key !== 'Alt') return;
    cameraControls.mouseButtons.LEFT = THREE.MOUSE.PAN;
}

function AltReleased(keyEvent) {
    if (keyEvent.key !== 'Alt') return;
    cameraControls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
}

window.addEventListener('keydown', AltPressed);
window.addEventListener('keyup',   AltReleased);

// Zoom slider → move camera closer/further along its current orbit direction
zoomCtrl.onChange((zoomPercent) => {
    const targetDistance = defaultCameraDistance * 100 / zoomPercent;
    const orbitDirection = camera.position.clone().sub(cameraControls.target).normalize();
    camera.position.copy(cameraControls.target).addScaledVector(orbitDirection, targetDistance);
});

//==========================================================
// GEOMETRY & MATERIAL
//==========================================================

// A simple plane that covers the entire view. The raymarching shader will run for every pixel on this plane.
const geometry = new THREE.PlaneGeometry(2, 2);

// STITCHING: combine the SDF Manager (math) with the Fragment Engine (rendering)
// The Manager MUST come first so the Fragment can "see" the map function.
const finalFragmentShader = sdfManager + fragmentShader;

// The ShaderMaterial allows to write custom GLSL code for how the surface should be rendered.
const material = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: finalFragmentShader,
  uniforms: {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uLightX: { value: settings.lightX },
    uLightY: { value: settings.lightY },
    uAmbientLight: { value: settings.ambientLight },
    uShapeType: { value: settings.shapeType },
    uWidth: { value: settings.width },
    uHeight: { value: settings.height },
    uPosOffset: { value: settings.posOffset },
    uIsSelected: { value: 0 },
    uCamMatrix:  { value: camera.matrixWorld },   // live reference — auto-updates with orbit
    uCamPos:     { value: camera.position },       // live reference — auto-updates with orbit
    uFocalLen:   { value: 1.0 / Math.tan((camera.fov / 2) * Math.PI / 180) }
  }
});

// The mesh combines the geometry and material, and is added to the scene
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

//==========================================================
// ANIMATION & SYNC SYSTEM
//==========================================================
function animate(time) {
    // This section syncs UI settings to the GPU every frame
    material.uniforms.uLightX.value = settings.lightX;
    material.uniforms.uLightY.value = settings.lightY;
    material.uniforms.uAmbientLight.value = settings.ambientLight;
    material.uniforms.uShapeType.value = settings.shapeType;
    material.uniforms.uWidth.value = settings.width;
    material.uniforms.uHeight.value = settings.height;
    material.uniforms.uTime.value = time * 0.001;
    material.uniforms.uIsSelected.value = settings.uIsSelected;
    material.uniforms.uFocalLen.value = 1.0 / Math.tan((camera.fov / 2) * Math.PI / 180);

    // Sync zoom slider to reflect scroll/orbit changes
    const currentDistance = camera.position.distanceTo(cameraControls.target);
    const currentZoom = Math.round(defaultCameraDistance * 100 / currentDistance);
    const zoomRange = Math.max(10, Math.min(200, currentZoom));
    if (zoomRange !== settings.zoomLevel) {
        settings.zoomLevel = zoomRange;
        zoomCtrl.updateDisplay();
    }

    cameraControls.update();
    renderer.render(scene, camera);
    gumball.update(); // after render — this ensures it appears on top of the raymarched object
    requestAnimationFrame(animate);
}

// Start the engine
animate();

//==========================================================
// WINDOW RESPONSIVENESS
//==========================================================
window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Update the uniform so the shader knows the new width/height
    material.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
});

//==========================================================
// CLICK SELECTION
//==========================================================
function intersectBBox(rayOrigin, rayDir, bboxMin, bboxMax) {
    let rayEnter = (bboxMin.x - rayOrigin.x) / rayDir.x;
    let rayExit  = (bboxMax.x - rayOrigin.x) / rayDir.x;
    if (rayEnter > rayExit) [rayEnter, rayExit] = [rayExit, rayEnter];

    let yZoneEnter = (bboxMin.y - rayOrigin.y) / rayDir.y;
    let yZoneExit  = (bboxMax.y - rayOrigin.y) / rayDir.y;
    if (yZoneEnter > yZoneExit) [yZoneEnter, yZoneExit] = [yZoneExit, yZoneEnter];

    if (rayEnter > yZoneExit || yZoneEnter > rayExit) return false;
    if (yZoneEnter > rayEnter) rayEnter = yZoneEnter;
    if (yZoneExit  < rayExit)  rayExit  = yZoneExit;

    let zZoneEnter = (bboxMin.z - rayOrigin.z) / rayDir.z;
    let zZoneExit  = (bboxMax.z - rayOrigin.z) / rayDir.z;
    if (zZoneEnter > zZoneExit) [zZoneEnter, zZoneExit] = [zZoneExit, zZoneEnter];

    if (rayEnter > zZoneExit || zZoneEnter > rayExit) return false;
    return true;
}

window.addEventListener('click', (event) => {
    // 1. Normalize mouse to NDC
    const mouse = {
        x: (event.clientX / window.innerWidth) * 2 - 1,
        y: -(event.clientY / window.innerHeight) * 2 + 1
    };

    // 2. Reconstruct ray (matches fragment.glsl camera)
    const aspect = window.innerWidth / window.innerHeight;
    const rayOrigin = new THREE.Vector3(0, 0, -2);
    const rayDir = new THREE.Vector3(mouse.x * aspect, mouse.y, 1).normalize();

    // 3. Shape-aware bbox extents (mirrors getShapeBBox in sdf.glsl)
    const bboxHalfX = settings.width;
    const bboxHalfY = settings.shapeType === 0 ? settings.width : settings.height;
    const bboxMin = settings.posOffset.clone().sub(new THREE.Vector3(bboxHalfX, bboxHalfY, bboxHalfX));
    const bboxMax = settings.posOffset.clone().add(new THREE.Vector3(bboxHalfX, bboxHalfY, bboxHalfX));

    // 4. Zone test
    const isHit = intersectBBox(rayOrigin, rayDir, bboxMin, bboxMax);

    // 5. Update selection state
    settings.uIsSelected = isHit ? 1 : 0;
    material.uniforms.uIsSelected.value = settings.uIsSelected;
});
