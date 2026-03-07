// Testing a simple vertex shader that passes UV coordinates to the fragment shader

varying vec2 vUv;

void main() {
  // Pass the texture coordinates (UVs) to the Fragment Shader
  vUv = uv;
  
  // Position the plane to cover the full screen
  // projectionMatrix and modelViewMatrix are provided automatically by Three.js
  gl_Position = vec4(position.xy, 0.0, 1.0);


}