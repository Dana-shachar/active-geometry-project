// SDF MANAGER FILE

// ==========================================================
// UNIFORMS & HELPERS
// ==========================================================
uniform int uShapeType;
uniform float uWidth;
uniform float uHeight;
uniform vec3 uPosOffset;
uniform int uIsSelected;

// Bounding Box Frame: SDF for a wireframe box outline
float sdBBoxFrame(vec3 ptPos, vec3 halfExtents, float edgeThickness) {
    ptPos = abs(ptPos) - halfExtents;
    vec3 sdEdgeZone = abs(ptPos + edgeThickness) - edgeThickness;
    return min(min(
        length(max(vec3(ptPos.x, sdEdgeZone.y, sdEdgeZone.z), 0.0)) + min(max(ptPos.x, max(sdEdgeZone.y, sdEdgeZone.z)), 0.0),
        length(max(vec3(sdEdgeZone.x, ptPos.y, sdEdgeZone.z), 0.0)) + min(max(sdEdgeZone.x, max(ptPos.y, sdEdgeZone.z)), 0.0)),
        length(max(vec3(sdEdgeZone.x, sdEdgeZone.y, ptPos.z), 0.0)) + min(max(sdEdgeZone.x, max(sdEdgeZone.y, ptPos.z)), 0.0));
}


// ==========================================================
// SDF SHAPE LIBRARY
// ==========================================================

// Sphere: Checks length from center minus the size
float sdSphere(vec3 ptPos, float sphSize) {
  return length(ptPos) - sphSize;
}

// Box: Calculates distance using box-specific offsets
float sdBox(vec3 ptPos, vec3 boxSize) {
  // boxOffset measures how far we are from the box edges in each direction
  vec3 boxOffset = abs(ptPos) - boxSize;
  float boxExDis = length(max(boxOffset, 0.0));
  float boxInDis = min(max(boxOffset.x, max(boxOffset.y, boxOffset.z)), 0.0);
  return boxExDis + boxInDis;
}

// Ellipsoid: Non-uniform sphere scaled independently per axis
float sdEllipsoid(vec3 ptPos, vec3 ellipRadii) {
    float k0 = length(ptPos / ellipRadii);
    float k1 = length(ptPos / (ellipRadii * ellipRadii));
    return k0 * (k0 - 1.0) / k1;
}

// Cylinder: Uses cylinder-specific components and distances
float sdCylinder(vec3 ptPos, float cylHeight, float cylRadius) {
  // cylComp handles the 2D projected distance
  vec2 cylComp = abs(vec2(length(ptPos.xz), ptPos.y)) - vec2(cylRadius, cylHeight);

  // cylExDis is the distance outside, cylInDis is the distance inside (negative)
  float cylExDis = length(max(cylComp, 0.0));
  float cylInDis = min(max(cylComp.x, cylComp.y), 0.0);
  return cylExDis + cylInDis;
}

// ==========================================================
// 1. RAW GEOMETRY (shapeMap)
// ==========================================================
float shapeMap(vec3 localPos) {
    if (uShapeType == 0) return sdSphere(localPos, uWidth);
    if (uShapeType == 1) return sdBox(localPos, vec3(uWidth, uHeight, uWidth));
    if (uShapeType == 2) return sdCylinder(localPos, uHeight, uWidth);
    if (uShapeType == 3) return sdEllipsoid(localPos, vec3(uWidth, uHeight, uWidth));
    return 1e10; // unknown shape: return nothing
}

// ==========================================================
// 2. PROBE (getShapeBBox)
// ==========================================================
vec3 getShapeBBox() {
    // Returns conservative half-extents. In Stage 2 (booleans),
    // this will return the union of both shapes' bounding boxes.
    if (uShapeType == 0) return vec3(uWidth, uWidth, uWidth);
    return vec3(uWidth, uHeight, uWidth);
}

// ==========================================================
// 3. SCENE ASSEMBLER (map)
// ==========================================================
float map(vec3 worldPos) {
    vec3 localPos = worldPos - uPosOffset;
    float shapeDis = shapeMap(localPos);

    float finalDis = shapeDis;

    if (uIsSelected == 1) {
        vec3 bbox = getShapeBBox();
        float frameDis = sdBBoxFrame(localPos, bbox, 0.01);
        finalDis = min(shapeDis, frameDis);
    }

    return finalDis;
}
