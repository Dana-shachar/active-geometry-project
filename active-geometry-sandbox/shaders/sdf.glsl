// SDF MANAGER FILE

// ==========================================================
// CONSTANTS
// ==========================================================
#define PI 3.14159265359

// ==========================================================
// UNIFORMS & HELPERS
// ==========================================================
uniform int   uShapeType;
uniform float uWidth;
uniform float uHeight;
uniform float uDepth;         // box Z half-extent (independent from width)
uniform float uCornerRadius;  // rounding: box edges, or cylinder cap hemisphere radius
uniform int   uCaps;          // 1 = caps on (default), 0 = open ends
uniform int   uPrismSides;    // N-gon prism: number of polygon sides (3–20)
uniform vec3  uPosOffset;
uniform int   uIsSelected;



// ==========================================================
// SDF SHAPE LIBRARY
// ==========================================================

// Sphere: Checks length from center minus the size
float sdSphere(vec3 ptPos, float sphSize) {
  return length(ptPos) - sphSize;
}

// Box: Calculates distance using box-specific offsets
float sdBox(vec3 ptPos, vec3 boxSize) {
  vec3 boxOffset  = abs(ptPos) - boxSize;
  float boxExDist = length(max(boxOffset, 0.0));
  float boxInDist = min(max(boxOffset.x, max(boxOffset.y, boxOffset.z)), 0.0);
  return boxExDist + boxInDist;
}

// Rounded Box: sdBox with edges/corners carved to a given radius.
// halfExtents are the outer bounds — rounding is inset from them.
float sdRoundBox(vec3 ptPos, vec3 halfExtents, float radius) {
  float boxRadius = min(radius, min(halfExtents.x, min(halfExtents.y, halfExtents.z)));
  vec3 boxOffset  = abs(ptPos) - halfExtents + boxRadius;
  return length(max(boxOffset, 0.0)) + min(max(boxOffset.x, max(boxOffset.y, boxOffset.z)), 0.0) - boxRadius;
}

// Ellipsoid: Non-uniform sphere scaled independently per axis
float sdEllipsoid(vec3 ptPos, vec3 ellipRadii) {
    float k0 = length(ptPos / ellipRadii);
    float k1 = length(ptPos / (ellipRadii * ellipRadii));
    return k0 * (k0 - 1.0) / k1;
}

// Cylinder: Uses cylinder-specific components and distances
float sdCylinder(vec3 ptPos, float cylHeight, float cylRadius) {
  vec2 cylComp    = abs(vec2(length(ptPos.xz), ptPos.y)) - vec2(cylRadius, cylHeight);
  float cylExDist = length(max(cylComp, 0.0));
  float cylInDist = min(max(cylComp.x, cylComp.y), 0.0);
  return cylExDist + cylInDist;
}

// Rounded Cylinder: cylinder with filleted cap edges.
// cornerRadius = 0 → flat caps (identical to sdCylinder); cornerRadius = cylRadius → full capsule.
// Outer dimensions stay at cylRadius × cylHeight regardless of rounding.
float sdRoundCyl(vec3 ptPos, float cylRadius, float cornerRadius, float cylHeight) {
  float cylRoundRadius = min(cornerRadius, min(cylRadius, cylHeight)); // clamp to shape limits
  vec2 cylComp    = abs(vec2(length(ptPos.xz), ptPos.y)) - vec2(cylRadius - cylRoundRadius, cylHeight - cylRoundRadius);
  float cylExDist = length(max(cylComp, 0.0));
  float cylInDist = min(max(cylComp.x, cylComp.y), 0.0);
  return cylExDist + cylInDist - cylRoundRadius;
}

// Open Cylinder: lateral surface only, no flat end caps.
float sdOpenCylinder(vec3 ptPos, float cylHeight, float cylRadius) {
  float cylRadial = length(ptPos.xz) - cylRadius;
  float cylAxial  = abs(ptPos.y) - cylHeight;
  // Outside height range: guide ray to nearest rim — no flat cap surface
  if (cylAxial > 0.0) return length(vec2(max(cylRadial, 0.0), cylAxial));
  return cylRadial;
}

