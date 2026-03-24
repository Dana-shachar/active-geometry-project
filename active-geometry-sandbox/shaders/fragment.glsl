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
  float totalDistance     = 0.0;    // Total distance traveled by the ray
  float minLnDist         = 1e10;   // Closest the ray came to any surface
  float minLnDistSelected = 1e10;   // Closest the ray came to a selected shape (for outline)
  float outlineRayDist    = 0.0;    // Ray distance when minLnDistSelected was set — used for threshold

  // ===================================================
  // The Marching Ray Loop
  // ===================================================
  for(int i = 0; i < 80; i++) {
    vec3 currentPosition = rayOrigin + rayDirection * totalDistance;    // Current position along the ray
    float distToSurface  = map(currentPosition);                        // Distance to the closest surface
    minLnDist = min(minLnDist, distToSurface);                          // Track closest approach
    // Clip selected-shape SDF against the combined scene SDF so the outline only
    // appears on the *visible* surface — not inside boolean carve-outs, where mapSelected()
    // would be negative even though the combined map() is positive (empty space).
    float selDist        = max(mapSelected(currentPosition), distToSurface);
    if (selDist < minLnDistSelected) {
        minLnDistSelected = selDist;
        outlineRayDist    = totalDistance;                              // Depth at closest approach to selection
    }
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

  // Post-loop convergence check: rays near flat/sharp silhouettes can exhaust all
  // iterations without truly hitting the surface. Re-evaluate SDF at final position —
  // if still above threshold, the ray didn't converge and should be treated as a miss.
  vec3 finalPos = rayOrigin + rayDirection * totalDistance;
  if (totalDistance < 10000.0 && map(finalPos) > 0.05) totalDistance = 1e10;

  if(totalDistance < 10000.0) {
    vec3 pointOnSurface = rayOrigin + rayDirection * totalDistance;
    vec3 surfaceNormal  = getSurfaceNormal(pointOnSurface);
    // Two-sided normals: flip if the normal points away from the camera (boolean cut surfaces)
    if (dot(surfaceNormal, -rayDirection) < 0.0) surfaceNormal = -surfaceNormal;
    pixelColor = calculateLighting(pointOnSurface, surfaceNormal);
  } else if (minLnDistSelected < 0.002 * outlineRayDist) {
    pixelColor = vec3(0.898, 0.757, 0.122);  // #E5C11F — accent yellow selection outline
  } else if (abs(rayDirection.y) > 0.0001) {
    // Grid floor at y=0 — intersect ray with the XZ plane
    float gridFloorT = -rayOrigin.y / rayDirection.y;
    if (gridFloorT > 0.0) {
      vec2 gridCoord = (rayOrigin + rayDirection * gridFloorT).xz;

      // fwidth measures how fast gridCoord changes per pixel — keeps lines 1px wide
      // regardless of zoom level or perspective foreshortening
      vec2 minorDeriv = fwidth(gridCoord / 10.0);
      vec2 minorGrid  = abs(fract(gridCoord / 10.0 - 0.5) - 0.5) / minorDeriv;
      float minorLine = 1.0 - min(min(minorGrid.x, minorGrid.y), 1.0);
      minorLine *= clamp(1.0 - max(minorDeriv.x, minorDeriv.y) * 2.0, 0.0, 1.0);

      vec2 majorDeriv = fwidth(gridCoord / 100.0);
      vec2 majorGrid  = abs(fract(gridCoord / 100.0 - 0.5) - 0.5) / majorDeriv;
      float majorLine = 1.0 - min(min(majorGrid.x, majorGrid.y), 1.0);
      majorLine *= clamp(1.0 - max(majorDeriv.x, majorDeriv.y) * 2.0, 0.0, 1.0);

      float gridIntensity = clamp(minorLine * 0.2 + majorLine * 0.3, 0.0, 0.3);

      // Fade grid out with distance so it doesn't clutter the far background
      float gridFade    = clamp(1.0 - gridFloorT / 400.0, 0.0, 1.0);
      pixelColor        = vec3(gridIntensity * gridFade);
    }
  }

  gl_FragColor = vec4(pixelColor, 1.0);
}