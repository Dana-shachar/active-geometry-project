import * as THREE from 'three';
import vertexShader from './shaders/vertex.glsl';
import fragmentShader from './shaders/fragment.glsl';
// IMPORT THE SDF MANAGER AS RAW TEXT
import sdfManager from './shaders/sdf.glsl?raw';

import { settings, initUI, initMouseControls } from './ui.js';

//==========================================================
// CORE ENGINE SETUP
//==========================================================
// Create the menu and establish the shared 'settings' object
initUI();
initMouseControls(settings);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

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
    uAmbientLight: { value: settings.ambientLight },
    uShapeType: { value: settings.shapeType },
    uWidth: { value: settings.width },
    uHeight: { value: settings.height },
    uPosOffset: { value: settings.posOffset }
  }
});

// The mesh combines the geometry and material, and is added to the scene
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

//==========================================================
// ANIMATION & SYNC SYSTEM
//==========================================================
function animate(time) {
    // This section syncs our UI settings to the GPU every frame
    material.uniforms.uRadius.value = settings.sphereRadius;
    material.uniforms.uLightX.value = settings.lightX;
    material.uniforms.uAmbientLight.value = settings.ambientLight;
    material.uniforms.uShapeType.value = settings.shapeType;
    material.uniforms.uWidth.value = settings.width;
    material.uniforms.uHeight.value = settings.height;
    material.uniforms.uTime.value = time * 0.001;

    renderer.render(scene, camera);
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
});