// N-gon Prism: 2D signed distance to a regular polygon in the XZ plane.
// Uses IQ's symmetry-fold: maps any point into a canonical sector, then tests one edge.
// priCircumRad = distance from center to vertex. priSideCount >= 3.
float sdPolygon2D(vec2 priRadialPos, float priCircumRad, int priSideCount) {
    float priHalfAngle   = PI / float(priSideCount);           // half the angle of one sector
    vec2  priEdgeCossin  = vec2(cos(priHalfAngle), sin(priHalfAngle)); // direction toward edge midpoint
    float priSectorAngle = mod(atan(priRadialPos.y, priRadialPos.x), 2.0 * priHalfAngle) - priHalfAngle; // fold into canonical sector
    // abs(sin(...)) mirrors the bottom half of the sector onto the top half. 
    // This allows us to calculate the distance to just ONE half of ONE edge segment, 
    // rather than looping through all N sides of the polygon.
    vec2  priFoldedPos = length(priRadialPos) * vec2(cos(priSectorAngle), abs(sin(priSectorAngle)));          
          priFoldedPos   -= priCircumRad * priEdgeCossin;        // shift origin to edge midpoint
          priFoldedPos.y += clamp(-priFoldedPos.y, 0.0, priCircumRad * priEdgeCossin.y); // clamp to edge length
    return length(priFoldedPos) * sign(priFoldedPos.x);        // signed: negative inside, positive outside
}

// N-gon Prism: extruded regular polygon, capped ends.
float sdNgonPrism(vec3 ptPos, float priCircumRad, float priHalfHeight, int priSideCount) {
    float priDist2D    = sdPolygon2D(ptPos.xz, priCircumRad, priSideCount); // 2D polygon distance in XZ
    float priDistAxial = abs(ptPos.y) - priHalfHeight;                      // signed distance from cap plane
    return length(max(vec2(priDist2D, priDistAxial), 0.0)) + min(max(priDist2D, priDistAxial), 0.0);
}

// ==========================================================
// 1. RAW GEOMETRY (shapeMap)
// ==========================================================
float shapeMap(vec3 localPos) {
    if (uShapeType == 0) return sdSphere(localPos, uWidth);
    if (uShapeType == 1) {
        vec3 halfExtents = vec3(uWidth, uHeight, uDepth);
        if (uCornerRadius > 0.0) return sdRoundBox(localPos, halfExtents, uCornerRadius);
        return sdBox(localPos, halfExtents);
    }
    if (uShapeType == 2) {
        if (uCaps == 0)           return sdOpenCylinder(localPos, uHeight, uWidth);
        if (uCornerRadius > 0.0)  return sdRoundCyl(localPos, uWidth, uCornerRadius, uHeight);
        return sdCylinder(localPos, uHeight, uWidth);
    }
    if (uShapeType == 3) return sdEllipsoid(localPos, vec3(uWidth, uHeight, uWidth));
    if (uShapeType == 4) {
        if (uCaps == 0) {
            // Open ends: lateral faces only, no flat caps
            float priDist2D    = sdPolygon2D(localPos.xz, uWidth, uPrismSides);
            float priDistAxial = abs(localPos.y) - uHeight;
            if (priDistAxial > 0.0) return length(vec2(max(priDist2D, 0.0), priDistAxial)); // outside height: guide to rim
            return priDist2D;
        }
        return sdNgonPrism(localPos, uWidth, uHeight, uPrismSides);
    }
    return 1e10; // unknown shape: return nothing
}

// ==========================================================
// 2. PROBE (getShapeBBox)
// ==========================================================
vec3 getShapeBBox() {
    // Returns conservative half-extents. In Stage 2 (booleans),
    // this will return the union of both shapes' bounding boxes.
    if (uShapeType == 0) return vec3(uWidth, uWidth, uWidth);
    if (uShapeType == 1) return vec3(uWidth, uHeight, uDepth);
    if (uShapeType == 2) return vec3(uWidth, uHeight, uWidth); // sdRoundCyl keeps same outer dims as sdCylinder
    if (uShapeType == 4) return vec3(uWidth, uHeight, uWidth); // polygon fits inside circumscribed cylinder
    return vec3(uWidth, uHeight, uWidth);
}

// ==========================================================
// 3. SCENE ASSEMBLER (map)
// ==========================================================
float map(vec3 worldPos) {
    vec3 localPos = worldPos - uPosOffset;
    return shapeMap(localPos);
}
