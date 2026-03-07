varying vec2 vUv;
uniform float uTime;

// global shape uniforms
uniform vec2 uResolution;
uniform float uLightX;
uniform float uLightY;
uniform float uAmbientLight;
uniform mat4  uCamMatrix;   // Three.js camera.matrixWorld — drives orbit
uniform vec3  uCamPos;      // Three.js camera.position
uniform float uFocalLen;    // derived from camera.fov — keeps perspective consistent


// =========================================
// Calculate the normals
// =========================================
vec3 getSurfaceNormal(vec3 pointOnSurface) {
    // We check the distance at a tiny offset to find the "slope"
    float offset = 0.001; 
    
    // Check the difference in distance for each axis
    float gradientX = map(pointOnSurface + vec3(offset, 0.0, 0.0)) - map(pointOnSurface - vec3(offset, 0.0, 0.0));
    float gradientY = map(pointOnSurface + vec3(0.0, offset, 0.0)) - map(pointOnSurface - vec3(0.0, offset, 0.0));
    float gradientZ = map(pointOnSurface + vec3(0.0, 0.0, offset)) - map(pointOnSurface - vec3(0.0, 0.0, offset));
    
    // Normalize the result so we have a pure direction vector
    return normalize(vec3(gradientX, gradientY, gradientZ));
}

// =========================================
// Lighting Utility
// =========================================
vec3 calculateLighting(vec3 pointOnSurface, vec3 surfaceNormal) {
    // light direction
    vec3 lightPosition = (uCamMatrix * vec4(uLightX, uLightY, 0.0, 1.0)).xyz;

    // Direction from the surface point to the light
    vec3 directionToLight = normalize(lightPosition - pointOnSurface);

    // light math = diffuse lighting based on the *angle* between the surface normal and the light direction
    float diffuseLight = max(dot(surfaceNormal, directionToLight), 0.0);

    // Add ambient light so we can see the shape even in shaded areas
    float finalLighting = diffuseLight + uAmbientLight;
    
    // Set the pixel color based on the lighting
    return vec3(1.0) * finalLighting;
}

void main() {
  // Normalize coordinates to centered [-1, 1] space
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / uResolution.y;

  // 3. Raymarching Camera Setup — driven by Three.js OrbitControls via uniforms
  vec3 rayDirection = normalize((uCamMatrix * vec4(uv.x, uv.y, -uFocalLen, 0.0)).xyz);
  vec3 rayOrigin    = uCamPos;
  float totalDistance = 0.0;                    // Total distance traveled by the ray
  float minLnDist     = 1e10;                   // Closest the ray came to any surface (for outline)

  // ===================================================
  // The Marching Ray Loop
  // ===================================================
  for(int i = 0; i < 80; i++) {
    vec3 currentPosition = rayOrigin + rayDirection * totalDistance;    // Current position along the ray
    float distToSurface  = map(currentPosition);                        // Distance to the closest surface
    minLnDist     = min(minLnDist, distToSurface);                      // Track closest approach
    totalDistance += distToSurface;                                     // "March" forward by that distance

   // If the distance is tiny=> surface hit=> stop walking:
    if(distToSurface < 0.001 || totalDistance > 10000.0) {
        break;
    }
  }

  // ===================================================
  // Drawing the result
  // ===================================================
  vec3 pixelColor = vec3(0.0); // default Black (Background)  
    
  if(totalDistance < 10000.0) {
    vec3 pointOnSurface = rayOrigin + rayDirection * totalDistance;
    vec3 surfaceNormal = getSurfaceNormal(pointOnSurface);
    pixelColor = calculateLighting(pointOnSurface, surfaceNormal);
  } else if (uIsSelected == 1 && minLnDist < 0.002 * length(uCamPos - uPosOffset)) {
    pixelColor = vec3(0.0, 0.784, 0.702);  // #00C8B3 — selection outline
  }

  gl_FragColor = vec4(pixelColor, 1.0);
}