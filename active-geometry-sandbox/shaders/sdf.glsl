// SDF MANAGER FILE

// ==========================================================
// UNIFORMS & HELPERS
// ==========================================================
uniform int uShapeType;
uniform float uWidth;
uniform float uHeight;
uniform vec3 uPosOffset;
uniform int uIsSelected;

// Bounding Frame math
float sdBoundingFrame(vec3 p, vec3 b, float e) {
    p = abs(p) - b;
    vec3 q = abs(p + e) - e;
    return min(min(
        length(max(vec3(p.x, q.y, q.z), 0.0)) + min(max(p.x, max(q.y, q.z)), 0.0),
        length(max(vec3(q.x, p.y, q.z), 0.0)) + min(max(q.x, max(p.y, q.z)), 0.0)),
        length(max(vec3(q.x, q.y, p.z), 0.0)) + min(max(q.x, max(q.y, p.z)), 0.0));
}


// ==========================================================
// SDF SHAPE LIBRARY
// ==========================================================

// Sphere: Checks length from center minus the size
float sdSphere(vec3 pos, float sphSize) {
  return length(pos) - sphSize;
}

// Box: Calculates distance using box-specific offsets
float sdBox(vec3 pos, vec3 boxSize) {
  // boxOffset measures how far we are from the box edges in each direction
  vec3 boxOffset = abs(pos) - boxSize;
  float boxExDis = length(max(boxOffset, 0.0));
  float boxInDis = min(max(boxOffset.x, max(boxOffset.y, boxOffset.z)), 0.0);
  return boxExDis + boxInDis;
}

// Cylinder: Uses cylinder-specific components and distances
float sdCylinder(vec3 pos, float cylHeight, float cylRadius) {
  // cylComp handles the 2D projected distance
  vec2 cylComp = abs(vec2(length(pos.xz), pos.y)) - vec2(cylRadius, cylHeight);

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
    return sdCylinder(localPos, uHeight, uWidth);
}

// ==========================================================
// 2. PROBE (getShapeBBox)
// ==========================================================
vec3 getShapeBBox() {
    // For now, return analytic extents. In Stage 2, this will use
    // binary searching to find edges of complex booleans.
    if (uShapeType == 0) return vec3(uWidth, uWidth, uWidth);
    return vec3(uWidth, uHeight, uWidth);
}

// ==========================================================
// 3. SCENE ASSEMBLER (map)
// ==========================================================
float map(vec3 pos) {
    vec3 localPos = pos - uPosOffset;
    float shapeDis = shapeMap(localPos);

    float finalDis = shapeDis;

    if (uIsSelected == 1) {
        vec3 bbox = getShapeBBox();
        float frameDis = sdBoundingFrame(localPos, bbox, 0.01);
        finalDis = min(shapeDis, frameDis);
    }

    return finalDis;
}
