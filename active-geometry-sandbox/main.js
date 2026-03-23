import * as THREE from 'three';
import vertexShader from './shaders/vertex.glsl';
import fragmentShader from './shaders/fragment.glsl';
import sdfGlsl from './shaders/sdf.glsl?raw';
import shapeMapperGlsl from './shaders/shapeMapper.glsl?raw';

import { settings, initMouseControls } from './js/uiSettings.js';
import { initPanels, updatePanels } from './js/uiDesign.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Gumball } from './js/gumball.js';
import { TransformHandles } from './js/transformHandles.js';
import { buildShaderBlock, buildUniforms, syncShapeUniforms } from './js/shapeBuilder.js';
import { addShape, shapeList, activeShapeIndex, shapeListVersion, getActiveShape, setActiveShape } from './js/shapeManager.js';

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
initMouseControls(settings, renderer.domElement, cameraControls, (x, y) => findHitShape(x, y) >= 0, camera);

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

// Builds the full fragment shader string from the current shape list.
// Called once at startup and again whenever a shape is added or removed.
function buildFragmentShader() {
    return sdfGlsl + shapeMapperGlsl + buildShaderBlock(shapeList) + fragmentShader;
}

// The ShaderMaterial allows to write custom GLSL code for how the surface should be rendered.
// Shape uniforms are generated from the current shapeList and merged with scene-level uniforms.
const material = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader: buildFragmentShader(),
  uniforms: {
    uTime:       { value: 0 },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uLightX:     { value: settings.lightX },
    uLightY:     { value: settings.lightY },
    uAmbientLight: { value: settings.ambientLight },
    uCamMatrix:  { value: camera.matrixWorld },   // live reference — auto-updates with orbit
    uCamPos:     { value: camera.position },       // live reference — auto-updates with orbit
    uFocalLen:   { value: 1.0 / Math.tan((camera.fov / 2) * Math.PI / 180) },
    ...buildUniforms(shapeList),                  // per-shape uniforms + uIsSelected + uActiveShapePosOffset
  }
});

// The mesh combines the geometry and material, and is added to the scene
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

// Tracks the last known shapeListVersion — used to detect when a recompile is needed.
let lastShapeListVersion = shapeListVersion;

// Rebuilds the fragment shader and uniforms when shapes are added or removed.
// Called from animate() when shapeListVersion changes.
function recompileShader() {
    const newShapeUniforms = buildUniforms(shapeList);
    material.fragmentShader = buildFragmentShader();
    // Merge new per-shape uniforms into the existing material uniforms object.
    // Camera and lighting uniforms are preserved; shape uniforms are fully replaced.
    Object.assign(material.uniforms, newShapeUniforms);
    material.needsUpdate = true;
    lastShapeListVersion = shapeListVersion;
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
    material.uniforms.uTime.value         = time * 0.001;
    material.uniforms.uIsSelected.value   = settings.uIsSelected;
    material.uniforms.uFocalLen.value     = 1.0 / Math.tan((camera.fov / 2) * Math.PI / 180);

    // Sync all shape params + rotation matrices to GPU (loops over shapeList)
    syncShapeUniforms(shapeList, material.uniforms, activeShapeIndex, _rotMat4);

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

    // Update the uniform so the shader knows the new width/height
    material.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
});

//==========================================================
// CLICK SELECTION
//==========================================================

// Casts a ray from the camera through the clicked pixel and checks if it
// intersects the bounding box of a given shape.
function shapeHit(clientX, clientY, shape) {
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

    const bboxHalfX = shape.type === 'helix'  ? shape.width + shape.tubeRadius : shape.width;
    const bboxHalfZ = shape.type === 'box'    ? shape.depth : bboxHalfX;
    const bboxHalfY = shape.type === 'helix'  ? shape.turns * shape.stepHeight * 0.5 + shape.tubeRadius
                    : (shape.type === 'sphere' || shape.type === 'polyhedron') ? shape.width
                    : shape.height;

    const bboxMin = shape.posOffset.clone().sub(new THREE.Vector3(bboxHalfX, bboxHalfY, bboxHalfZ));
    const bboxMax = shape.posOffset.clone().add(new THREE.Vector3(bboxHalfX, bboxHalfY, bboxHalfZ));
    return intersectBBox(rayOrigin, rayDir, bboxMin, bboxMax);
}

// Loops over all shapes and returns the index of the first one the ray hits, or -1.
function findHitShape(clientX, clientY) {
    for (let i = 0; i < shapeList.length; i++) {
        if (shapeHit(clientX, clientY, shapeList[i])) return i;
    }
    return -1;
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

// Click event on the canvas: handle clicks take priority, then shape selection.
// Sets the active shape index and updates the selection uniform.
renderer.domElement.addEventListener('click', (event) => {
    if (transformHandles.handleClick()) return;
    const hitIndex = findHitShape(event.clientX, event.clientY);
    setActiveShape(hitIndex);
    settings.uIsSelected = hitIndex >= 0 ? 1 : 0;
    material.uniforms.uIsSelected.value = settings.uIsSelected;
});
