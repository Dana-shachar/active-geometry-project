import * as THREE from 'three';
import vertexShader from './shaders/vertex.glsl';
import fragmentShader from './shaders/fragment.glsl';
import pickingGlsl from './shaders/picking.glsl?raw';
import sdfGlsl from './shaders/sdf.glsl?raw';
import shapeMapperGlsl from './shaders/shapeMapper.glsl?raw';

import { settings, initMouseControls } from './js/uiSettings.js';
import { initPanels, updatePanels } from './js/uiDesign.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Gumball } from './js/gumball.js';
import { TransformHandles } from './js/transformHandles.js';
import { buildShaderBlock, buildUniforms, syncShapeUniforms } from './js/shapeBuilder.js';
import { addShape, shapeList, activeShapeIndex, shapeListVersion, getActiveShape, setActiveShape, selectShape, toggleShapeSelection, selectedShapeIds, removeShape } from './js/shapeManager.js';
import { pushSnapshot, undo, redo } from './js/history.js';

//==========================================================
// CORE ENGINE SETUP
//==========================================================
settings.uIsSelected = 0;
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

const gumball = new Gumball(camera, cameraControls, settings, (zoomPercent) => {
    const targetDistance = defaultCameraDistance * 100 / zoomPercent;
    const orbitDirection = camera.position.clone().sub(cameraControls.target).normalize();
    camera.position.copy(cameraControls.target).addScaledVector(orbitDirection, targetDistance);
});
const transformHandles = new TransformHandles(camera, settings, cameraControls, renderer.domElement);

// Cached matrix to avoid per-frame allocations when syncing rotation to GPU
const _rotMat4 = new THREE.Matrix4();

// mouse controls for dragging the shape (when selected)
initMouseControls(settings, renderer.domElement, cameraControls, (x, y) => pickShape(x, y) >= 0, camera);

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

initPanels();

//==========================================================
// SHAPE LIST SETUP
//==========================================================
addShape('box');

//==========================================================
// GEOMETRY & MATERIAL
//==========================================================

// A simple plane that covers the entire view. The raymarching shader will run for every pixel on this plane.
const geometry = new THREE.PlaneGeometry(2, 2);

// Builds shader strings from the current shape list.
// Called once at startup and again whenever a shape is added or removed.
function buildFragmentShader() {
    return sdfGlsl + shapeMapperGlsl + buildShaderBlock(shapeList) + fragmentShader;
}
function buildPickingShader() {
    return sdfGlsl + shapeMapperGlsl + buildShaderBlock(shapeList) + pickingGlsl;
}

// Uniforms shared by both the main material and the picking material.
// Both materials reference this same object so per-frame updates reach both.
const sharedUniforms = {
    uTime:       { value: 0 },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uLightX:     { value: settings.lightX },
    uLightY:     { value: settings.lightY },
    uAmbientLight: { value: settings.ambientLight },
    uCamMatrix:  { value: camera.matrixWorld },   // live reference — auto-updates with orbit
    uCamPos:     { value: camera.position },       // live reference — auto-updates with orbit
    uFocalLen:   { value: 1.0 / Math.tan((camera.fov / 2) * Math.PI / 180) },
    ...buildUniforms(shapeList),
};

const material        = new THREE.ShaderMaterial({ vertexShader, fragmentShader: buildFragmentShader(), uniforms: sharedUniforms });
const pickingMaterial = new THREE.ShaderMaterial({ vertexShader, fragmentShader: buildPickingShader(),  uniforms: sharedUniforms });

// The mesh combines the geometry and material, and is added to the scene
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

// Render target used by the GPU picking pass — same dimensions as the canvas.
const pickingTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight);
const _pickPixel    = new Uint8Array(4);   // reusable buffer for readRenderTargetPixels

// Tracks the last known shapeListVersion — used to detect when a recompile is needed.
let lastShapeListVersion = shapeListVersion;

// Rebuilds both shaders and merges new per-shape uniforms when the shape list changes.
function recompileShader() {
    const newShapeUniforms = buildUniforms(shapeList);
    material.fragmentShader        = buildFragmentShader();
    pickingMaterial.fragmentShader = buildPickingShader();
    // Merge into sharedUniforms — both materials see the update automatically.
    Object.assign(sharedUniforms, newShapeUniforms);
    material.needsUpdate        = true;
    pickingMaterial.needsUpdate = true;
    lastShapeListVersion = shapeListVersion;
}

