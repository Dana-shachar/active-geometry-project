import * as THREE from 'three';
import vertexShader from './shaders/vertex.glsl';
import fragmentShader from './shaders/fragment.glsl';
// IMPORT THE SDF MANAGER AS RAW TEXT
import sdfManager from './shaders/sdf.glsl?raw';

import { settings, initUI, initMouseControls } from './ui.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Gumball } from './gumball.js';
import { TransformHandles } from './transformHandles.js';

//==========================================================
// CORE ENGINE SETUP
//==========================================================
// Create the menu and establish the shared 'settings' object
const { zoomCtrl } = initUI();
settings.uIsSelected = 0;
settings.rotation = new THREE.Euler(0, 0, 0);
const defaultCameraDistance = 80;
const defaultPerspDist = defaultCameraDistance / Math.sqrt(3);  // equal x/y/z — matches PERSPECTIVE preset

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 10000);
camera.position.set(defaultPerspDist, defaultPerspDist, defaultPerspDist);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const cameraControls = new OrbitControls(camera, renderer.domElement);
cameraControls.enableDamping = true;          // smoothing deceleration on release
cameraControls.dampingFactor = 0.05;
cameraControls.mouseButtons  = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

const gumball = new Gumball(camera, cameraControls, settings);
const transformHandles = new TransformHandles(camera, settings, cameraControls, renderer.domElement);

// Cached matrix to avoid per-frame allocations when syncing rotation to GPU
const _rotMat4 = new THREE.Matrix4();

// mouse controls for dragging the shape (when selected)
initMouseControls(settings, renderer.domElement, cameraControls, shapeHit, camera);

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

// Lock camera distance during rotate so dragging never changes zoom
function lockRotate(event) {
    if (event.button !== 0) return;
    if (cameraControls.mouseButtons.LEFT !== THREE.MOUSE.ROTATE) return;
    const dist = camera.position.distanceTo(cameraControls.target);
    cameraControls.minDistance = dist;
    cameraControls.maxDistance = dist;
}

function unlockRotate(event) {
    if (event.button !== 0) return;
    cameraControls.minDistance = 0;
    cameraControls.maxDistance = Infinity;
}

renderer.domElement.addEventListener('mousedown', lockRotate);
window.addEventListener('mouseup',               unlockRotate);

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
// The Manager MUST come first so the Fragment can "see" the map function!
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
    uShapeType:    { value: settings.shapeType },
    uWidth:        { value: settings.width },
    uHeight:       { value: settings.height },
    uDepth:        { value: settings.depth },
    uCornerRadius: { value: settings.cornerRadius },
    uCaps:         { value: 1 },
    uPrismSides:   { value: 3 },
    uPolyType:     { value: 0 },
    uTubeRadius:   { value: settings.tubeRadius },
    uStepHeight:   { value: settings.stepHeight },
    uTurns:        { value: settings.turns },
    uPosOffset:    { value: settings.posOffset },
    uRotation:     { value: new THREE.Matrix3() },   // identity — updated each frame from settings.rotation
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
    material.uniforms.uShapeType.value    = settings.shapeType;
    material.uniforms.uWidth.value        = settings.width;
    material.uniforms.uHeight.value       = settings.height;
    material.uniforms.uDepth.value        = settings.depth;
    material.uniforms.uCornerRadius.value = settings.cornerRadius;
    material.uniforms.uCaps.value         = settings.caps ? 1 : 0;
    material.uniforms.uPrismSides.value   = settings.sides;
    material.uniforms.uPolyType.value     = settings.polyType;
    material.uniforms.uTubeRadius.value   = settings.tubeRadius;
    material.uniforms.uStepHeight.value   = settings.stepHeight;
    material.uniforms.uTurns.value        = settings.turns;
    material.uniforms.uTime.value = time * 0.001;
    material.uniforms.uIsSelected.value = settings.uIsSelected;
    material.uniforms.uFocalLen.value = 1.0 / Math.tan((camera.fov / 2) * Math.PI / 180);

    // Sync zoom slider to reflect scroll/orbit changes
    const currentDistance = camera.position.distanceTo(cameraControls.target);
    const currentZoom = Math.round(defaultCameraDistance * 100 / currentDistance);
    const zoomRange = Math.max(10, Math.min(400, currentZoom));
    if (zoomRange !== settings.zoomLevel) {
        settings.zoomLevel = zoomRange;
        zoomCtrl.updateDisplay();
    }

    // Sync rotation to GPU — store inverse (transpose) so shader can use it directly
    _rotMat4.makeRotationFromEuler(settings.rotation);
    material.uniforms.uRotation.value.setFromMatrix4(_rotMat4).transpose();

    cameraControls.update();
    renderer.render(scene, camera);
    gumball.update();
    transformHandles.update();
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

// This function casts a ray from the camera through the clicked pixel and checks if it intersects the shape's bounding box.
function shapeHit(clientX, clientY) {
    const mouseNdc = {
        x:  (clientX / window.innerWidth)  * 2 - 1,
        y: -(clientY / window.innerHeight) * 2 + 1
    };
    const aspect    = window.innerWidth / window.innerHeight;
    const focalLen  = 1.0 / Math.tan((camera.fov / 2) * Math.PI / 180);
    const rayOrigin = camera.position.clone();
    const rayDir    = new THREE.Vector3(mouseNdc.x * aspect, mouseNdc.y, -focalLen)
                          .transformDirection(camera.matrixWorld)
                          .normalize();
    const bboxHalfX = settings.shapeType === 6 ? settings.width + settings.tubeRadius : settings.width;
    const bboxHalfZ = settings.shapeType === 1 ? settings.depth : bboxHalfX;
    const bboxHalfY = settings.shapeType === 6 ? settings.turns * settings.stepHeight * 0.5 + settings.tubeRadius
                    : (settings.shapeType === 0 || settings.shapeType === 5) ? settings.width : settings.height;
    const bboxMin   = settings.posOffset.clone().sub(new THREE.Vector3(bboxHalfX, bboxHalfY, bboxHalfZ));
    const bboxMax   = settings.posOffset.clone().add(new THREE.Vector3(bboxHalfX, bboxHalfY, bboxHalfZ));
    return intersectBBox(rayOrigin, rayDir, bboxMin, bboxMax);
}

// Standard ray-box intersection test — returns true if ray hits the box, false if it misses
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

// Click event on the canvas to toggle selection state based on whether the shape was hit.
// Handle clicks are checked first — if a handle consumes the click, skip shape selection.
renderer.domElement.addEventListener('click', (event) => {
    if (transformHandles.handleClick()) return;
    settings.uIsSelected = shapeHit(event.clientX, event.clientY) ? 1 : 0;
    material.uniforms.uIsSelected.value = settings.uIsSelected;
});
