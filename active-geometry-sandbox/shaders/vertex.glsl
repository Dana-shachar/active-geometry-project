// Testing 2

varying vec2 vUv;

void main() {
  // Pass the texture coordinates (UVs) to the Fragment Shader
  vUv = uv;
  
  // Position the plane to cover the full screen
  // projectionMatrix and modelViewMatrix are provided automatically by Three.js
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);


}