// Renders the picking pass and returns the 0-based shape index under (clientX, clientY),
// or -1 if the ray missed all geometry. Replaces the old bounding-box findHitShape.
function pickShape(clientX, clientY) {
    mesh.material = pickingMaterial;
    renderer.setRenderTarget(pickingTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    mesh.material = material;

    // WebGL Y origin is bottom-left; CSS Y origin is top-left — flip Y.
    const x = Math.floor(clientX);
    const y = Math.floor(window.innerHeight - clientY - 1);
    renderer.readRenderTargetPixels(pickingTarget, x, y, 1, 1, _pickPixel);

    // Red channel holds the 1-based shape index (0 = miss).
    const index1Based = _pickPixel[0];
    return index1Based > 0 ? index1Based - 1 : -1;
}

//==========================================================
// ANIMATION & SYNC SYSTEM
//==========================================================
function animate(time) {
    // Recompile shader if the shape list changed (shape added or removed)
    if (shapeListVersion !== lastShapeListVersion) recompileShader();

    // Sync scene-level uniforms to GPU every frame
    material.uniforms.uLightX.value       = settings.lightX;
    material.uniforms.uLightY.value       = settings.lightY;
    material.uniforms.uAmbientLight.value = settings.ambientLight;
    material.uniforms.uClipAxis.value     = settings.clipAxis;
    material.uniforms.uClipPos.value      = settings.clipPos;
    material.uniforms.uTime.value         = time * 0.001;
    settings.uIsSelected = selectedShapeIds.size > 0 ? 1 : 0;
    material.uniforms.uIsSelected.value          = settings.uIsSelected;
    const activeShape = getActiveShape();
    material.uniforms.uSelectedIsNonUnion.value  = (activeShape && activeShape.booleanOp !== 'union') ? 1 : 0;
    material.uniforms.uFocalLen.value     = 1.0 / Math.tan((camera.fov / 2) * Math.PI / 180);

    // Sync all shape params + rotation matrices to GPU (loops over shapeList)
    syncShapeUniforms(shapeList, material.uniforms, activeShapeIndex, _rotMat4, selectedShapeIds);

    // Sync zoom level to reflect scroll/orbit changes (updatePanels reads this to refresh the slider)
    const currentDistance = camera.position.distanceTo(cameraControls.target);
    settings.zoomLevel = Math.max(10, Math.min(400, Math.round(defaultCameraDistance * 100 / currentDistance)));

    cameraControls.update();
    renderer.render(scene, camera);
    gumball.update();
    transformHandles.update();
    updatePanels();
    requestAnimationFrame(animate);
}

// Start the engine
animate();

//==========================================================
// WINDOW RESPONSIVENESS
//==========================================================
window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    pickingTarget.setSize(window.innerWidth, window.innerHeight);

    // Update the uniform so the shader knows the new width/height
    sharedUniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
});

//==========================================================
// CLICK SELECTION
//==========================================================

// Click event on the canvas: handle clicks take priority, then shape selection.
// Shift+click adds/removes from multi-selection; plain click selects exactly one shape.
renderer.domElement.addEventListener('click', (event) => {
    if (transformHandles.handleClick()) return;
    const hitIndex = pickShape(event.clientX, event.clientY);
    if (hitIndex >= 0 && event.shiftKey) {
        const hitId = shapeList[hitIndex].id;
        toggleShapeSelection(hitId);
        if (selectedShapeIds.has(hitId)) {
            // Shape was added to selection — make it the active shape
            setActiveShape(hitIndex);
        } else {
            // Shape was removed — fall back to another selected shape, or clear
            const fallbackIndex = shapeList.findIndex(s => selectedShapeIds.has(s.id));
            setActiveShape(fallbackIndex);
        }
    } else {
        selectShape(hitIndex);
    }
    settings.uIsSelected = selectedShapeIds.size > 0 ? 1 : 0;
    material.uniforms.uIsSelected.value = settings.uIsSelected;
});

// Delete or Backspace removes the active shape.
window.addEventListener('keydown', (event) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    if (document.activeElement.tagName === 'INPUT') return;
    const activeShape = getActiveShape();
    if (!activeShape) return;
    pushSnapshot();
    removeShape(activeShape.id);
    selectShape(-1);
    settings.uIsSelected = 0;
    material.uniforms.uIsSelected.value = 0;
});

// Cmd+Z — undo. Cmd+Shift+Z — redo.
window.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== 'z') return;
    if (document.activeElement.tagName === 'INPUT') return;
    event.preventDefault();
    if (event.shiftKey) {
        redo();
    } else {
        undo();
    }
});
