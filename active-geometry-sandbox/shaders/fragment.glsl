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
  float keyObjLn          = 1e10;   // Closest the ray came to the key object (for thick outline)
  float keyObjRayDist     = 0.0;    // Ray distance when keyObjLn was set — used for threshold

  // ===================================================
  // The Marching Ray Loop
  // ===================================================
  for(int i = 0; i < 80; i++) {
    vec3 currentPosition = rayOrigin + rayDirection * totalDistance;    // Current position along the ray
    float distToSurface  = map(currentPosition);                        // Distance to the closest surface
    minLnDist = min(minLnDist, distToSurface);                          // Track closest approach
    // For non-union selected shapes (subtract/intersect/exclude), track abs(SDF) so the
    // outline follows the shape's full geometry even where it's hidden inside the solid.
    // For union shapes, clip against the scene SDF to avoid outlines in boolean carve-outs.
    float selectDist = max(mapSelected(currentPosition), distToSurface);
    if (selectDist < minLnDistSelected) {
        minLnDistSelected = selectDist;
        outlineRayDist    = totalDistance;                              // Depth at closest approach to selection
    }
    // Key object outline tracking — same pattern as selection outline, doubled threshold
    float keyObjDist = max(mapKeyObj(currentPosition), distToSurface);
    if (keyObjDist < keyObjLn) {
        keyObjLn        = keyObjDist;
        keyObjRayDist   = totalDistance;
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

  // Clip plane: discard hits on the positive side of the chosen plane.
  // uClipAxis: 1=YZ plane (X normal)  2=XZ plane (Y normal)  3=XY plane (Z normal)
  // Tracks whether clipping fired and finds the ray-plane intersection for cross-section drawing.
  bool wasClipped = false;
  float clipCrossT = -1.0;
  if (totalDistance < 10000.0 && uClipAxis != 0) {
    vec3 hitPos = rayOrigin + rayDirection * totalDistance;
    if ((uClipAxis == 1 && hitPos.x > uClipPos) ||
        (uClipAxis == 2 && hitPos.y > uClipPos) ||
        (uClipAxis == 3 && hitPos.z > uClipPos)) {
      totalDistance = 1e10;
      wasClipped = true;
      // How fast the ray moves along the clip axis, and how far the clip plane is from the ray origin.
      float clipRaySpeed    = (uClipAxis == 1) ? rayDirection.x : (uClipAxis == 2) ? rayDirection.y : rayDirection.z;
      float clipPlaneOffset = (uClipAxis == 1) ? uClipPos - rayOrigin.x : (uClipAxis == 2) ? uClipPos - rayOrigin.y : uClipPos - rayOrigin.z;
      if (abs(clipRaySpeed) > 0.0001) clipCrossT = clipPlaneOffset / clipRaySpeed;
    }
  }

  // Second march pass: only runs when a ray was clipped.
  // Resumes marching from the clip plane to find inner surfaces (e.g. hollow shell walls)
  // visible through the cut opening. Has no effect when clip is off (wasClipped stays false).
  float innerHitDistance = 1e10;
  if (wasClipped && clipCrossT > 0.0) {
    vec3  innerRayOrigin   = rayOrigin + rayDirection * clipCrossT;
    float innerMarchDist   = 0.01;
    for (int i = 0; i < 64; i++) {
      vec3  innerCurrentPos = innerRayOrigin + rayDirection * innerMarchDist;
      float innerSdfDist    = map(innerCurrentPos);
      innerMarchDist += innerSdfDist;
      if (innerSdfDist < 0.001 || innerMarchDist > 10000.0) break;
    }
    // Accept hit only if it converged and landed on the unclipped side
    if (innerMarchDist < 10000.0) {
      vec3  innerHitPos   = innerRayOrigin + rayDirection * innerMarchDist;
      float innerHitCoord = (uClipAxis == 1) ? innerHitPos.x : (uClipAxis == 2) ? innerHitPos.y : innerHitPos.z;
      if (innerHitCoord <= uClipPos && map(innerHitPos) < 0.05) innerHitDistance = innerMarchDist;
    }
  }

  // ── 1. Surface hit ──────────────────────────────────────────
  if (totalDistance < 10000.0) {
    vec3 pointOnSurface = rayOrigin + rayDirection * totalDistance;
    vec3 surfaceNormal  = getSurfaceNormal(pointOnSurface);
    // Two-sided normals: flip if the normal points away from the camera (boolean cut surfaces)
    if (dot(surfaceNormal, -rayDirection) < 0.0) surfaceNormal = -surfaceNormal;
    pixelColor = calculateLighting(pointOnSurface, surfaceNormal);

  // ── 2. Clip plane — inner surface through the cut opening ───
  } else if (wasClipped && innerHitDistance < 10000.0) {
    vec3 innerSurfacePos    = rayOrigin + rayDirection * (clipCrossT + innerHitDistance);
    vec3 innerSurfaceNormal = getSurfaceNormal(innerSurfacePos);
    if (dot(innerSurfaceNormal, -rayDirection) < 0.0) innerSurfaceNormal = -innerSurfaceNormal;
    pixelColor = calculateLighting(innerSurfacePos, innerSurfaceNormal);

  // ── 3. Clip plane — cross-section face ──────────────────────
  // Clip-plane intersection landed inside solid geometry → draw a lit cut face.
  } else if (wasClipped && clipCrossT > 0.0 && map(rayOrigin + rayDirection * clipCrossT) < 0.0) {
    vec3 clipFacePos    = rayOrigin + rayDirection * clipCrossT;
    vec3 clipFaceNormal = (uClipAxis == 1) ? vec3(-sign(rayDirection.x), 0.0, 0.0)
                        : (uClipAxis == 2) ? vec3(0.0, -sign(rayDirection.y), 0.0)
                        :                   vec3(0.0, 0.0, -sign(rayDirection.z));
    pixelColor = calculateLighting(clipFacePos, clipFaceNormal);

  // ── 4. Key object outline (thick) ───────────────────────────
  // Checked before the regular outline — same color, doubled threshold → visibly thicker border.
  } else if (!wasClipped && keyObjLn < 0.004 * keyObjRayDist) {
    pixelColor = vec3(0.898, 0.757, 0.122);  // #E5C11F

  // ── 5. Selection outline ────────────────────────────────────
  } else if (!wasClipped && minLnDistSelected < 0.002 * outlineRayDist) {
    pixelColor = vec3(0.898, 0.757, 0.122);  // #E5C11F

  // ── 6. Grid floor ────────────────────────────────────────────
  } else if (abs(rayDirection.y) > 0.0001) {
    float gridFloorT = -rayOrigin.y / rayDirection.y;
    if (gridFloorT > 0.0) {
      vec2 gridCoord = (rayOrigin + rayDirection * gridFloorT).xz;

      // fwidth keeps grid lines 1px wide regardless of zoom or perspective foreshortening
      vec2 minorDeriv = fwidth(gridCoord / 10.0);
      vec2 minorGrid  = abs(fract(gridCoord / 10.0 - 0.5) - 0.5) / minorDeriv;
      float minorLine = 1.0 - min(min(minorGrid.x, minorGrid.y), 1.0);
      minorLine *= clamp(1.0 - max(minorDeriv.x, minorDeriv.y) * 2.0, 0.0, 1.0);

      vec2 majorDeriv = fwidth(gridCoord / 100.0);
      vec2 majorGrid  = abs(fract(gridCoord / 100.0 - 0.5) - 0.5) / majorDeriv;
      float majorLine = 1.0 - min(min(majorGrid.x, majorGrid.y), 1.0);
      majorLine *= clamp(1.0 - max(majorDeriv.x, majorDeriv.y) * 2.0, 0.0, 1.0);

      float gridIntensity = clamp(minorLine * 0.2 + majorLine * 0.3, 0.0, 0.3);
      float gridFade      = clamp(1.0 - gridFloorT / 400.0, 0.0, 1.0);  // fade with distance
      pixelColor          = vec3(gridIntensity * gridFade);
    }
  }

  // ── 7. Ghost outline — non-union selected shape ──────────────
  // Second march on mapSelected only (ignores booleans) so subtract/intersect shapes
  // show a clean outline even where they're hidden inside the scene solid.
  if (uSelectedIsNonUnion == 1) {
    float ghostMarchDist   = 0.0;
    float ghostMinApproach = 1e10;
    float ghostMinRayDist  = 0.0;
    bool  ghostConverged   = false;
    for (int i = 0; i < 64; i++) {
      vec3  ghostPos = rayOrigin + rayDirection * ghostMarchDist;
      float ghostSdf = mapSelected(ghostPos);
      if (ghostSdf < ghostMinApproach) { ghostMinApproach = ghostSdf; ghostMinRayDist = ghostMarchDist; }
      if (ghostSdf < 0.001) { ghostConverged = true; break; }
      if (ghostMarchDist > 10000.0) break;
      ghostMarchDist += ghostSdf;
    }
    if (!ghostConverged && ghostMinApproach < 0.002 * ghostMinRayDist) {
      pixelColor = vec3(0.898, 0.757, 0.122);  // #E5C11F
    }
  }

  gl_FragColor = vec4(pixelColor, 1.0);
}